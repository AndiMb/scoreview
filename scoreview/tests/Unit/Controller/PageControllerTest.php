<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\PageController;
use OCA\ScoreView\Service\ClientFallback;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\PublicShareAccess;
use OCA\ScoreView\Service\PublicShareException;
use OCA\ScoreView\Service\PublicShareGrant;
use OCA\ScoreView\Service\ViewerPolicy;
use OCA\ScoreView\Service\ViewerPreferences;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\Node;
use OCP\IAppConfig;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserSession;
use OCP\Util;
use PHPUnit\Framework\TestCase;

/**
 * Die Offline-Seite (E14): Mit dem Schalter aus antwortet alles 404; der
 * Service Worker darf nur die Offline-Seite steuern (Service-Worker-Allowed),
 * und die Seite gibt der CSP nur frei, was Klang und Worker brauchen.
 *
 * The print page (E16): a file the session cannot see is a 404 before
 * anything else (S8); a visible one gets its name and the viewer's policy.
 *
 * The page for visitors of a public link: framed by the link page, guest
 * state instead of an account, and a plain error page - without the viewer
 * bundle - for a link that does not open the score.
 */
class PageControllerTest extends TestCase {
	use ScoreDoubles;

	/** @var array<string, bool> */
	private array $bools = [];
	private string $soundFontUrl = '';
	/** @var array<string, mixed> */
	private array $states = [];
	private string $requestUri = '/index.php/apps/scoreview/offline';
	private ?Node $ownFile = null;
	private bool $clientFallback = false;
	/** What PublicShareAccess::grant() answers: a grant, or the refusal to throw. */
	private PublicShareGrant|PublicShareException|null $grant = null;
	/** @var list<array{0: string, 1: ?int}> */
	private array $grantCalls = [];

	protected function setUp(): void {
		// Util keeps the scripts of the page in a static list - reset, so
		// one test cannot see the scripts of another.
		(new \ReflectionProperty(Util::class, 'scripts'))->setValue(null, []);
	}

