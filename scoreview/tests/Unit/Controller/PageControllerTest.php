<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\PageController;
use OCA\ScoreView\Service\ClientFallback;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\UserFileResolver;
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
use PHPUnit\Framework\TestCase;

/**
 * Die Offline-Seite (E14): Mit dem Schalter aus antwortet alles 404; der
 * Service Worker darf nur die Offline-Seite steuern (Service-Worker-Allowed),
 * und die Seite gibt der CSP nur frei, was Klang und Worker brauchen.
 *
 * The print page (E16): a file the session cannot see is a 404 before
 * anything else (S8); a visible one gets its name and the viewer's policy.
 */
class PageControllerTest extends TestCase {
	/** @var array<string, bool> */
	private array $bools = [];
	private string $soundFontUrl = '';
	/** @var array<string, mixed> */
	private array $states = [];
	private string $requestUri = '/index.php/apps/scoreview/offline';
	private ?Node $ownFile = null;
	private bool $clientFallback = false;

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

		$resolver = $this->createMock(UserFileResolver::class);
		$resolver->method('resolveOwnNode')->willReturnCallback(fn (int $fileId) => $fileId === 42 ? $this->ownFile : null);
		$fallback = $this->createMock(ClientFallback::class);
		$fallback->method('applies')->willReturnCallback(fn () => $this->clientFallback);

		return new PageController(
			$request,
			new FeatureConfig($appConfig),
			$this->createMock(ViewerPreferences::class),
			$session,
			$state,
			$url,
			new ViewerPolicy($appConfig),
			$resolver,
			$fallback,
			$l,
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
}
