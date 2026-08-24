<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use GuzzleHttp\Exception\ClientException;
use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\ScoreConversion;
use OCP\Http\Client\IClientService;
use OCP\IAppConfig;

/**
 * Dünner Wrapper um die Sidecar-HTTP-API (sidecar/server.py). Kein Parsen
 * von Timing-Daten hier - der Sidecar liefert timing.json bereits fertig
 * geparst, diese Klasse cached/proxy't nur Bytes (siehe Plan Phase 3).
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
	 * Lädt die .mscz-Bytes hoch und startet die Konvertierung.
	 *
	 * @throws SidecarException
	 */
	public function submitConversion(string $msczContent, string $filename): string {
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
						'contents' => $msczContent,
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
	 * Health-Abfrage fuer die Admin-Anzeige (Phase 21). Bewusst gegen
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
	 * Selbsttest des Sidecars (Phase 21): konvertiert die mitgelieferte
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
			// einseitige Testpartitur, siehe PLAN.md Phase 20).
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
	 * (Phase 9 - siehe Service\SoundFontService fuer den Grund, warum der
	 * Sidecar das ausliefert). Der Sidecar antwortet bewusst mit HTTP 200 +
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

	/** @throws SidecarException */
	public function fetchFile(string $relativeUrl): string {
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
