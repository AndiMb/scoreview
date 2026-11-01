<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use GuzzleHttp\Exception\ClientException;
use GuzzleHttp\Exception\ServerException;
use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreVariant;
use OCP\Http\Client\IClientService;
use OCP\IAppConfig;

/**
 * Dünner Wrapper um die Sidecar-HTTP-API (sidecar/scoreview_sidecar/app.py). Kein Parsen
 * von Timing-Daten hier - der Sidecar liefert timing.json bereits fertig
 * geparst, diese Klasse cached/proxy't nur Bytes.
 */
class SidecarClient {
	/**
	 * The codes a failed sidecar job may report as `errorCode`
	 * (sidecar/scoreview_sidecar/errors.py) - those that say something about
	 * THIS score. Anything else, or none (an image from before the field),
	 * is ERROR_CONVERSION_FAILED: an unexpected word from the sidecar must
	 * not reach Service\ClientFallback as an infrastructure code and switch
	 * every reader to the browser.
	 */
	private const JOB_ERROR_CODES = [
		ScoreConversion::ERROR_NO_PAGES,
		ScoreConversion::ERROR_TIMEOUT,
		ScoreConversion::ERROR_CONVERSION_FAILED,
	];

	public function __construct(
		private IClientService $clientService,
		private IAppConfig $appConfig,
	) {
	}

	public function isConfigured(): bool {
		return $this->getBaseUrl() !== '' && $this->getSecret() !== '';
	}

	private function getBaseUrl(): string {
		return rtrim($this->appConfig->getValueString(Application::APP_ID, ConversionConfig::SIDECAR_URL), '/');
	}

