<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\Http\Client\IClientService;
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
 * Es gibt zwei Quellen, und die Reihenfolge ist Absicht:
 *
 * 1. **`soundfont_fetch_url`** - eine beliebige URL, von der der SERVER die
 *    Datei einmalig holt. Das ist die Quelle fuer den lokalen
 *    Konvertierungsweg (E3): ohne Sidecar gibt es kein Image, aus dem sich
 *    ein SoundFont nehmen liesse, und ohne SoundFont bleibt die App stumm.
 * 2. **Der Sidecar**, wo einer laeuft: er enthaelt bereits ein
 *    General-MIDI-SoundFont - MuseScore kann ohne eines gar kein Audio
 *    rendern -, also muss der Betreiber dafuer nichts weiter tun.
 *
 * Ausgeliefert wird in beiden Faellen von der App selbst
 * (Controller\SoundFontController), also same-origin: kein CORS, keine
 * CSP-Ausnahme fuer einen fremden Host, kein zusaetzlicher Hosting-Aufwand.
 *
 * Davon zu unterscheiden ist die Admin-Einstellung `soundfont_url`: die
 * laesst den BROWSER direkt von dort laden und umgeht diesen Cache komplett
 * (siehe ConversionController::status()).
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

	/** Einstellung: URL, von der der Server das SoundFont einmalig holt. */
	public const FETCH_URL_KEY = 'soundfont_fetch_url';

	public function __construct(
		private IAppData $appData,
		private SidecarClient $sidecarClient,
		private IAppConfig $appConfig,
		private ITempManager $tempManager,
		private IClientService $clientService,
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

		$fetchUrl = $this->getFetchUrl();
		if ($fetchUrl !== '') {
			return $this->getOrFetchFromUrl($fetchUrl, $cached);
		}

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

	public function getFetchUrl(): string {
		return trim($this->appConfig->getValueString(Application::APP_ID, self::FETCH_URL_KEY));
	}

	/**
	 * Quelle 1: eine konfigurierte URL. Geholt wird sie genau einmal je
	 * URL - die Version ist ihr Hash, nicht der Inhalt. Wer dieselbe URL mit
	 * einer anderen Datei belegt, muss die Einstellung einmal neu speichern;
	 * bei jedem Aufruf einen HEAD-Request zu schicken waere fuer eine Datei,
	 * die sich praktisch nie aendert, der teurere Fehler.
	 *
	 * @throws ConverterException wenn nichts zu holen und nichts im Cache ist
	 */
	private function getOrFetchFromUrl(string $url, ?ISimpleFile $cached): ISimpleFile {
		$version = 'url:' . substr(sha1($url), 0, 12);
		if ($cached !== null && $version === $this->getVersion()) {
			return $cached;
		}
		try {
			return $this->fetchIntoCache($version, function (string $tempPath) use ($url): void {
				// sink statt Body-als-String: ein SF3 ist ~40 MB und wuerde
				// als PHP-String am memory_limit kratzen.
				$this->clientService->newClient()->get($url, ['sink' => $tempPath, 'timeout' => 300]);
			});
		} catch (\Throwable $e) {
			// Ein nicht erreichbarer Hoster darf eine Probe nicht verstummen
			// lassen, solange schon etwas im Cache liegt - dieselbe Zusage
			// wie beim Sidecar-Ausfall.
			if ($cached !== null) {
				return $cached;
			}
			throw new ConverterException('SoundFont-Download von ' . $url . ' fehlgeschlagen: ' . $e->getMessage(), 0, $e);
		}
	}

	/**
	 * @param callable(string): void $downloadTo laedt die Datei an den uebergebenen Pfad
	 * @throws SidecarException
	 */
	private function fetchIntoCache(string $version, ?callable $downloadTo = null): ISimpleFile {
		$tempPath = $this->tempManager->getTemporaryFile('.sf3');
		if ($downloadTo !== null) {
			$downloadTo($tempPath);
		} else {
			$this->sidecarClient->downloadSoundFontTo($tempPath);
		}
		if (!is_file($tempPath) || filesize($tempPath) === 0) {
			throw new SidecarException('SoundFont-Download lieferte eine leere Datei.');
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
