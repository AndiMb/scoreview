<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\PageController;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\ViewerPreferences;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
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
 */
class PageControllerTest extends TestCase {
	/** @var array<string, bool> */
	private array $bools = [];
	private string $soundFontUrl = '';
	/** @var array<string, mixed> */
	private array $states = [];
	private string $requestUri = '/index.php/apps/scoreview/offline';

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

		return new PageController(
			$request,
			new FeatureConfig($appConfig),
			$this->createMock(ViewerPreferences::class),
			$session,
			$state,
			$url,
			$appConfig,
			$l,
		);
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
		$response = $this->controller()->serviceWorker();
		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		// getHeaders() braucht den Server-Container; die eigenen Header
		// stehen im Feld der Basisklasse.
		$headers = (new \ReflectionProperty(Http\Response::class, 'headers'))->getValue($response);
		$this->assertSame('/index.php/apps/scoreview/offline', $headers['Service-Worker-Allowed']);
		$this->assertStringStartsWith('application/javascript', $headers['Content-Type']);
		$this->assertSame('no-cache', $headers['Cache-Control']);
	}

	public function testManifestStartetAufDerOfflineSeite(): void {
		$data = $this->controller()->manifest()->getData();
		$this->assertSame('/index.php/apps/scoreview/offline', $data['start_url']);
		$this->assertSame($data['start_url'], $data['scope']);
		$this->assertSame('standalone', $data['display']);
	}

	public function testOriginNurFuerHttp(): void {
		$this->assertSame('https://a.example', PageController::origin('https://a.example/x.sf2'));
		$this->assertNull(PageController::origin('/apps/scoreview/api/soundfont'));
		$this->assertNull(PageController::origin('javascript:alert(1)'));
	}
}
