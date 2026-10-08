<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\InvalidPathException;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\Files\NotEnoughSpaceException;
use OCP\Files\NotFoundException;
use OCP\Files\NotPermittedException;
use OCP\IConfig;
use OCP\L10N\IFactory;

/**
 * Uebe-Tracks als Dateien in Files (E13, H1/H10).
 *
 * Bewusst Files und nicht App-Daten wie die eigenen Aufnahmen: Ein
 * Uebe-Track ist synthetisiert, er traegt keine Stimme eines Menschen. Als
 * Datei halten ihn die Nextcloud-Apps offline vor, spielen ihn im
 * Hintergrund mit Steuerung auf dem Sperrbildschirm und teilen ihn - genau
 * das, was der Viewer im Browser nicht kann (Messung M-A).
 *
 * Geschrieben wird nur, wo die Person ohnehin schreiben darf: Die Datei
 * zaehlt gegen das Kontingent der Ordnerbesitzerin wie jede andere.
 */
class PracticeTrackService {
	public const EXTENSION = '.mp3';

	public const TARGET_FOLDER = 'folder';
	public const TARGET_SUB = 'sub';
	public const TARGET_OWN = 'own';

	public function __construct(
		private IRootFolder $rootFolder,
		private IConfig $config,
		private IFactory $l10nFactory,
	) {
	}

	/**
	 * @param resource $mp3 der gepruefte Inhalt, am Anfang
	 * @param ?int $ownFolderId nur bei TARGET_OWN: ein Ordner im Nutzerordner
	 * @return array{fileId: int, name: string, path: string}
	 * @throws PracticeTrackException
	 */
	public function save(Node $score, string $userId, $mp3, string $name, string $target, ?int $ownFolderId, bool $replace): array {
		$folder = $this->targetFolder($score, $userId, $target, $ownFolderId);
		$base = FileNames::clean($name, [self::EXTENSION]);
		if ($base === null) {
			throw new PracticeTrackException(PracticeTrackException::INVALID);
		}
		$fileName = $base . self::EXTENSION;

		// Vorher pruefen, nicht dem Schreiben ueberlassen - gemessen: Ueber die
		// Quota schreibt Nextcloud einen Stream bis an die Grenze, scheitert
		// dann mit NotPermittedException und laesst eine abgeschnittene Datei
		// zurueck. Negative Werte heissen unbegrenzt oder unbekannt.
		$size = fstat($mp3)['size'] ?? 0;
		$free = $folder->getFreeSpace();
		if ($free >= 0 && $size > $free) {
			throw new PracticeTrackException(PracticeTrackException::STORAGE_FULL);
		}

		$created = false;
		try {
			if ($folder->nodeExists($fileName)) {
				$existing = $folder->get($fileName);
				if (!$replace) {
					throw new PracticeTrackException(
						PracticeTrackException::EXISTS,
						FileNames::firstFree($base, self::EXTENSION, fn (string $n) => $folder->nodeExists($n)),
					);
				}
				if (!$existing instanceof File || !$existing->isUpdateable()) {
					throw new PracticeTrackException(PracticeTrackException::FORBIDDEN);
				}
				$existing->putContent($mp3);
				$file = $existing;
			} else {
				if (!$folder->isCreatable()) {
					throw new PracticeTrackException(PracticeTrackException::FORBIDDEN);
				}
				$created = true;
				$file = $folder->newFile($fileName, $mp3);
			}
		} catch (NotEnoughSpaceException) {
			$this->removePartial($folder, $fileName, $created);
			throw new PracticeTrackException(PracticeTrackException::STORAGE_FULL);
		} catch (NotPermittedException) {
			$this->removePartial($folder, $fileName, $created);
			throw new PracticeTrackException(PracticeTrackException::FORBIDDEN);
		} catch (InvalidPathException|NotFoundException) {
			// Ein Name, den diese Instanz nicht zulaesst (verbotene Zeichen
			// wie `:` bei Windows-kompatiblen Namen, zu lang), oder die Datei
			// verschwand zwischen Pruefen und Lesen: 400 statt 500.
			throw new PracticeTrackException(PracticeTrackException::INVALID);
		}

		$userFolder = $this->rootFolder->getUserFolder($userId);
		return [
			'fileId' => (int)$file->getId(),
			'name' => $file->getName(),
			'path' => rtrim($userFolder->getRelativePath($file->getPath()) ?? '', '/'),
		];
	}

