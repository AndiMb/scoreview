<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Middleware;

use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Middleware\DirectAccessException;
use OCA\ScoreView\Middleware\DirectAccessMiddleware;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\JSONResponse;
use OCP\DirectEditing\IManager;
use OCP\DirectEditing\IToken;
use OCP\Files\File;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use RuntimeException;

/**
 * Diese Middleware ist die einzige Schranke vor Routen, die fuer die
 * sitzungslose Anfrage einer mobilen App #[PublicPage] tragen. Was sie
 * durchlaesst, ist damit ohne Anmeldung erreichbar - die Faelle hier sind als
 * Sicherheitszusagen zu lesen, nicht als blosse Abdeckung.
 */
class DirectAccessMiddlewareTest extends TestCase {
	private IRequest&MockObject $request;
	private IUserSession&MockObject $userSession;
	private IManager&MockObject $directEditing;
	private DirectAccessMiddleware $middleware;

	protected function setUp(): void {
		$this->request = $this->createMock(IRequest::class);
		$this->userSession = $this->createMock(IUserSession::class);
		$this->directEditing = $this->createMock(IManager::class);
		$this->middleware = new DirectAccessMiddleware(
			$this->request, $this->userSession, $this->directEditing);
	}

	private function controller(): Controller {
		return new AttributTraeger('scoreview', $this->request);
	}

	/** Ein Token, der auf die angegebene fileId zeigt. */
	private function token(int $fileId): IToken&MockObject {
		$file = $this->createMock(File::class);
		$file->method('getId')->willReturn($fileId);
		$token = $this->createMock(IToken::class);
		$token->method('getFile')->willReturn($file);
		return $token;
	}

	// --- Routen ohne das Attribut ------------------------------------------

	/**
	 * Die wichtigste Zusage fuer den Bestand (A9): Wo das Attribut fehlt,
	 * fasst die Middleware nichts an - kein Header wird gelesen, keine
	 * Sitzung geprueft, nichts abgewiesen.
	 */
	public function testRuehrtRoutenOhneAttributNichtAn(): void {
		$this->userSession->expects($this->never())->method('getUser');
		$this->request->expects($this->never())->method('getHeader');

		$this->middleware->beforeController($this->controller(), 'ohneAttribut');
		$this->addToAssertionCount(1);
	}

	// --- Sitzungsfall -------------------------------------------------------

	public function testLaesstAngemeldeteSitzungMitGueltigemCsrfDurch(): void {
		$this->userSession->method('getUser')->willReturn($this->createMock(IUser::class));
		$this->request->method('passesStrictCookieCheck')->willReturn(true);
		$this->request->method('passesCSRFCheck')->willReturn(true);

		$this->middleware->beforeController($this->controller(), 'mitCsrf');
		$this->addToAssertionCount(1);
	}

	/**
	 * Ohne diese Pruefung waere das zusaetzliche #[NoCSRFRequired] eine
	 * Schwaechung des Browserwegs: Eine Notiz liesse sich dann per
	 * Cross-Site-Formular mit den Cookies der Nutzerin anlegen.
	 */
	public function testWeistAngemeldeteSitzungOhneCsrfAb(): void {
		$this->userSession->method('getUser')->willReturn($this->createMock(IUser::class));
		$this->request->method('passesStrictCookieCheck')->willReturn(true);
		$this->request->method('passesCSRFCheck')->willReturn(false);

		try {
			$this->middleware->beforeController($this->controller(), 'mitCsrf');
			$this->fail('Die Anfrage haette abgewiesen werden muessen.');
		} catch (DirectAccessException $e) {
			$this->assertSame(Http::STATUS_PRECONDITION_FAILED, $e->getStatus());
			$this->assertSame('csrf_check_failed', $e->getErrorCode());
		}
	}

	/**
	 * Die reinen Auslieferungsrouten trugen schon immer #[NoCSRFRequired] -
	 * der Browser laedt sie mit blossem fetch() ohne Token. Eine Pruefung
	 * hier braeche Wiedergabe und Anzeige.
	 */
	public function testPrueftCsrfNichtWoDieRouteIhnNieVerlangte(): void {
		$this->userSession->method('getUser')->willReturn($this->createMock(IUser::class));
		$this->request->expects($this->never())->method('passesCSRFCheck');

		$this->middleware->beforeController($this->controller(), 'ohneCsrf');
		$this->addToAssertionCount(1);
	}

	// --- Tokenfall ----------------------------------------------------------

	public function testWeistOhneSitzungUndOhneHeaderAb(): void {
		$this->userSession->method('getUser')->willReturn(null);
		$this->request->method('getHeader')
			->with(DirectAccessMiddleware::HEADER)->willReturn('');

		try {
			$this->middleware->beforeController($this->controller(), 'mitCsrf');
			$this->fail('Ohne Sitzung und ohne Token darf nichts durchgehen.');
		} catch (DirectAccessException $e) {
			$this->assertSame(Http::STATUS_UNAUTHORIZED, $e->getStatus());
			$this->assertSame('no_session', $e->getErrorCode());
		}
	}

	public function testLaesstGueltigenTokenZurPassendenDateiDurch(): void {
		$this->userSession->method('getUser')->willReturn(null);
		$this->request->method('getHeader')->willReturn('t0ken');
		$this->request->method('getParam')->with('fileId')->willReturn('42');

		$token = $this->token(42);
		$token->expects($this->once())->method('extend');
		$token->expects($this->once())->method('useTokenScope');
		$this->directEditing->method('getToken')->with('t0ken')->willReturn($token);

		$this->middleware->beforeController($this->controller(), 'mitCsrf');
		$this->addToAssertionCount(1);
	}