	private function controller(): PageController {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueBool')->willReturnCallback(
			fn (string $app, string $key, bool $default = false) => $this->bools[$key] ?? $default,
		);
		$appConfig->method('getValueString')->willReturnCallback(
			fn (string $app, string $key, string $default = '') => $key === 'soundfont_url' ? $this->soundFontUrl : $default,
		);
		$appConfig->method('getValueInt')->willReturnCallback(
			fn (string $app, string $key, int $default = 0) => $default,
		);
		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('anna');
		$session = $this->createMock(IUserSession::class);
		$session->method('getUser')->willReturn($user);
		$state = $this->createMock(IInitialState::class);
		$state->method('provideInitialState')->willReturnCallback(function (string $key, $value): void {
			$this->states[$key] = $value;
		});
		$url = $this->createMock(IURLGenerator::class);
		$url->method('linkToRoute')->willReturnCallback(fn (string $route) => match ($route) {
			'scoreview.page.offline' => '/index.php/apps/scoreview/offline',
			'scoreview.page.serviceWorker' => '/index.php/apps/scoreview/offline/sw.js',
			default => '/index.php/apps/scoreview/offline/manifest.webmanifest',
		});
		$url->method('imagePath')->willReturn('/apps/scoreview/img/app.svg');
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);

		$request = $this->createMock(IRequest::class);
		$request->method('getRequestUri')->willReturnCallback(fn () => $this->requestUri);

		$resolver = $this->resolverDouble();
		$resolver->method('resolveOwnNode')->willReturnCallback(fn (int $fileId) => $fileId === 42 ? $this->ownFile : null);
		$fallback = $this->createMock(ClientFallback::class);
		$fallback->method('applies')->willReturnCallback(fn () => $this->clientFallback);
		$preferences = $this->createMock(ViewerPreferences::class);
		$preferences->method('get')->willReturnCallback(fn (?string $uid) => ['for' => $uid]);
		$shares = $this->createMock(PublicShareAccess::class);
		$shares->method('grant')->willReturnCallback(function (string $token, ?int $fileId) {
			$this->grantCalls[] = [$token, $fileId];
			if ($this->grant instanceof PublicShareException) {
				throw $this->grant;
			}
			return $this->grant;
		});

		return new PageController(
			$request,
			new FeatureConfig($appConfig),
			$preferences,
			$session,
			$state,
			$url,
			new ViewerPolicy($appConfig),
			$resolver,
			$fallback,
			$l,
			$shares,
		);
	}

	private function file(): File {
		$file = $this->createMock(File::class);
		$file->method('getId')->willReturn(42);
		$file->method('getName')->willReturn('Aequale.mscz');
		return $file;
	}

	public function testSchalterAusHeisst404(): void {
		$this->bools[FeatureConfig::OFFLINE] = false;
		$c = $this->controller();
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->offline()->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->serviceWorker()->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->manifest()->getStatus());
	}

	public function testSeiteTraegtUidUndEigeneCsp(): void {
		$this->soundFontUrl = 'https://cdn.example.org:8443/fonts/GeneralUser.sf2';
		$response = $this->controller()->offline();
		$this->assertInstanceOf(TemplateResponse::class, $response);
		$this->assertSame('offline', $response->getTemplateName());
		$this->assertSame('anna', $this->states['offline']['uid']);
		$this->assertSame('/index.php/apps/scoreview/offline', $this->states['offline']['scope']);
		$csp = $response->getContentSecurityPolicy()->buildPolicy();
		$this->assertStringContainsString("'wasm-unsafe-eval'", $csp);
		$this->assertMatchesRegularExpression("/worker-src [^;]*'self'[^;]*blob:/", $csp);
		$this->assertMatchesRegularExpression("/manifest-src [^;]*'self'/", $csp);
		$this->assertMatchesRegularExpression('#connect-src [^;]*https://cdn\.example\.org:8443#', $csp);
		$this->assertStringNotContainsString('microphone', $csp);
	}

	public function testAndereFormDerAdresseLeitetUm(): void {
		$this->requestUri = '/apps/scoreview/offline?x=1';
		$response = $this->controller()->offline();
		$this->assertInstanceOf(RedirectResponse::class, $response);
		$this->assertSame('/index.php/apps/scoreview/offline', $response->getRedirectURL());
	}

	public function testWorkerGiltNurFuerDieOfflineSeite(): void {
		$this->soundFontUrl = 'https://cdn.example.org/gm.sf3';
		$response = $this->controller()->serviceWorker();
		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		// getHeaders() braucht den Server-Container; die eigenen Header
		// stehen im Feld der Basisklasse.
		$headers = (new \ReflectionProperty(Http\Response::class, 'headers'))->getValue($response);
		$this->assertSame('/index.php/apps/scoreview/offline', $headers['Service-Worker-Allowed']);
		$this->assertStringStartsWith('application/javascript', $headers['Content-Type']);
		$this->assertSame('no-cache', $headers['Cache-Control']);
		// The worker fetches the SoundFont itself - the page's policy does not
		// apply to it.
		$this->assertMatchesRegularExpression('#connect-src [^;]*https://cdn\.example\.org#', $response->getContentSecurityPolicy()->buildPolicy());
	}

	public function testManifestStartetAufDerOfflineSeite(): void {
		$data = $this->controller()->manifest()->getData();
		$this->assertSame('/index.php/apps/scoreview/offline', $data['start_url']);
		$this->assertSame($data['start_url'], $data['scope']);
		$this->assertSame('standalone', $data['display']);
	}

	// --- print page ----------------------------------------------

	public function testPrintIs404ForAFileTheSessionCannotSee(): void {
		$this->ownFile = $this->file();
		$c = $this->controller();
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->print(43)->getStatus());
		$this->assertArrayNotHasKey('print', $this->states);
	}

	public function testPrintIs404ForAFolder(): void {
		// resolveOwnNode() answers with whatever node carries the id; a folder
		// is not a score, and the page would have nothing to show.
		$this->ownFile = $this->createMock(Folder::class);
		$c = $this->controller();
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->print(42)->getStatus());
		$this->assertArrayNotHasKey('print', $this->states);
	}

	public function testPrintCarriesTheFileAndTheViewerPolicy(): void {
		$this->ownFile = $this->file();
		$this->soundFontUrl = 'https://cdn.example.org/gm.sf3';
		$response = $this->controller()->print(42);
		$this->assertInstanceOf(TemplateResponse::class, $response);
		$this->assertSame('print', $response->getTemplateName());
		$this->assertSame(TemplateResponse::RENDER_AS_BASE, $response->getRenderAs());
		$this->assertSame(['fileId' => 42, 'fileName' => 'Aequale.mscz'], $this->states['print']);
		$this->assertArrayHasKey('features', $this->states);
		$this->assertArrayHasKey('viewer-preferences', $this->states);
		$csp = $response->getContentSecurityPolicy()->buildPolicy();
		$this->assertStringContainsString("'wasm-unsafe-eval'", $csp);
		$this->assertMatchesRegularExpression('#connect-src [^;]*https://cdn\.example\.org#', $csp);
		// A healthy server converts itself: no blob workers on this page
		// (`img-src blob:` is Nextcloud's own default and stays).
		$this->assertDoesNotMatchRegularExpression('/worker-src [^;]*blob:/', $csp);
		$this->assertDoesNotMatchRegularExpression('/connect-src [^;]*blob:/', $csp);
	}

	public function testPrintAllowsBlobWorkersWhereTheBrowserConverts(): void {
		$this->ownFile = $this->file();
		$this->clientFallback = true;
		$csp = $this->controller()->print(42)->getContentSecurityPolicy()->buildPolicy();
		$this->assertMatchesRegularExpression("/worker-src [^;]*'self'[^;]*blob:/", $csp);
		$this->assertMatchesRegularExpression('/connect-src [^;]*blob:/', $csp);
	}

	// --- public link page ----------------------------------------

	/** @return list<string> the app's scripts the page would load */
	private function appScripts(): array {
		// Bundles only - Util adds the app's translations next to each one.
		$scripts = (new \ReflectionProperty(Util::class, 'scripts'))->getValue();
		return array_values(array_filter($scripts['scoreview'] ?? [], fn (string $path) => str_starts_with($path, 'scoreview/js/')));
	}

	private function visitorGrant(bool $hideDownload = false): void {
		$this->grant = new PublicShareGrant('owner', $this->file(), $hideDownload, 'digest');
	}

	public function testPublicViewerRejectsInvalidShare(): void {
		$this->grant = new PublicShareException(PublicShareException::SHARE_INVALID);
		$response = $this->controller()->publicViewer('tok123', 42);

		$this->assertSame(Http::STATUS_UNAUTHORIZED, $response->getStatus());
		// Counts against the brute-force protection, as a wrong token on
		// Nextcloud's own /s/ page does.
		$this->assertTrue($response->isThrottled());
		$this->assertSame([], $this->appScripts());
		$this->assertArrayNotHasKey('standalone', $this->states);
		$this->assertArrayNotHasKey('features', $this->states);
	}

	public function testPublicViewerKeepsTheStatusOfTheRefusal(): void {
		$this->grant = new PublicShareException(PublicShareException::NOT_FOUND);
		$response = $this->controller()->publicViewer('tok123', 42);
		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
		// A file outside the share is no guess at the token - not throttled.
		$this->assertFalse($response->isThrottled());
		$this->assertSame([], $this->appScripts());
	}

	public function testPublicViewerSetsGuestStateAndPolicy(): void {
		$this->visitorGrant();
		$this->bools[FeatureConfig::INTONATION] = true;
		$this->bools[FeatureConfig::RECORDING] = true;
		$this->bools[FeatureConfig::PRACTICE_EXPORT] = true;
		$response = $this->controller()->publicViewer('tok123', 42);

		$this->assertSame([['tok123', 42]], $this->grantCalls);
		$this->assertInstanceOf(TemplateResponse::class, $response);
		$this->assertSame('standalone', $response->getTemplateName());
		$this->assertSame(TemplateResponse::RENDER_AS_BASE, $response->getRenderAs());
		$this->assertSame([
			'fileId' => 42,
			'fileName' => 'Aequale.mscz',
			'shareToken' => 'tok123',
			'guest' => true,
		], $this->states['standalone']);
		$this->assertSame($this->featureConfig()->forGuest(), $this->states['features']);
		$this->assertFalse($this->states['features']['recording']);
		$this->assertFalse($this->states['features']['practiceExport']);
		// The defaults - a visitor has no account to read preferences from.
		$this->assertSame(['for' => null], $this->states['viewer-preferences']);
		$this->assertSame(['scoreview/js/scoreview-standalone'], $this->appScripts());

		$csp = $response->getContentSecurityPolicy()->buildPolicy();
		$this->assertStringContainsString("'wasm-unsafe-eval'", $csp);
		// Framed by the link page of the same instance, by nobody else.
		$this->assertMatchesRegularExpression("/frame-ancestors 'self';/", $csp);
		// The tuner and scored singing need the microphone inside the frame.
		$this->assertMatchesRegularExpression("/microphone 'self'/", $response->getFeaturePolicy()->buildPolicy());
	}

	public function testPublicViewerAsksForNoMicrophoneWithoutAMicrophoneFeature(): void {
		$this->visitorGrant();
		$this->bools[FeatureConfig::RECORDING] = false;
		$this->bools[FeatureConfig::INTONATION] = false;
		$this->bools[FeatureConfig::SCORE_FOLLOWER] = false;
		$response = $this->controller()->publicViewer('tok123', 42);
		$this->assertDoesNotMatchRegularExpression("/microphone 'self'/", $response->getFeaturePolicy()->buildPolicy());
	}

	public function testPublicViewerHideDownloadHasNoBlobWorker(): void {
		$this->visitorGrant(true);
		$this->clientFallback = true;
		$response = $this->controller()->publicViewer('tok123', 42);

		$this->assertArrayNotHasKey('hideDownload', $this->states['standalone']);
		$csp = $response->getContentSecurityPolicy()->buildPolicy();
		// The fallback needs the source, which "hide download" closes - so
		// the page does not open what it cannot use.
		$this->assertDoesNotMatchRegularExpression('/worker-src [^;]*blob:/', $csp);
		$this->assertDoesNotMatchRegularExpression('/connect-src [^;]*blob:/', $csp);
	}

	public function testPublicViewerAllowsBlobWorkersWhereTheVisitorsBrowserConverts(): void {
		$this->visitorGrant(false);
		$this->clientFallback = true;
		$csp = $this->controller()->publicViewer('tok123', 42)->getContentSecurityPolicy()->buildPolicy();
		$this->assertMatchesRegularExpression("/worker-src [^;]*'self'[^;]*blob:/", $csp);
	}

	private function featureConfig(): FeatureConfig {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueBool')->willReturnCallback(
			fn (string $app, string $key, bool $default = false) => $this->bools[$key] ?? $default,
		);
		$appConfig->method('getValueInt')->willReturnCallback(
			fn (string $app, string $key, int $default = 0) => $default,
		);
		return new FeatureConfig($appConfig);
	}
}
