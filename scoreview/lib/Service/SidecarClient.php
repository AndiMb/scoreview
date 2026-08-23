<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use GuzzleHttp\Exception\ClientException;
use OCA\ScoreView\Db\ScoreConversion;
use OCP\Http\Client\IClientService;
use OCP\IConfig;

/**
 * Dünner Wrapper um die Sidecar-HTTP-API (sidecar/server.py). Kein Parsen
 * von Timing-Daten hier - der Sidecar liefert timing.json bereits fertig
 * geparst, diese Klasse cached/proxy't nur Bytes (siehe Plan Phase 3).
 */
class SidecarClient {
	public const APP_ID = 'scoreview';

	public function __construct(
		private IClientService $clientService,
		private IConfig $config,
	) {
	}

	public function isConfigured(): bool {
		return $this->getBaseUrl() !== '' && $this->getSecret() !== '';
	}

	private function getBaseUrl(): string {
		return rtrim($this->config->getAppValue(self::APP_ID, 'sidecar_url', ''), '/');
	}

	private function getSecret(): string {
		return $this->config->getAppValue(self::APP_ID, 'sidecar_secret', '');
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
	 * @return array{status: string, error?: string, files?: array{musicxml: string, audio: string, timingJson: string}}
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
	 * Verfuegbarkeit/Version des vom Sidecar mitgelieferten SoundFonts
	 * (Phase 9 - siehe Service\SoundFontService fuer den Grund, warum der
	 * Sidecar das ausliefert). Antwortet bewusst mit HTTP 200 +
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