	/**
	 * Der Kern der Sicherheitszusage: Ein Token fuer Partitur A darf kein
	 * Schluessel fuer Partitur B derselben Nutzerin sein.
	 */
	public function testWeistTokenFuerEineAndereDateiAb(): void {
		$this->userSession->method('getUser')->willReturn(null);
		$this->request->method('getHeader')->willReturn('t0ken');
		$this->request->method('getParam')->with('fileId')->willReturn('999');
		$this->directEditing->method('getToken')->willReturn($this->token(42));

		try {
			$this->middleware->beforeController($this->controller(), 'mitCsrf');
			$this->fail('Ein Token fuer eine andere Datei darf nicht gelten.');
		} catch (DirectAccessException $e) {
			$this->assertSame(Http::STATUS_FORBIDDEN, $e->getStatus());
			$this->assertSame('token_file_mismatch', $e->getErrorCode());
		}
	}

	/**
	 * Routen ohne fileId (SoundFont, Engine) liefern instanzweites Beiwerk -
	 * dort gibt es nichts zu vergleichen, es bleibt bei der Gueltigkeit.
	 */
	public function testVergleichtNichtsWoDieRouteKeineFileIdHat(): void {
		$this->userSession->method('getUser')->willReturn(null);
		$this->request->method('getHeader')->willReturn('t0ken');
		$this->request->method('getParam')->with('fileId')->willReturn(null);
		$this->directEditing->method('getToken')->willReturn($this->token(42));

		$this->middleware->beforeController($this->controller(), 'ohneCsrf');
		$this->addToAssertionCount(1);
	}

	public function testWeistUngueltigenTokenAb(): void {
		$this->userSession->method('getUser')->willReturn(null);
		$this->request->method('getHeader')->willReturn('abgelaufen');
		$this->directEditing->method('getToken')
			->willThrowException(new RuntimeException('weg'));

		try {
			$this->middleware->beforeController($this->controller(), 'mitCsrf');
			$this->fail('Ein ungueltiger Token darf nicht durchgehen.');
		} catch (DirectAccessException $e) {
			$this->assertSame(Http::STATUS_UNAUTHORIZED, $e->getStatus());
			$this->assertSame('token_expired', $e->getErrorCode());
		}
	}

	// --- Ruecknahme des Scopes ---------------------------------------------

	public function testNimmtSelbstGesetztenScopeNachDemLaufZurueck(): void {
		$this->userSession->method('getUser')->willReturn(null);
		$this->request->method('getHeader')->willReturn('t0ken');
		$this->request->method('getParam')->willReturn('42');
		$this->directEditing->method('getToken')->willReturn($this->token(42));
		$this->userSession->expects($this->once())->method('setUser')->with(null);

		$controller = $this->controller();
		$this->middleware->beforeController($controller, 'mitCsrf');
		$this->middleware->afterController($controller, 'mitCsrf', new JSONResponse([]));
	}

	/**
	 * Sonst meldete eine regulaer angemeldete Nutzerin, die den Header
	 * zufaellig mitschickt, sich mit jeder Anfrage selbst ab.
	 */
	public function testRuehrtEineFremdeSitzungNichtAn(): void {
		$this->userSession->method('getUser')->willReturn($this->createMock(IUser::class));
		$this->request->method('passesStrictCookieCheck')->willReturn(true);
		$this->request->method('passesCSRFCheck')->willReturn(true);
		$this->userSession->expects($this->never())->method('setUser');

		$controller = $this->controller();
		$this->middleware->beforeController($controller, 'mitCsrf');
		$this->middleware->afterController($controller, 'mitCsrf', new JSONResponse([]));
	}

	public function testNimmtDenScopeAuchNachEinemFehlschlagZurueck(): void {
		$this->userSession->method('getUser')->willReturn(null);
		$this->request->method('getHeader')->willReturn('t0ken');
		$this->request->method('getParam')->willReturn('999');
		$this->directEditing->method('getToken')->willReturn($this->token(42));
		$this->userSession->expects($this->once())->method('setUser')->with(null);

		$controller = $this->controller();
		try {
			$this->middleware->beforeController($controller, 'mitCsrf');
			$this->fail('Der Dateivergleich haette anschlagen muessen.');
		} catch (DirectAccessException $e) {
			$antwort = $this->middleware->afterException($controller, 'mitCsrf', $e);
			$this->assertInstanceOf(JSONResponse::class, $antwort);
			$this->assertSame(Http::STATUS_FORBIDDEN, $antwort->getStatus());
			$this->assertSame(
				['status' => 'error', 'errorCode' => 'token_file_mismatch'],
				$antwort->getData());
		}
	}

	/** Fremde Ausnahmen gehoeren nicht dieser Middleware - sie reicht sie weiter. */
	public function testReichtFremdeAusnahmenWeiter(): void {
		$this->expectException(RuntimeException::class);
		$this->middleware->afterException(
			$this->controller(), 'mitCsrf', new RuntimeException('etwas anderes'));
	}
}

/**
 * Ein Controller nur fuer diesen Test: Die Middleware entscheidet ueber
 * Reflexion am Attribut der Methode - also braucht es echte Methoden mit
 * echten Attributen, ein Mock hat keine.
 */
class AttributTraeger extends Controller {
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function mitCsrf(): void {
	}

	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(csrfInSession: false)]
	public function ohneCsrf(): void {
	}

	public function ohneAttribut(): void {
	}
}