	/**
	 * Was ein gescheitertes Neuanlegen hinterliess, wieder weg - eine halbe
	 * MP3 waere schlimmer als keine. Eine ersetzte Datei bleibt (ihre
	 * vorige Fassung liegt in den Versionen).
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
			// Aufraeumen ist Kuer - der eigentliche Fehler geht ohnehin zurueck.
		}
	}

	/** Eine Partitur, kein Ordner und keine beliebige Datei. */
	public static function isScore(?Node $node): bool {
		return $node instanceof File && $node->getMimetype() === Application::MSCZ_MIMETYPE;
	}

	/**
	 * Ob die Person neben der Partitur anlegen darf - fuer den Statusendpunkt,
	 * damit der Viewer „Tracks fuer alle Stimmen" nur anbietet, wo es geht.
	 */
	public static function canWriteNextTo(Node $score): bool {
		if (!self::isScore($score)) {
			return false;
		}
		try {
			return $score->getParent()->isCreatable();
		} catch (\Throwable) {
			return false;
		}
	}

	/**
	 * Der Ordnername fuer die Tracks aller Stimmen (V4): in der
	 * Voreinstellungssprache der Instanz, nicht in der der Person. Ein
	 * geteilter Ordner soll fuer den ganzen Chor gleich heissen und nicht je
	 * nach Sprache doppelt entstehen.
	 */
	public function subfolderName(): string {
		$language = $this->config->getSystemValueString('default_language', 'en');
		$l = $this->l10nFactory->get(Application::APP_ID, $language);
		return $l->t('Practice tracks');
	}

	/**
	 * @throws PracticeTrackException
	 */
	private function targetFolder(Node $score, string $userId, string $target, ?int $ownFolderId): Folder {
		try {
			return match ($target) {
				self::TARGET_FOLDER => $score->getParent(),
				self::TARGET_SUB => $this->subfolder($score->getParent()),
				self::TARGET_OWN => $this->ownFolder($userId, $ownFolderId),
				default => throw new PracticeTrackException(PracticeTrackException::INVALID),
			};
		} catch (NotFoundException) {
			throw new PracticeTrackException(PracticeTrackException::INVALID);
		} catch (NotPermittedException) {
			throw new PracticeTrackException(PracticeTrackException::FORBIDDEN);
		}
	}

	/**
	 * Den Unterordner neben der Partitur - angelegt, wenn es ihn noch nicht
	 * gibt. Eine gleichnamige DATEI dort ist ein Fehler, kein Ordner.
	 *
	 * @throws PracticeTrackException
	 */
	private function subfolder(Folder $parent): Folder {
		$name = $this->subfolderName();
		if ($parent->nodeExists($name)) {
			$node = $parent->get($name);
			if (!$node instanceof Folder) {
				throw new PracticeTrackException(PracticeTrackException::INVALID);
			}
			return $node;
		}
		if (!$parent->isCreatable()) {
			throw new PracticeTrackException(PracticeTrackException::FORBIDDEN);
		}
		return $parent->newFolder($name);
	}

	/**
	 * Ein selbst gewaehlter Ordner - nur im eigenen Nutzerordner, nie ein
	 * Pfad aus der Anfrage (S6).
	 *
	 * @throws PracticeTrackException
	 */
	private function ownFolder(string $userId, ?int $folderId): Folder {
		if ($folderId === null) {
			throw new PracticeTrackException(PracticeTrackException::INVALID);
		}
		$node = $this->rootFolder->getUserFolder($userId)->getById($folderId)[0] ?? null;
		if (!$node instanceof Folder) {
			throw new PracticeTrackException(PracticeTrackException::INVALID);
		}
		return $node;
	}

	/**
	 * Ob der Anfang eines Stroms nach MP3 aussieht: ein ID3-Kopf oder ein
	 * MPEG-Frame-Sync (11 gesetzte Bits) in den ersten 4 KB. Mehr prueft der
	 * Server nicht - die Datei landet als gewoehnliche Datei in Files, die
	 * Nextcloud ohnehin nie ausfuehrt. Die Pruefung haelt nur Versehen fern
	 * (etwa ein WAV unter falschem Namen).
	 *
	 * @param resource $stream wird danach wieder an den Anfang gesetzt
	 */
	public static function looksLikeMp3($stream): bool {
		$head = (string)fread($stream, 4096);
		rewind($stream);
		if (str_starts_with($head, 'ID3')) {
			return true;
		}
		$length = strlen($head);
		for ($i = 0; $i + 1 < $length; $i++) {
			if (ord($head[$i]) === 0xFF && (ord($head[$i + 1]) & 0xE0) === 0xE0) {
				return true;
			}
		}
		return false;
	}
}
