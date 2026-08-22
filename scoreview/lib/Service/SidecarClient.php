<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

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
			throw new SidecarException('Sidecar ist nicht konfiguriert (Einstellungen → ScoreView).');
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
		} catch (\Exception $e) {
			throw new SidecarException('Sidecar-Anfrage fehlgeschlagen: ' . $e->getMessage(), 0, $e);
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
		} catch (\Exception $e) {
			throw new SidecarException('Sidecar-Statusabfrage fehlgeschlagen: ' . $e->getMessage(), 0, $e);
		}
		$body = json_decode($response->getBody(), true);
		if (!is_array($body) || !isset($body['status'])) {
			throw new SidecarException('Sidecar-Antwort auf /convert/{jobId} ohne status.');
		}
		return $body;
	}

	/** @throws SidecarException */
	public function fetchFile(string $relativeUrl): string {
		$client = $this->clientService->newClient();
		try {
			$response = $client->get($this->getBaseUrl() . $relativeUrl, [
				'headers' => $this->headers(),
			]);
		} catch (\Exception $e) {
			throw new SidecarException('Sidecar-Dateiabruf fehlgeschlagen: ' . $e->getMessage(), 0, $e);
		}
		return $response->getBody();
	}
}
