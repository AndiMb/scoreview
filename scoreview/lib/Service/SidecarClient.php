<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use GuzzleHttp\Exception\ClientException;
use GuzzleHttp\Exception\ServerException;
use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\ScoreConversion;
use OCP\Http\Client\IClientService;
use OCP\IAppConfig;

/**
 * Dünner Wrapper um die Sidecar-HTTP-API (sidecar/server.py). Kein Parsen
 * von Timing-Daten hier - der Sidecar liefert timing.json bereits fertig
 * geparst, diese Klasse cached/proxy't nur Bytes.
 */
class SidecarClient {
	public function __construct(
		private IClientService $clientService,
		private IAppConfig $appConfig,
	) {
	}

	public function isConfigured(): bool {
		return $this->getBaseUrl() !== '' && $this->getSecret() !== '';
	}

	private function getBaseUrl(): string {
		return rtrim($this->appConfig->getValueString(Application::APP_ID, 'sidecar_url'), '/');
	}

	private function getSecret(): string {
		return $this->appConfig->getValueString(Application::APP_ID, 'sidecar_secret');
	}

	private function headers(): array {
		return ['X-ScoreView-Secret' => $this->getSecret()];
	}

	/**
	 * Lädt die .mscz hoch und startet die Konvertierung.
	 *
	 * `$mscz` ist ein **Stream**, kein String: Guzzle
	 * schiebt ihn direkt in den Multipart-Body, statt dass die ganze Datei
	 * erst als PHP-String im Speicher landet und für den Body ein zweites Mal
	 * kopiert wird. Bei der Größenordnung, die der Sidecar erlaubt, kippte ein
	 * Worker mit üblichem `memory_limit` vorher - und zwar als unspezifischer
	 * Fatal Error, nicht als Konvertierungsfehler mit Code.
	 *
	 * @param resource $mscz Lesender Stream auf die .mscz (z.B. Node::fopen('rb'))
	 * @throws SidecarException
	 */
	public function submitConversion($mscz, string $filename): string {
		if (!$this->isConfigured()) {
			throw new SidecarException('Sidecar ist nicht konfiguriert (Einstellungen → ScoreView).', errorCode: ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		}
		$client = $this->clientService->newClient();
		try {
			$response = $client->post($this->getBaseUrl() . '/convert', [
				'headers' => $this->headers(),
				'multipart' => [
					[
						'name' => 'file',
						'contents' => $mscz,
						'filename' => $filename,
					],
				],
			]);
		} catch (ClientException $e) {
			// 4xx: der Sidecar wurde erreicht und hat die Anfrage explizit
			// abgelehnt (falsches Secret, Upload-Groessenlimit, …) - das ist ein
			// anderer Befund als "nicht erreichbar" und verdient einen eigenen
			// Code (siehe ScoreConversion::ERROR_*).
			throw new SidecarException('Sidecar-Anfrage fehlgeschlagen: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_REJECTED);
		} catch (ServerException $e) {
			// 503 heisst beim Sidecar genau eines: Warteschlange voll. Er ist
			// also erreichbar und gesund, nur gerade ausgelastet - ein
			// Neuversuch spaeter ist die Antwort, nicht der Rueckfall auf den
			// Browser (siehe SidecarBusyException). Jedes andere 5xx bleibt
			// "nicht erreichbar".
			if ($e->getResponse()->getStatusCode() === 503) {
				throw new SidecarBusyException(
					'Sidecar ausgelastet: ' . $e->getMessage(),
					self::retryAfterSeconds($e->getResponse()->getHeaderLine('Retry-After')),
					$e,
				);
			}
			throw new SidecarException('Sidecar-Anfrage fehlgeschlagen: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		} catch (\Exception $e) {
			throw new SidecarException('Sidecar-Anfrage fehlgeschlagen: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		}
		$body = json_decode($response->getBody(), true);
		if (!is_array($body) || !isset($body['jobId'])) {
			throw new SidecarException('Sidecar-Antwort auf /convert ohne jobId.');
		}
		return (string)$body['jobId'];
	}

	/**
	 * Retry-After in Sekunden. Der Sidecar schickt eine Zahl; die
	 * HTTP-Datumsform und alles Unlesbare werden zur Vorgabe von 30 s - der
	 * Wert, den der Sidecar selbst voreinstellt. Gedeckelt wird erst beim
	 * Einplanen (BackgroundJob\ConvertScoreJob), hier wird nur gelesen.
	 */
	public static function retryAfterSeconds(string $header): int {
		$header = trim($header);
		return ctype_digit($header) ? (int)$header : 30;
	}

	/**
	 * Die `files`-Pfade sind sidecar-relativ und werden unveraendert an
	 * fetchFile() zurueckgereicht (siehe BackgroundJob\PollConversionJob).
	 *
	 * @return array{status: string, error?: string, files?: array{pages: string[], midi: string, timingJson: string, measuresJson: string, metaJson: string}}
	 * @throws SidecarException
	 */
	public function pollStatus(string $jobId): array {
		$client = $this->clientService->newClient();
		try {
			$response = $client->get($this->getBaseUrl() . "/convert/{$jobId}", [
				'headers' => $this->headers(),
			]);
		} catch (ClientException $e) {
			throw new SidecarException('Sidecar-Statusabfrage fehlgeschlagen: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_REJECTED);
		} catch (\Exception $e) {
			throw new SidecarException('Sidecar-Statusabfrage fehlgeschlagen: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		}
		$body = json_decode($response->getBody(), true);
		if (!is_array($body) || !isset($body['status'])) {
			throw new SidecarException('Sidecar-Antwort auf /convert/{jobId} ohne status.');
		}
		return $body;
	}

	/**
	 * Health-Abfrage fuer die Admin-Anzeige. Bewusst gegen
	 * `/health` statt gegen einen der Arbeits-Endpunkte: `/health` verlangt
	 * als einziger Endpunkt KEIN Secret (siehe sidecar/README.md), damit
	 * laesst sich "Sidecar laeuft ueberhaupt" von "Secret stimmt nicht"
	 * unterscheiden - genau die Unterscheidung, die bei einer Fehlersuche
	 * ohne Logzugriff fehlt. `/selftest` wird davon getrennt abgefragt.
	 *
	 * @return array{reachable: bool, error?: string}
	 */
	public function checkHealth(): array {
		if ($this->getBaseUrl() === '') {
			return ['reachable' => false, 'error' => 'Keine Sidecar-URL konfiguriert.'];
		}
		try {
			$response = $this->clientService->newClient()->get($this->getBaseUrl() . '/health', ['timeout' => 5]);
			return ['reachable' => trim((string)$response->getBody()) === 'ok'];
		} catch (\Exception $e) {
			return ['reachable' => false, 'error' => $e->getMessage()];
		}
	}

	/**
	 * Selbsttest des Sidecars: konvertiert die mitgelieferte
	 * Minipartitur und meldet, ob `--score-media` im aktuellen Image noch
	 * das erwartete Ergebnis liefert. Antwort ist bewusst auch im
	 * Negativfall HTTP 200 mit `ok: false` - ein 5xx waere von "Sidecar
	 * nicht erreichbar" nicht zu unterscheiden.
	 *
	 * @return array{ok: bool, error?: string, details?: array}
	 */
	public function runSelfTest(): array {
		if (!$this->isConfigured()) {
			return ['ok' => false, 'error' => 'Sidecar ist nicht konfiguriert (Einstellungen → ScoreView).'];
		}
		try {
			// Grosszuegiger Timeout: der Selbsttest laesst eine echte
			// MuseScore-Konvertierung laufen (gemessen ~6s fuer die
			// einseitige Testpartitur).
			$response = $this->clientService->newClient()->get($this->getBaseUrl() . '/selftest', [
				'headers' => $this->headers(),
				'timeout' => 120,
			]);
		} catch (\Exception $e) {
			return ['ok' => false, 'error' => $e->getMessage()];
		}
		$body = json_decode($response->getBody(), true);
		if (!is_array($body) || !isset($body['ok'])) {
			return ['ok' => false, 'error' => 'Sidecar-Antwort auf /selftest ohne ok-Feld (zu alter Sidecar?).'];
		}
		return $body;
	}

	/**
	 * Verfuegbarkeit/Version des vom Sidecar mitgelieferten SoundFonts
	 * (siehe Service\SoundFontService fuer den Grund, warum der Sidecar
	 * das ausliefert). Der Sidecar antwortet bewusst mit HTTP 200 +
	 * `available: false` statt 404, wenn das Image keins hat: ein 404 waere
	 * fuer Guzzle ein Fehler und liesse sich hier nicht mehr von einem
	 * echten Verbindungsproblem unterscheiden.
	 *
	 * @return array{available: bool, name?: string, size?: int, version?: string}
	 * @throws SidecarException
	 */
	public function fetchSoundFontInfo(): array {
		if (!$this->isConfigured()) {
			throw new SidecarException('Sidecar ist nicht konfiguriert (Einstellungen → ScoreView).');
		}
		$client = $this->clientService->newClient();
		try {
			$response = $client->get($this->getBaseUrl() . '/soundfont/info', [
				'headers' => $this->headers(),
			]);
		} catch (\Exception $e) {
			throw new SidecarException('Sidecar-Abfrage des SoundFonts fehlgeschlagen: ' . $e->getMessage(), 0, $e);
		}
		$body = json_decode($response->getBody(), true);
		if (!is_array($body) || !isset($body['available'])) {
			throw new SidecarException('Sidecar-Antwort auf /soundfont/info ohne available-Feld.');
		}
		return $body;
	}

	/**
	 * Laedt den SoundFont in eine lokale Datei statt in einen PHP-String -
	 * ein SF3 ist ~40 MB und wuerde als String unnoetig am memory_limit
	 * kratzen. Guzzles `sink` schreibt den Body direkt streamend dorthin.
	 *
	 * @throws SidecarException
	 */
	public function downloadSoundFontTo(string $targetPath): void {
		if (!$this->isConfigured()) {
			throw new SidecarException('Sidecar ist nicht konfiguriert (Einstellungen → ScoreView).');
		}
		$client = $this->clientService->newClient();
		try {
			$client->get($this->getBaseUrl() . '/soundfont', [
				'headers' => $this->headers(),
				'sink' => $targetPath,
				// Deutlich groesser als der Default: 40 MB ueber eine langsame
				// Verbindung zwischen zwei Containern darf nicht mittendrin
				// abbrechen.
				'timeout' => 120,
			]);
		} catch (\Exception $e) {
			throw new SidecarException('SoundFont-Download vom Sidecar fehlgeschlagen: ' . $e->getMessage(), 0, $e);
		}
	}

	/**
	 * Wie ein Artefaktpfad aussehen darf, den der Sidecar selbst genannt hat.
	 *
	 * Der Pfad stammt aus der ANTWORT des Sidecars
	 * (BackgroundJob\PollConversionJob::fetchAndStore) und wird unten an die
	 * Basis-URL gehaengt - reine Zeichenverkettung, kein Aufloesen relativer
	 * URLs. Ein fuehrendes `@` machte daraus eine FREMDE Adresse:
	 * `http://sidecar:8765` + `@example.invalid/x` ergibt nach RFC 3986 den
	 * Host `example.invalid` mit `sidecar:8765` als Userinfo - und das Secret
	 * ginge im Header mit. Dasselbe gilt fuer `//host/x` (netzwerkrelativ)
	 * und `:` (eigenes Schema).
	 *
	 * Der Lookahead gegen den ZWEITEN Schraegstrich steht ausdruecklich da:
	 * `/` gehoert in die Zeichenklasse (ein Artefaktpfad hat mehrere Ebenen),
	 * und ohne ihn waere `//example.invalid/x` ein gueltiger „Pfad" -
	 * nachgemessen, die erste Fassung dieser Zeile liess ihn durch. `..`
	 * faellt getrennt heraus: Der Ausdruck braucht Punkte, aber keine
	 * Aufstiege.
	 *
	 * Der Modifikator `D` gehoert dazu: Ohne ihn passt `$` auch VOR einem
	 * abschliessenden Zeilenumbruch, und `/x\n` ginge als Pfad durch - ein
	 * Steuerzeichen in einer URL, die mit dem Secret im Header abgerufen wird.
	 *
	 * Der Sidecar ist ein vertrauter Dienst. Diese Zeilen sorgen dafuer, dass
	 * er es bleiben MUSS, statt dass es nur niemand ausprobiert.
	 */
	private const ARTEFAKTPFAD = '#^/(?!/)[A-Za-z0-9/_.\-]*$#D';

	/** @throws SidecarException */
	public function fetchFile(string $relativeUrl): string {
		if (preg_match(self::ARTEFAKTPFAD, $relativeUrl) !== 1 || str_contains($relativeUrl, '..')) {
			throw new SidecarException(
				'Sidecar nannte einen unbrauchbaren Artefaktpfad: ' . $relativeUrl,
				0, null, ScoreConversion::ERROR_SIDECAR_REJECTED);
		}
		$client = $this->clientService->newClient();
		try {
			$response = $client->get($this->getBaseUrl() . $relativeUrl, [
				'headers' => $this->headers(),
			]);
		} catch (ClientException $e) {
			throw new SidecarException('Sidecar-Dateiabruf fehlgeschlagen: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_REJECTED);
		} catch (\Exception $e) {
			throw new SidecarException('Sidecar-Dateiabruf fehlgeschlagen: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		}
		return $response->getBody();
	}
}
