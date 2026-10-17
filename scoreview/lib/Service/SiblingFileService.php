<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\ForbiddenException;
use OCP\Files\InvalidPathException;
use OCP\Files\IRootFolder;
use OCP\Files\NotEnoughSpaceException;
use OCP\Files\NotFoundException;
use OCP\Files\NotPermittedException;
use OCP\Files\StorageNotAvailableException;
use OCP\Lock\LockedException;

/**
 * Writes a file the browser produced into Files, in a folder the person may
 * write to - the practice track (E13) and the PDF file of a score (E16).
 *
 * One way of saving for both, because everything that makes it safe is the
 * same: the cleaned name, no silent overwrite (409 with a free name), the
 * check against the quota before writing, and no half file left behind.
 * Which folder and which size limit apply is the caller's business.
 */
class SiblingFileService {
	public function __construct(
		private IRootFolder $rootFolder,
	) {
	}

	/**
	 * @param resource $stream the checked content, at its start
	 * @param string $extension with the dot, e.g. ".pdf"
	 * @return array{fileId: int, name: string, path: string}
	 * @throws SiblingFileException
	 */
	public function save(Folder $folder, string $userId, $stream, string $name, string $extension, bool $replace): array {
		$base = FileNames::clean($name, [$extension]);
		if ($base === null) {
			throw new SiblingFileException(SiblingFileException::INVALID);
		}
		$fileName = $base . $extension;

		// Checked before, not left to the write - measured: over the quota
		// Nextcloud writes a stream up to the limit, then fails with
		// NotPermittedException and leaves a truncated file behind. Negative
		// values mean unlimited or unknown.
		$size = fstat($stream)['size'] ?? 0;
		$free = $folder->getFreeSpace();
		if ($free >= 0 && $size > $free) {
			throw new SiblingFileException(SiblingFileException::STORAGE_FULL);
		}

		$created = false;
		try {
			if ($folder->nodeExists($fileName)) {
				$existing = $folder->get($fileName);
				if (!$replace) {
					throw new SiblingFileException(
						SiblingFileException::EXISTS,
						FileNames::firstFree($base, $extension, fn (string $n) => $folder->nodeExists($n)),
					);
				}
				if (!$existing instanceof File || !$existing->isUpdateable()) {
					throw new SiblingFileException(SiblingFileException::FORBIDDEN);
				}
				$existing->putContent($stream);
				$file = $existing;
			} else {
				if (!$folder->isCreatable()) {
					throw new SiblingFileException(SiblingFileException::FORBIDDEN);
				}
				$created = true;
				$file = $folder->newFile($fileName, $stream);
			}
		} catch (NotEnoughSpaceException) {
			$this->removePartial($folder, $fileName, $created);
			throw new SiblingFileException(SiblingFileException::STORAGE_FULL);
		} catch (NotPermittedException|ForbiddenException) {
			// ForbiddenException: an access-control rule (files_accesscontrol)
			// refused the write - a refusal like a missing permission.
			$this->removePartial($folder, $fileName, $created);
			throw new SiblingFileException(SiblingFileException::FORBIDDEN);
		} catch (LockedException|StorageNotAvailableException) {
			// A sync client holds the file being replaced, or an external
			// storage is offline: worth another try, not a 500.
			$this->removePartial($folder, $fileName, $created);
			throw new SiblingFileException(SiblingFileException::BUSY);
		} catch (InvalidPathException|NotFoundException) {
			// A name this instance does not allow (forbidden characters such
			// as `:` with Windows-compatible names, too long), or the file
			// vanished between check and read: 400 instead of 500.
			throw new SiblingFileException(SiblingFileException::INVALID);
		}

		$userFolder = $this->rootFolder->getUserFolder($userId);
		return [
			'fileId' => (int)$file->getId(),
			'name' => $file->getName(),
			'path' => rtrim($userFolder->getRelativePath($file->getPath()) ?? '', '/'),
		];
	}

	/**
	 * Whatever a failed creation left behind goes again - half a file would
	 * be worse than none. A replaced file stays (its previous version is in
	 * the versions).
	 */
	private function removePartial(Folder $folder, string $fileName, bool $created): void {
		if (!$created) {
			return;
		}
		try {
			if ($folder->nodeExists($fileName)) {
				$folder->get($fileName)->delete();
			}
		} catch (\Throwable) {
			// Cleaning up is optional - the actual error goes back anyway.
		}
	}
}