	private function getSecret(): string {
		return $this->appConfig->getValueString(Application::APP_ID, ConversionConfig::SIDECAR_SECRET);
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
	 * `$renderer` is what the sidecar converts with (ConversionBackend::
	 * sidecarRenderer()); an image from before the choice ignores the field
	 * and converts with MuseScore.
	 *
	 * @param resource $mscz Lesender Stream auf die .mscz (z.B. Node::fopen('rb'))
	 * @throws SidecarException
	 */
	public function submitConversion($mscz, string $filename, string $renderer = ConversionBackend::RENDERER_ENGINE): string {
		if (!$this->isConfigured()) {
			throw new SidecarException('Sidecar is not configured (Settings → ScoreView).', errorCode: ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
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
					[
						'name' => 'renderer',
						'contents' => $renderer,
					],
				],
			]);
		} catch (ClientException $e) {
			// 4xx: der Sidecar wurde erreicht und hat die Anfrage explizit
			// abgelehnt (falsches Secret, Upload-Groessenlimit, …) - das ist ein
			// anderer Befund als "nicht erreichbar" und verdient einen eigenen
			// Code (siehe ScoreConversion::ERROR_*).
			throw new SidecarException('Sidecar request failed: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_REJECTED);
		} catch (ServerException $e) {
			// 503 heisst beim Sidecar genau eines: Warteschlange voll. Er ist
			// also erreichbar und gesund, nur gerade ausgelastet - ein
			// Neuversuch spaeter ist die Antwort, nicht der Rueckfall auf den
			// Browser (siehe SidecarBusyException). Jedes andere 5xx bleibt
			// "nicht erreichbar".
			if ($e->getResponse()->getStatusCode() === 503) {
				throw new SidecarBusyException(
					'Sidecar busy: ' . $e->getMessage(),
					self::retryAfterSeconds($e->getResponse()->getHeaderLine('Retry-After')),
					$e,
				);
			}
			throw new SidecarException('Sidecar request failed: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		} catch (\Exception $e) {
			throw new SidecarException('Sidecar request failed: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		}
		$body = json_decode($response->getBody(), true);
		if (!is_array($body) || !isset($body['jobId'])) {
			throw new SidecarException('Sidecar response to /convert without jobId.');
		}
		return (string)$body['jobId'];
	}

	/**
	 * Retry-After in Sekunden. Der Sidecar schickt eine Zahl; die
	 * HTTP-Datumsform und alles Unlesbare werden zur Vorgabe von 30 s - der
	 * Wert, den der Sidecar selbst voreinstellt. Gedeckelt wird erst beim
	 * Einplanen (BackgroundJob\ConvertScoreJob), hier wird nur gelesen.
	 */
	/**
	 * The sidecar's own code for a failed job or variant, taken as it is -
	 * no reading of the message, which is free text and differs per
	 * renderer (E3).
	 */
	public static function jobErrorCode(mixed $reported): string {
		return is_string($reported) && in_array($reported, self::JOB_ERROR_CODES, true)
			? $reported
			: ScoreConversion::ERROR_CONVERSION_FAILED;
	}

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
			throw new SidecarException('Sidecar status request failed: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_REJECTED);
		} catch (\Exception $e) {
			throw new SidecarException('Sidecar status request failed: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		}
		$body = json_decode($response->getBody(), true);
		if (!is_array($body) || !isset($body['status'])) {
			throw new SidecarException('Sidecar response to /convert/{jobId} without status.');
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
			return ['reachable' => false, 'error' => 'No sidecar URL configured.'];
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
	 * With the engine renderer it is the converter's own self-test, the one
	 * the local path runs. An image from before the renderer choice ignores
	 * the parameter and tests MuseScore; its answer names no renderer, and
	 * that is reported as what it is - an image too old for the setting.
	 *
	 * @return array{ok: bool, error?: string, details?: array, renderer?: string}
	 */
	public function runSelfTest(string $renderer = ConversionBackend::RENDERER_ENGINE): array {
		if (!$this->isConfigured()) {
			return ['ok' => false, 'error' => 'Sidecar is not configured (Settings → ScoreView).'];
		}
		try {
			// Grosszuegiger Timeout: der Selbsttest laesst eine echte
			// MuseScore-Konvertierung laufen (gemessen ~6s fuer die
			// einseitige Testpartitur).
			$response = $this->clientService->newClient()->get($this->getBaseUrl() . '/selftest?renderer=' . rawurlencode($renderer), [
				'headers' => $this->headers(),
				'timeout' => 120,
			]);
		} catch (\Exception $e) {
			return ['ok' => false, 'error' => $e->getMessage()];
		}
		$body = json_decode($response->getBody(), true);
		if (!is_array($body) || !isset($body['ok'])) {
			return ['ok' => false, 'error' => 'Sidecar response to /selftest without an ok field (sidecar too old?).'];
		}
		$ran = $body['renderer'] ?? ConversionBackend::RENDERER_MUSESCORE;
		if ($ran !== $renderer) {
			return [
				'ok' => false,
				'renderer' => $ran,
				'error' => sprintf('The sidecar image cannot convert with "%s" - it predates that choice. Rebuild the image (sidecar/README.md).', $renderer),
			];
		}
		return $body;
	}

	/**
	 * A display variant (E19), engraved by the sidecar's engine within this
	 * call - the app asks inside the browser request that wants it
	 * (BackgroundJob\ConvertScoreJob::convertVariant()). The base's timing
	 * and measures go along: the converter checks the variant against them,
	 * as on the local path.
	 *
	 * @param resource $mscz
	 * @return array{pages: string[], timing: string, measures: string, meta: string, engine: string}
	 * @throws SidecarException
	 */
	public function convertVariant($mscz, string $filename, string $key, string $timingJson, string $measuresJson): array {
		if (!$this->isConfigured()) {
			throw new SidecarException('Sidecar is not configured (Settings → ScoreView).', errorCode: ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		}
		try {
			$response = $this->clientService->newClient()->post($this->getBaseUrl() . '/variant', [
				'headers' => $this->headers(),
				// A run measures 3-4 s; the sidecar waits up to 20 s for a
				// free slot before it says it is busy.
				'timeout' => 120,
				'multipart' => [
					['name' => 'file', 'contents' => $mscz, 'filename' => $filename],
					['name' => 'timing', 'contents' => $timingJson, 'filename' => 'timing.json'],
					['name' => 'measures', 'contents' => $measuresJson, 'filename' => 'measures.json'],
					['name' => 'key', 'contents' => $key],
				],
			]);
		} catch (ClientException $e) {
			// 404: the route is missing - an image from before the engine
			// renderer. Not the score's fault and not an outage.
			if ($e->getResponse()->getStatusCode() === 404) {
				throw new SidecarException('The sidecar image engraves no display variants yet - rebuild it (sidecar/README.md).', 0, $e, ScoreVariant::ERROR_UNSUPPORTED);
			}
			throw new SidecarException('Sidecar variant request failed: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_REJECTED);
		} catch (ServerException $e) {
			if ($e->getResponse()->getStatusCode() === 503) {
				throw new SidecarException('Sidecar busy: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_BUSY);
			}
			throw new SidecarException('Sidecar variant request failed: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		} catch (\Exception $e) {
			throw new SidecarException('Sidecar variant request failed: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		}
		$body = json_decode((string)$response->getBody(), true);
		if (!is_array($body) || !isset($body['status'])) {
			throw new SidecarException('Sidecar response to /variant without status.');
		}
		if ($body['status'] !== ScoreConversion::STATUS_READY) {
			throw new SidecarException('Variant failed in the sidecar: ' . (string)($body['error'] ?? 'unknown error'), errorCode: self::jobErrorCode($body['errorCode'] ?? null));
		}
		$files = $body['files'] ?? null;
		if (!is_array($files) || !is_array($files['pages'] ?? null) || $files['pages'] === []) {
			throw new SidecarException('The sidecar returned no page for the variant.', errorCode: ScoreConversion::ERROR_NO_PAGES);
		}
		return [
			'pages' => array_map(fn ($url) => $this->fetchFile((string)$url), array_values($files['pages'])),
			'timing' => $this->fetchFile((string)($files['timingJson'] ?? '')),
			'measures' => $this->fetchFile((string)($files['measuresJson'] ?? '')),
			'meta' => $this->fetchFile((string)($files['metaJson'] ?? '')),
			'engine' => (string)($body['engine'] ?? 'unknown'),
		];
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
			throw new SidecarException('Sidecar is not configured (Settings → ScoreView).');
		}
		$client = $this->clientService->newClient();
		try {
			$response = $client->get($this->getBaseUrl() . '/soundfont/info', [
				'headers' => $this->headers(),
			]);
		} catch (\Exception $e) {
			throw new SidecarException('Sidecar SoundFont request failed: ' . $e->getMessage(), 0, $e);
		}
		$body = json_decode($response->getBody(), true);
		if (!is_array($body) || !isset($body['available'])) {
			throw new SidecarException('Sidecar response to /soundfont/info without an available field.');
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
			throw new SidecarException('Sidecar is not configured (Settings → ScoreView).');
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
			throw new SidecarException('SoundFont download from the sidecar failed: ' . $e->getMessage(), 0, $e);
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
				'Sidecar named an unusable artifact path: ' . $relativeUrl,
				0, null, ScoreConversion::ERROR_SIDECAR_REJECTED);
		}
		$client = $this->clientService->newClient();
		try {
			$response = $client->get($this->getBaseUrl() . $relativeUrl, [
				'headers' => $this->headers(),
			]);
		} catch (ClientException $e) {
			throw new SidecarException('Sidecar file download failed: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_REJECTED);
		} catch (\Exception $e) {
			throw new SidecarException('Sidecar file download failed: ' . $e->getMessage(), 0, $e, ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		}
		return $response->getBody();
	}
}
