<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\IAppConfig;
use OCP\ITempManager;

/**
 * Haelt das SoundFont fuer die Browser-Wiedergabe (siehe docs/architecture.md E1) vor.
 *
 * Warum ueberhaupt: Ohne SoundFont gibt es keinen Ton - die Synthese
 * passiert im Browser (E1), und ein Synthesizer ohne Sample-Bank ist
 * stumm. Bis hierher war das Beschaffen und Hosten dieses SoundFonts
 * vollstaendig Aufgabe des Betreibers (Admin-Einstellung `soundfont_url`,
 * leer = kein Ton). Das ist in der Praxis der Normalzustand geblieben: die
 * App war fuer jeden, der nicht selbst ein 40-MB-SF3 irgendwo
 * CORS-faehig hinlegt, dauerhaft stumm.
 *
 * Der Sidecar ist ohnehin zwingende Voraussetzung (E3) und enthaelt
 * bereits ein General-MIDI-SoundFont - MuseScore kann ohne eines gar kein
 * Audio rendern. Diese Klasse holt es einmalig von dort und legt es im
 * IAppData-Cache ab; ausgeliefert wird es danach von der App selbst
 * (Controller\SoundFontController), also same-origin: kein CORS, keine
 * CSP-Ausnahme fuer einen fremden Host, kein zusaetzlicher Hosting-Aufwand.
 *
 * Die Admin-Einstellung `soundfont_url` bleibt als Uebersteuerung
 * bestehen - wer ein besseres/anderes SoundFont ausliefern will, traegt es
 * dort ein und umgeht diesen Cache komplett (siehe
 * ConversionController::status()).
 */
class SoundFontService {
	/**
	 * Eigener IAppData-Ordner neben `scoreview/<fileId>/<etag>/` (siehe
	 * ConversionService) - das SoundFont gehoert zu keiner einzelnen
	 * Partitur und darf von deren etag-GC nicht mit aufgeraeumt werden.
	 */
	private const FOLDER = 'soundfont';
	private const FILE = 'soundfont.sf3';
	private const VERSION_KEY = 'soundfont_cache_version';

	public function __construct(
		private IAppData $appData,
		private SidecarClient $sidecarClient,
		private IAppConfig $appConfig,
		private ITempManager $tempManager,
	) {
	}

	/**
	 * Liefert die zwischengespeicherte Datei und holt sie beim ersten Mal
	 * (bzw. nach einem SoundFont-Wechsel im Sidecar-Image) nach.
	 *
	 * Der Versionsabgleich beim Sidecar ist bewusst bei jedem Aufruf drin
	 * und nicht nur beim ersten: er kostet eine kleine JSON-Anfrage, und
	 * die eigentliche Auslieferung passiert wegen `immutable`-Caching
	 * ohnehin hoechstens einmal pro Browser. Faellt der Sidecar aus, waehrend
	 * schon etwas im Cache liegt, wird der Cache trotzdem ausgeliefert -
	 * Wiedergabe braucht den Sidecar nicht, nur die Konvertierung.
	 *
	 * @throws SidecarException wenn kein SoundFont beschafft werden kann
	 */
	public function getOrFetch(): ISimpleFile {
		$cached = $this->findCached();

		try {
			$info = $this->sidecarClient->fetchSoundFontInfo();
		} catch (SidecarException $e) {
			if ($cached !== null) {
				return $cached;
			}
			throw $e;
		}

		if (($info['available'] ?? false) !== true) {
			if ($cached !== null) {
				return $cached;
			}
			throw new SidecarException('Der Sidecar liefert kein SoundFont aus (SCOREVIEW_SOUNDFONT_PATH im Sidecar setzen oder eine SoundFont-URL in den Einstellungen hinterlegen).');
		}

		$remoteVersion = (string)($info['version'] ?? '');
		if ($cached !== null && $remoteVersion !== '' && $remoteVersion === $this->getVersion()) {
			return $cached;
		}
		return $this->fetchIntoCache($remoteVersion);
	}

	/** Content-Hash des zwischengespeicherten SoundFonts, als HTTP-ETag verwendbar. */
	public function getVersion(): string {
		return $this->appConfig->getValueString(Application::APP_ID, self::VERSION_KEY);
	}

	private function findCached(): ?ISimpleFile {
		try {
			$file = $this->appData->getFolder(self::FOLDER)->getFile(self::FILE);
		} catch (NotFoundException) {
			return null;
		}
		// Ein abgebrochener Download koennte eine leere Datei hinterlassen
		// haben - die waere fuer den Synthesizer unbrauchbar und wuerde nur
		// zu einem stummen Player ohne erkennbare Ursache fuehren.
		return $file->getSize() > 0 ? $file : null;
	}

	/** @throws SidecarException */
	private function fetchIntoCache(string $version): ISimpleFile {
		$tempPath = $this->tempManager->getTemporaryFile('.sf3');
		$this->sidecarClient->downloadSoundFontTo($tempPath);
		if (!is_file($tempPath) || filesize($tempPath) === 0) {
			throw new SidecarException('SoundFont-Download vom Sidecar lieferte eine leere Datei.');
		}

		$folder = $this->getOrCreateFolder();
		$file = $folder->fileExists(self::FILE)
			? $folder->getFile(self::FILE)
			: $folder->newFile(self::FILE);

		// Stream-Kopie statt file_get_contents()/putContent(): der Inhalt
		// soll nie komplett als PHP-String im Speicher liegen (~40 MB).
		$source = fopen($tempPath, 'rb');
		$target = $file->write();
		try {
			stream_copy_to_stream($source, $target);
		} finally {
			fclose($source);
			if (is_resource($target)) {
				fclose($target);
			}
			unlink($tempPath);
		}

		// Erst nach dem erfolgreichen Schreiben setzen: bricht der Download
		// ab, bleibt die alte Version stehen und der naechste Aufruf
		// versucht es erneut, statt eine halbe Datei als "aktuell" zu fuehren.
		$this->appConfig->setValueString(Application::APP_ID, self::VERSION_KEY, $version);

		return $folder->getFile(self::FILE);
	}

	private function getOrCreateFolder(): ISimpleFolder {
		try {
			return $this->appData->getFolder(self::FOLDER);
		} catch (NotFoundException) {
			return $this->appData->newFolder(self::FOLDER);
		}
	}
}
