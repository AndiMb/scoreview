<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\Recording;
use OCA\ScoreView\Db\RecordingMapper;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;

/**
 * Wo die WAVs der eigenen Aufnahmen liegen - und wie sie wieder verschwinden.
 *
 * Ablage in IAppData unter `recordings/<uid>/<fileId>/<id>.wav`, nicht in
 * Files: Nur die Aufnehmende hoert sie (S8), und in Files taeuchten sie in
 * Freigaben, Suche und Kontingent der Partitur-Eigentuemerin auf. Die Nutzerin
 * steht VOR der fileId, damit eine Kontoloeschung einen einzigen Ordner
 * entfernt.
 *
 * Das Loeschen sitzt hier und nicht verstreut in Job und Listener: Zeilen und
 * Dateien gehoeren zusammen, und wer nur eines von beiden loescht,
 * hinterlaesst entweder Leichen im Speicher oder Eintraege ohne Ton.
 */
class RecordingStorage {
	public const ROOT_FOLDER = 'recordings';

	public function __construct(
		private IAppData $appData,
		private RecordingMapper $mapper,
	) {
	}

	/**
	 * Ordner der Aufnahmen einer Nutzerin zu einer Partitur, bei Bedarf
	 * angelegt.
	 */
	public function folderFor(string $userId, int $fileId): ISimpleFolder {
		$root = $this->getOrCreate(null, self::ROOT_FOLDER);
		$byUser = $this->getOrCreate($root, $userId);
		return $this->getOrCreate($byUser, (string)$fileId);
	}

	public static function fileName(int $recordingId): string {
		return $recordingId . '.wav';
	}

	/**
	 * Legt Zeile und Datei an - die Zeile zuerst, weil erst sie die Kennung
	 * fuer den Dateinamen liefert. Scheitert das Schreiben, geht die Zeile
	 * wieder: Eine Aufnahme ohne Ton stuende sonst in der Liste und zaehlte
	 * gegen die Obergrenze.
	 *
	 * @param resource|string $wav als Strom, damit ein grosser Upload nicht
	 *                             im Speicher liegen muss (RequestBodyReader)
	 */
	public function store(Recording $recording, $wav): Recording {
		$recording = $this->mapper->insert($recording);
		try {
			$this->folderFor($recording->getUserId(), $recording->getFileId())
				->newFile(self::fileName($recording->getId()), $wav);
		} catch (\Throwable $e) {
			$this->mapper->delete($recording);
			throw $e;
		}
		return $recording;
	}

	/**
	 * @throws NotFoundException wenn die Zeile da ist, die Datei aber nicht
	 */
	public function open(Recording $recording): ISimpleFile {
		return $this->appData->getFolder(self::ROOT_FOLDER)
			->getFolder($recording->getUserId())
			->getFolder((string)$recording->getFileId())
			->getFile(self::fileName($recording->getId()));
	}

	/**
	 * Eine einzelne Aufnahme, Datei und Zeile.
	 */
	public function delete(Recording $recording): void {
		try {
			$this->open($recording)->delete();
		} catch (NotFoundException) {
			// Schon weg - die Zeile trotzdem entfernen.
		}
		$this->mapper->delete($recording);
		$userId = $recording->getUserId();
		$fileId = $recording->getFileId();
		if ($this->mapper->findByFileAndUser($fileId, $userId) === []) {
			try {
				$this->appData->getFolder(self::ROOT_FOLDER)->getFolder($userId)->getFolder((string)$fileId)->delete();
			} catch (NotFoundException) {
				// Nie angelegt oder schon weg.
			}
			$this->removeUserFolderIfUnused($userId);
		}
	}

	/**
	 * Alle Aufnahmen zu einer Datei, von allen Nutzerinnen - nur fuer den
	 * Aufraeum-Job, wenn die Datei auch aus dem Papierkorb verschwunden ist.
	 *
	 * @return int Zahl der geloeschten Zeilen
	 */
	public function deleteAllForFile(int $fileId): int {
		$userIds = $this->mapper->findUserIdsByFileId($fileId);
		foreach ($userIds as $userId) {
			try {
				$this->appData->getFolder(self::ROOT_FOLDER)->getFolder($userId)->getFolder((string)$fileId)->delete();
			} catch (NotFoundException) {
				// Zeile ohne Datei (Upload abgebrochen) - nichts zu tun.
			}
		}
		$deleted = $this->mapper->deleteByFileId($fileId);
		// Erst nach den Zeilen: Ob der Nutzerordner leer ist, sagt die Tabelle.
		foreach ($userIds as $userId) {
			$this->removeUserFolderIfUnused($userId);
		}
		return $deleted;
	}

	/**
	 * @return int[] alle fileIds, zu denen es Aufnahmen gibt
	 */
	public function findAllFileIds(): array {
		return $this->mapper->findAllFileIds();
	}

	/**
	 * Alle Aufnahmen eines geloeschten Kontos.
	 *
	 * @return int Zahl der geloeschten Zeilen
	 */
	public function deleteAllForUser(string $userId): int {
		try {
			$this->appData->getFolder(self::ROOT_FOLDER)->getFolder($userId)->delete();
		} catch (NotFoundException) {
			// Nie aufgenommen - nichts zu tun.
		}
		return $this->mapper->deleteByUserId($userId);
	}

	/**
	 * Ein leerer `recordings/<uid>/` bliebe sonst fuer immer stehen - fuer
	 * jede Person, die einmal aufgenommen und dann alles geloescht hat.
	 * Entschieden wird ueber die Tabelle (RecordingMapper::hasAnyForUser),
	 * weil ISimpleFolder keine Unterordner auflistet. Laeuft gleichzeitig ein
	 * Upload derselben Person, steht dessen Zeile schon (store() legt sie vor
	 * der Datei an) - der Ordner bleibt dann.
	 */
	private function removeUserFolderIfUnused(string $userId): void {
		if ($this->mapper->hasAnyForUser($userId)) {
			return;
		}
		try {
			$this->appData->getFolder(self::ROOT_FOLDER)->getFolder($userId)->delete();
		} catch (NotFoundException) {
			// Schon weg.
		}
	}

	private function getOrCreate(?ISimpleFolder $parent, string $name): ISimpleFolder {
		try {
			return $parent === null ? $this->appData->getFolder($name) : $parent->getFolder($name);
		} catch (NotFoundException) {
			return $parent === null ? $this->appData->newFolder($name) : $parent->newFolder($name);
		}
	}
}
