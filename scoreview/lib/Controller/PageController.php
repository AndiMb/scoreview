<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\ClientFallback;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\UserFileResolver;
use OCA\ScoreView\Service\ViewerPolicy;
use OCA\ScoreView\Service\ViewerPreferences;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\Files\File;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Util;

/**
 * Die eigenen Seiten der App: die Offline-Seite (E14, H9) und die Druckseite
 * (E16). Beide sind kein zweiter Einstieg in Partituren - `/apps/scoreview/`
 * selbst antwortet weiter 404 (E6).
 *
 * Warum die Offline-Seite eine eigene Seite ist: Den Viewer in Files steuert
 * Nextclouds eigener Service Worker (Files, Scope `/`, gemessen M-E). Ein
 * zweiter mit demselben Scope verdraengte ihn. Einer, der NUR unter dieser
 * Seite gilt, kann sie und die vorgemerkten Partituren ohne Netz ausliefern,
 * ohne Files zu beruehren. Die Seite zeigt nur Vorgemerktes.
 *
 * Why the print page is one: the viewer in Files loads and unloads pages as
 * they scroll by (ScorePage.vue), so the browser's print of the Files page
 * would print the few pages that happen to be loaded, inside Nextcloud's
 * frame. The print page holds every page of one score at once, nothing else,
 * and is opened from the viewer - it carries no navigation of its own.
 */
class PageController extends Controller {
	public function __construct(
		IRequest $request,
		private FeatureConfig $features,
		private ViewerPreferences $preferences,
		private IUserSession $userSession,
		private IInitialState $initialState,
		private IURLGenerator $urlGenerator,
		private ViewerPolicy $viewerPolicy,
		private UserFileResolver $fileResolver,
		private ClientFallback $clientFallback,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * The print page of one score (E16). 404 for a file the session cannot
	 * see, before any other answer (S8): the page must not tell whether a
	 * fileId exists.
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function print(int $fileId): Response {
		$node = $this->fileResolver->resolveOwnNode($fileId);
		if (!$node instanceof File) {
			return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		$uid = $this->userSession->getUser()?->getUID();
		$this->initialState->provideInitialState('print', [
			'fileId' => $node->getId(),
			'fileName' => $node->getName(),
		]);
		$this->initialState->provideInitialState('features', $this->features->forViewer());
		$this->initialState->provideInitialState('viewer-preferences', $this->preferences->get($uid));
		Util::addScript(Application::APP_ID, Application::APP_ID . '-print');

		$response = new TemplateResponse(Application::APP_ID, 'print', [], TemplateResponse::RENDER_AS_BASE);
		// The same policy as the viewer: the page shows no sound, but the
		// conversion fallback (E7) runs the engine here as well - as
		// WebAssembly, from a blob worker - and only where it can apply.
		$response->setContentSecurityPolicy($this->viewerPolicy->forPage($this->clientFallback->applies()));
		return $response;
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function offline(): Response {
		if (!$this->features->isEnabled(FeatureConfig::OFFLINE)) {
			return new JSONResponse(['error' => $this->l->t('The offline page is turned off on this server.')], Http::STATUS_NOT_FOUND);
		}
		// Nur unter der Adresse, die auch der Scope des Workers ist: Unter der
		// anderen Form (mit bzw. ohne index.php) steuerte ihn der Worker nie,
		// und die Seite fiele ohne Netz aus.
		$path = parse_url($this->request->getRequestUri(), PHP_URL_PATH);
		if ($path !== $this->pageUrl()) {
			return new RedirectResponse($this->pageUrl());
		}
		$uid = $this->userSession->getUser()?->getUID();
		$this->initialState->provideInitialState('offline', [
			// Wem die vorgemerkten Eintraege gehoeren (S10): Der Cache haengt am
			// Origin, nicht am Konto - fremde loescht die Seite.
			'uid' => $uid,
			'serviceWorker' => $this->serviceWorkerUrl(),
			'scope' => $this->pageUrl(),
			'manifest' => $this->urlGenerator->linkToRoute(Application::APP_ID . '.page.manifest'),
		]);
		$this->initialState->provideInitialState('features', $this->features->forViewer());
		$this->initialState->provideInitialState('viewer-preferences', $this->preferences->get($uid));
		Util::addScript(Application::APP_ID, Application::APP_ID . '-offline');

		$response = new TemplateResponse(Application::APP_ID, 'offline', [], TemplateResponse::RENDER_AS_BASE);
		// Wie im Viewer (Service\ViewerPolicy), mit Workern immer: der Service
		// Worker gehoert zur Seite. `manifest-src 'self'` setzt Nextcloud
		// ohnehin in jede Policy.
		$response->setContentSecurityPolicy($this->viewerPolicy->forPage(true));
		return $response;
	}

	/**
	 * Das Skript des Service Workers. Oeffentlich wie Nextclouds eigene
	 * (Files, Photos): Es ist statischer Code ohne Daten, und der Browser
	 * holt es beim Aktualisieren ohne Sitzung.
	 */
	#[PublicPage]
	#[NoCSRFRequired]
	public function serviceWorker(): Response {
		if (!$this->features->isEnabled(FeatureConfig::OFFLINE)) {
			return new Response(Http::STATUS_NOT_FOUND);
		}
		$path = __DIR__ . '/../../js/scoreview-offline-sw.js';
		$code = is_file($path) ? (string)file_get_contents($path) : '';
		$response = new DataDisplayResponse($code, Http::STATUS_OK, [
			'Content-Type' => 'application/javascript; charset=utf-8',
			// Der Worker gilt nur fuer die Offline-Seite, nicht fuer sein
			// eigenes Verzeichnis - und keinesfalls fuer `/` (dort waltet Files).
			'Service-Worker-Allowed' => $this->pageUrl(),
			'Cache-Control' => 'no-cache',
		]);
		// Fuer den Worker gilt die CSP seines Skripts, nicht die der Seite:
		// Holt er ein externes SoundFont nach, braucht er die Freigabe selbst.
		$policy = new ContentSecurityPolicy();
		$policy->addAllowedConnectDomain("'self'");
		$origin = $this->viewerPolicy->soundFontOrigin();
		if ($origin !== null) {
			$policy->addAllowedConnectDomain($origin);
		}
		$response->setContentSecurityPolicy($policy);
		return $response;
	}

	/** Damit sich die Offline-Seite zum Startbildschirm hinzufuegen laesst (V8). */
	#[PublicPage]
	#[NoCSRFRequired]
	public function manifest(): Response {
		if (!$this->features->isEnabled(FeatureConfig::OFFLINE)) {
			return new Response(Http::STATUS_NOT_FOUND);
		}
		$response = new JSONResponse([
			'name' => $this->l->t('ScoreView offline'),
			'short_name' => 'ScoreView',
			'start_url' => $this->pageUrl(),
			'scope' => $this->pageUrl(),
			'display' => 'standalone',
			'icons' => [[
				'src' => $this->urlGenerator->imagePath(Application::APP_ID, 'app.svg'),
				'sizes' => 'any',
				'type' => 'image/svg+xml',
			]],
		]);
		$response->addHeader('Content-Type', 'application/manifest+json');
		return $response;
	}

	private function pageUrl(): string {
		return $this->urlGenerator->linkToRoute(Application::APP_ID . '.page.offline');
	}

	private function serviceWorkerUrl(): string {
		return $this->urlGenerator->linkToRoute(Application::APP_ID . '.page.serviceWorker');
	}
}
