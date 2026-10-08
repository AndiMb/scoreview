<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\FeatureConfig;
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
use OCP\IAppConfig;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Util;

/**
 * Die Offline-Seite (E14, H9) - die einzige eigene Seite der App.
 *
 * Warum eine eigene Seite: Den Viewer in Files steuert Nextclouds eigener
 * Service Worker (Files, Scope `/`, gemessen M-E). Ein zweiter mit demselben
 * Scope verdraengte ihn. Einer, der NUR unter dieser Seite gilt, kann sie
 * und die vorgemerkten Partituren ohne Netz ausliefern, ohne Files zu
 * beruehren. `/apps/scoreview/` selbst antwortet weiter 404 (E6); diese
 * Seite zeigt nur Vorgemerktes und ist kein zweiter Einstieg in Partituren.
 */
class PageController extends Controller {
	public function __construct(
		IRequest $request,
		private FeatureConfig $features,
		private ViewerPreferences $preferences,
		private IUserSession $userSession,
		private IInitialState $initialState,
		private IURLGenerator $urlGenerator,
		private IAppConfig $appConfig,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
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
		$policy = new ContentSecurityPolicy();
		// Wie im Viewer (Listener\AddCspListener): Der Klang dekodiert sein
		// SoundFont mit WebAssembly; Worker fuer den Service Worker selbst.
		// `manifest-src 'self'` setzt Nextcloud ohnehin in jede Policy.
		$policy->allowEvalWasm(true);
		$policy->addAllowedWorkerSrcDomain("'self'");
		$policy->addAllowedWorkerSrcDomain('blob:');
		$this->allowSoundFont($policy);
		$response->setContentSecurityPolicy($policy);
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
		$this->allowSoundFont($policy);
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

	private function allowSoundFont(ContentSecurityPolicy $policy): void {
		$origin = self::origin($this->appConfig->getValueString(Application::APP_ID, 'soundfont_url'));
		if ($origin !== null) {
			$policy->addAllowedConnectDomain($origin);
		}
	}

	private function pageUrl(): string {
		return $this->urlGenerator->linkToRoute(Application::APP_ID . '.page.offline');
	}

	private function serviceWorkerUrl(): string {
		return $this->urlGenerator->linkToRoute(Application::APP_ID . '.page.serviceWorker');
	}

	/** Schema und Host einer Adresse - fuer connect-src. */
	public static function origin(string $url): ?string {
		$parts = parse_url(trim($url));
		if (!is_array($parts) || !isset($parts['scheme'], $parts['host']) || !in_array($parts['scheme'], ['http', 'https'], true)) {
			return null;
		}
		return $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
	}
}
