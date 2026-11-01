<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;

/**
 * The app's artifact cache in IAppData, below `scoreview/`: the base
 * conversions (ConversionService, `<fileId>/<etag>/`) and the display
 * variants inside them (VariantService, `<fileId>/<etag>/v/<key>/`).
 *
 * What both share, and must keep sharing: the artifact name from the URL is
 * checked against an allowlist before any storage is touched, a page is
 * `page-N` in exactly one spelling, and the pages of a run replace those of
 * an earlier run in the same folder completely.
 */
class ArtifactStore {
	public const ROOT = 'scoreview';
	public const PAGE_MIME_TYPE = 'image/svg+xml';

	public function __construct(
		private IAppData $appData,
	) {
	}

	/**
	 * The folder at $path below `scoreview/`.
	 *
	 * @throws NotFoundException
	 */
	public function folder(string ...$path): ISimpleFolder {
		$folder = $this->appData->getFolder(self::ROOT);
		foreach ($path as $name) {
			$folder = $folder->getFolder($name);
		}
		return $folder;
	}

	/** The folder at $path below `scoreview/`, created where missing. */
	public function folderOrCreate(string ...$path): ISimpleFolder {
		try {
			$folder = $this->appData->getFolder(self::ROOT);
		} catch (NotFoundException) {
			$folder = $this->appData->newFolder(self::ROOT);
		}
		foreach ($path as $name) {
			try {
				$folder = $folder->getFolder($name);
			} catch (NotFoundException) {
				$folder = $folder->newFolder($name);
			}
		}
		return $folder;
	}

	/** Removes the folder at $path with everything in it; a missing one is fine. */
	public function delete(string ...$path): void {
		try {
			$this->folder(...$path)->delete();
		} catch (NotFoundException) {
			// Never written - nothing to remove.
		}
	}

	/**
	 * Writes page-1.svg … page-N.svg and removes the pages after them.
	 *
	 * A run into a folder that already holds an earlier one - a reconversion
	 * of the same file version after an engine update, a variant made again -
	 * would otherwise leave that run's surplus pages behind: never served
	 * (the page count says N), but never removed either until the version
	 * goes. Pages are numbered without gaps, so the first missing number ends
	 * the search.
	 *
	 * @param string[] $pageSvgs in page order
	 */
	public function writePages(ISimpleFolder $folder, array $pageSvgs): void {
		$pageSvgs = array_values($pageSvgs);
		foreach ($pageSvgs as $i => $svg) {
			$this->writeFile($folder, self::pageFileName($i + 1), $svg);
		}
		for ($number = count($pageSvgs) + 1; $folder->fileExists(self::pageFileName($number)); $number++) {
			$folder->getFile(self::pageFileName($number))->delete();
		}
	}

	public function writeFile(ISimpleFolder $folder, string $name, string $content): void {
		if ($folder->fileExists($name)) {
			$folder->getFile($name)->putContent($content);
			return;
		}
		$folder->newFile($name, $content);
	}

	/**
	 * An artifact by the name from the URL: `page-N` or a key of $named.
	 *
	 * The folder comes as a closure and is opened only once the name has
	 * passed: a name from the URL is an allowlist entry, never a path, and
	 * an unknown one does not reach the storage at all.
	 *
	 * @param array<string, array{0: string, 1: string}> $named name => [file name, MIME type]
	 * @param \Closure(): ISimpleFolder $folder
	 * @return array{0: ISimpleFile, 1: string} file and MIME type
	 * @throws NotFoundException for an unknown name or a missing file
	 */
	public function artifact(string $name, array $named, \Closure $folder): array {
		if (str_starts_with($name, 'page-')) {
			$number = self::pageNumber($name);
			if ($number === null) {
				throw new NotFoundException("Unknown artifact: {$name}");
			}
			return [$folder()->getFile(self::pageFileName($number)), self::PAGE_MIME_TYPE];
		}
		if (!isset($named[$name])) {
			throw new NotFoundException("Unknown artifact: {$name}");
		}
		[$fileName, $mimeType] = $named[$name];
		return [$folder()->getFile($fileName), $mimeType];
	}

	/**
	 * The number in `page-N`, or null for anything that is not exactly that.
	 *
	 * Digits only: `page-1.5` or `page-../x` must not slip through an (int)
	 * cast. And no leading zero - not a security question, `page-01` would
	 * resolve to the same file as `page-1`, but one of caching: every
	 * delivery is `immutable`, and the same page under two names would be
	 * the same half megabyte twice in the browser cache. The names are made
	 * on the server anyway (ConversionController::buildFileUrls()).
	 */
	public static function pageNumber(string $name): ?int {
		$number = substr($name, strlen('page-'));
		if (!str_starts_with($name, 'page-') || $number === '' || !ctype_digit($number) || (int)$number < 1 || $number !== (string)(int)$number) {
			return null;
		}
		return (int)$number;
	}

	public static function pageFileName(int $number): string {
		return "page-{$number}.svg";
	}
}
