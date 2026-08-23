<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\SidecarException;
use OCA\ScoreView\Service\SoundFontService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\StreamResponse;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * Liefert das SoundFont fuer die Browser-Wiedergabe aus (Phase 9/E1) -
 * bewusst als eigener Controller und nicht in ConversionController: das
 * SoundFont haengt an keiner fileId und durchlaeuft deshalb auch keine der
 * dortigen Datei-/Rechtepruefungen.
 *
 * Zugriff fuer jede eingeloggte Nutzerin (#[NoAdminRequired]) - es ist
 * appeigenes, statisches Beiwerk wie ein Bundle oder ein Icon, kein
 * Nutzerinhalt.
 *
 * Warum die App das selbst ausliefert statt den Browser direkt zum
 * SoundFont-Host zu schicken: same-origin. Kein CORS-Problem, keine
 * CSP-connect-src-Ausnahme, und vor allem nichts, was ein Betreiber erst
 * einrichten muss, bevor die App ueberhaupt Ton macht (siehe
 * Service\SoundFontService).
 */
class SoundFontController extends Controller {
	/** Wie in ConversionController: der Inhalt ist fuer eine Version unveraenderlich. */
	private const IMMUTABLE_CACHE_SECONDS = 31536000;

	public function __construct(
		IRequest $request,
		private SoundFontService $soundFontService,
		private LoggerInterface $logger,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function get(): Http\Response {
		try {
			$file = $this->soundFontService->getOrFetch();
		} catch (SidecarException $e) {
			$this->logger->warning('ScoreView: SoundFont konnte nicht bereitgestellt werden: {message}', [
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
			// 503, nicht 404: das SoundFont ist nicht "gibt es nicht",
			// sondern "gerade nicht beschaffbar" - der Viewer zeigt die
			// Meldung an und bleibt ohne Ton benutzbar (ScoreViewer.vue).
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_SERVICE_UNAVAILABLE);
		}

		$response = new StreamResponse($file->read());
		$response->addHeader('Content-Type', 'application/octet-stream');
		$response->addHeader('Content-Length', (string)$file->getSize());
		$version = $this->soundFontService->getVersion();
		if ($version !== '') {
			$response->setETag($version);
		}
		$response->cacheFor(self::IMMUTABLE_CACHE_SECONDS, false, true);
		return $response;
	}
}
