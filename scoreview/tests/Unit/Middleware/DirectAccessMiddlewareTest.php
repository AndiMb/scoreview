<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Middleware;

use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Middleware\DirectAccessContext;
use OCA\ScoreView\Middleware\DirectAccessException;
use OCA\ScoreView\Middleware\DirectAccessMiddleware;
use OCA\ScoreView\Service\CompanionTokenService;
use OCA\ScoreView\Service\PublicShareAccess;
use OCA\ScoreView\Service\PublicShareException;
use OCA\ScoreView\Service\PublicShareGrant;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\DirectEditing\IManager;
use OCP\DirectEditing\IToken;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\IAppConfig;
use OCP\ICache;
use OCP\ICacheFactory;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\Security\Bruteforce\IThrottler;
use OCP\Security\Bruteforce\MaxDelayReached;
use OCP\Security\ISecureRandom;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use RuntimeException;

/**
 * Diese Middleware ist die einzige Schranke vor Routen, die fuer die
 * sitzungslose Anfrage einer mobilen App #[PublicPage] tragen. Was sie
 * durchlaesst, ist damit ohne Anmeldung erreichbar - die Faelle hier sind als
 * Sicherheitszusagen zu lesen, nicht als blosse Abdeckung.
 *
 * Die Begleit-Token laufen durch den echten CompanionTokenService (nur
 * Konfiguration, Zufall und Uhr sind Attrappen): Eine Faelschung soll an der
 * echten Signaturpruefung scheitern, nicht an einer vorgetaeuschten.
 */
class DirectAccessMiddlewareTest extends TestCase {
	private const DE_TOKEN = 't0ken';
	private const SHARE_TOKEN = 'Abc123SharE';
	private const IP = '203.0.113.7';
	private const SECRET = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

	private IRequest&MockObject $request;
	private IUserSession&MockObject $userSession;
	private IManager&MockObject $directEditing;
	private IUserManager&MockObject $userManager;
	private IRootFolder&MockObject $rootFolder;
	private DirectAccessContext $context;
	private CompanionTokenService $companions;
	private DirectAccessMiddleware $middleware;
	private PublicShareAccess&MockObject $shares;
	private IThrottler&MockObject $throttler;

	/** @var array<string, string> Header der Anfrage */
	private array $header = [];
	/** @var array<string, mixed> Parameter der Anfrage */
	private array $params = [];
	private int $jetzt = 1_800_000_000;
	private int $epoche = 0;
	private bool $aktiv = true;
	private string $geheimnis = self::SECRET;
	/** @var list<int> fileIds, die die Nutzerin (noch) sieht */
	private array $sichtbar = [42, 43, 50];
	private ICacheFactory&MockObject $cacheFactory;

	protected function setUp(): void {
		$this->request = $this->createMock(IRequest::class);
		$this->request->method('getHeader')->willReturnCallback(fn (string $name) => $this->header[$name] ?? '');
		$this->request->method('getParam')->willReturnCallback(fn (string $name) => $this->params[$name] ?? null);
		$this->userSession = $this->createMock(IUserSession::class);
		$this->directEditing = $this->createMock(IManager::class);
		$this->userManager = $this->createMock(IUserManager::class);
		$this->userManager->method('get')->willReturnCallback(function (string $uid) {
			if ($uid !== 'anna') {
				return null;
			}
			$user = $this->createMock(IUser::class);
			$user->method('getUID')->willReturn('anna');
			$user->method('isEnabled')->willReturnCallback(fn () => $this->aktiv);
			return $user;
		});
		$this->rootFolder = $this->createMock(IRootFolder::class);
		$this->rootFolder->method('getUserFolder')->willReturnCallback(function () {
			$ordner = $this->createMock(Folder::class);
			$ordner->method('getFirstNodeById')->willReturnCallback(
				function (int $id) {
					if (!in_array($id, $this->sichtbar, true)) {
						return null;
					}
					$datei = $this->createMock(File::class);
					$datei->method('getId')->willReturn($id);
					return $datei;
				});
			return $ordner;
		});
		$this->context = new DirectAccessContext();
		$this->cacheFactory = $this->createMock(ICacheFactory::class);
		$this->cacheFactory->method('isAvailable')->willReturn(false);
		$this->companions = $this->dienst();
		$this->shares = $this->createMock(PublicShareAccess::class);
		$this->throttler = $this->createMock(IThrottler::class);
		$this->request->method('getRemoteAddress')->willReturn(self::IP);
		$this->middleware = $this->neu($this->cacheFactory);
	}

	private function neu(ICacheFactory $cacheFactory): DirectAccessMiddleware {
		return new DirectAccessMiddleware(
			$this->request, $this->userSession, $this->directEditing,
			$this->userManager, $this->rootFolder, $this->companions, $this->context, $cacheFactory,
			$this->shares, $this->throttler);
	}

	/** Ein Token-Dienst gegen die Attrappen dieses Tests - `$geheimnis` bestimmt den Schluessel. */
	private function dienst(): CompanionTokenService {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')->willReturnCallback(fn () => $this->geheimnis);
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturnCallback(fn () => (string)$this->epoche);
		$zeit = $this->createMock(ITimeFactory::class);
		$zeit->method('getTime')->willReturnCallback(fn () => $this->jetzt);
		return new CompanionTokenService($appConfig, $config, $this->createMock(ISecureRandom::class), $zeit);
	}

	private function controller(): Controller {
		return new AttributTraeger('scoreview', $this->request);
	}

	/** Ein Direct-Editing-Token, der auf die angegebene fileId zeigt (im Ordner 7). */
	private function token(int $fileId, string $uid = 'anna'): IToken&MockObject {
		$folder = $this->createMock(Folder::class);
		$folder->method('getId')->willReturn(7);
		$file = $this->createMock(File::class);
		$file->method('getId')->willReturn($fileId);
		$file->method('getParent')->willReturn($folder);
		$token = $this->createMock(IToken::class);
		$token->method('getFile')->willReturn($file);
		$token->method('getUser')->willReturn($uid);
		return $token;
	}

	/** Ohne Sitzung, mit gueltigem Direct-Editing-Token fuer Partitur 42. */
	private function mobil(?string $begleiter = null): void {
		$this->userSession->method('getUser')->willReturn(null);
		$this->header[DirectAccessMiddleware::HEADER] = self::DE_TOKEN;
		if ($begleiter !== null) {
			$this->header[DirectAccessMiddleware::COMPANION_HEADER] = $begleiter;
		}
		$this->directEditing->method('getToken')->with(self::DE_TOKEN)->willReturn($this->token(42));
	}

	private function begleiter(int $fileId, string $zweck = CompanionTokenService::PURPOSE_SCORE, string $deToken = self::DE_TOKEN, string $uid = 'anna'): string {
		return $this->companions->issue($uid, $fileId, $zweck, CompanionTokenService::digest($deToken));
	}

	private function abgewiesen(string $methode, int $status, string $code, string $warum): void {
		try {
			$this->middleware->beforeController($this->controller(), $methode);
			$this->fail($warum);
		} catch (DirectAccessException $e) {
			$this->assertSame($code, $e->getErrorCode(), $warum);
			$this->assertSame($status, $e->getStatus(), $warum);
		}
	}

	// --- Routen ohne das Attribut ------------------------------------------

	/**
	 * Die wichtigste Zusage fuer den Bestand: Wo das Attribut fehlt,
	 * fasst die Middleware nichts an - kein Header wird gelesen, keine
	 * Sitzung geprueft, nichts abgewiesen.
	 */
	public function testRuehrtRoutenOhneAttributNichtAn(): void {
		$this->userSession->expects($this->never())->method('getUser');
		$this->request->expects($this->never())->method('getHeader');

		$this->middleware->beforeController($this->controller(), 'ohneAttribut');
		$this->assertSame(DirectAccessContext::SESSION, $this->context->mode());
		$this->assertFalse($this->context->resolved(), 'ohne Attribut keine Einordnung - schreibende Controller lehnen dann ab');
	}

	// --- Sitzungsfall -------------------------------------------------------

	public function testLaesstAngemeldeteSitzungMitGueltigemCsrfDurch(): void {
		$this->userSession->method('getUser')->willReturn($this->createMock(IUser::class));
		$this->request->method('passesStrictCookieCheck')->willReturn(true);
		$this->request->method('passesCSRFCheck')->willReturn(true);

		$this->middleware->beforeController($this->controller(), 'mitCsrf');
		$this->assertSame(DirectAccessContext::SESSION, $this->context->mode());
		$this->assertTrue($this->context->resolved(), 'die Sitzung ist festgestellt, nicht nur voreingestellt');
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

		$this->abgewiesen('mitCsrf', Http::STATUS_PRECONDITION_FAILED, 'csrf_check_failed', 'CSRF fehlt');
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

	/** S1: Begleit-Token gibt es nie aus einer Sitzung heraus. */
	public function testAusgabeNichtAusEinerSitzung(): void {
		$this->userSession->method('getUser')->willReturn($this->createMock(IUser::class));
		$this->request->method('passesStrictCookieCheck')->willReturn(true);
		$this->request->method('passesCSRFCheck')->willReturn(true);

		$this->abgewiesen('ausgabe', Http::STATUS_FORBIDDEN, 'direct_token_required', 'Sitzung darf keine Token holen');
	}

	// --- Direct-Editing-Token ----------------------------------------------

	public function testWeistOhneSitzungUndOhneHeaderAb(): void {
		$this->userSession->method('getUser')->willReturn(null);

		$this->abgewiesen('mitCsrf', Http::STATUS_UNAUTHORIZED, 'no_session', 'Ohne Sitzung und Token');
	}

	public function testLaesstGueltigenTokenZurPassendenDateiDurch(): void {
		$this->userSession->method('getUser')->willReturn(null);
		$this->header[DirectAccessMiddleware::HEADER] = self::DE_TOKEN;
		$this->params['fileId'] = '42';
		$token = $this->token(42);
		$token->expects($this->once())->method('extend');
		$token->expects($this->once())->method('useTokenScope');
		$this->directEditing->method('getToken')->with(self::DE_TOKEN)->willReturn($token);

		$this->middleware->beforeController($this->controller(), 'mitCsrf');

		$this->assertSame(DirectAccessContext::DIRECT, $this->context->mode());
		$this->assertSame(42, $this->context->originFileId());
		$this->assertSame(CompanionTokenService::digest(self::DE_TOKEN), $this->context->directDigest());
		$this->assertNotNull($this->context->knownNode('anna', 42), 'the controller takes the file core already resolved');
	}

	/**
	 * Polling must not write to oc_direct_edit on every request: with a
	 * memory cache the token is extended once per interval, and the check
	 * itself still runs on every request.
	 */
	public function testVerlaengertHoechstensEinmalJeIntervall(): void {
		$store = [];
		$cache = $this->createMock(ICache::class);
		$cache->method('get')->willReturnCallback(function (string $k) use (&$store) {
			return $store[$k] ?? null;
		});
		$cache->method('set')->willReturnCallback(function (string $k, $v) use (&$store) {
			$store[$k] = $v;
			return true;
		});
		$factory = $this->createMock(ICacheFactory::class);
		$factory->method('isAvailable')->willReturn(true);
		$factory->method('createDistributed')->willReturn($cache);
		$this->middleware = $this->neu($factory);

		$this->userSession->method('getUser')->willReturn(null);
		$this->header[DirectAccessMiddleware::HEADER] = self::DE_TOKEN;
		$this->params['fileId'] = '42';
		$token = $this->token(42);
		$token->expects($this->once())->method('extend');
		$token->expects($this->exactly(3))->method('useTokenScope');
		$this->directEditing->method('getToken')->with(self::DE_TOKEN)->willReturn($token);

		for ($i = 0; $i < 3; $i++) {
			$this->middleware->beforeController($this->controller(), 'mitCsrf');
		}
		$this->assertSame([CompanionTokenService::digest(self::DE_TOKEN)], array_keys($store));
	}

	/**
	 * Der Kern der Sicherheitszusage: Ein Token fuer Partitur A darf kein
	 * Schluessel fuer Partitur B derselben Nutzerin sein.
	 */
	public function testWeistTokenFuerEineAndereDateiAb(): void {
		$this->mobil();
		$this->params['fileId'] = '999';

		$this->abgewiesen('mitCsrf', Http::STATUS_FORBIDDEN, 'token_file_mismatch', 'andere Datei');
	}

	/**
	 * Routen ohne fileId (SoundFont, Anzeigeeinstellungen) - es bleibt bei
	 * der Gueltigkeit: Das SoundFont ist Beiwerk, die Einstellungen gehoeren
	 * der Nutzerin, die das Token ausweist.
	 */
	public function testVergleichtNichtsWoDieRouteKeineFileIdHat(): void {
		$this->mobil();

		$this->middleware->beforeController($this->controller(), 'ohneCsrf');
		$this->middleware->beforeController($this->controller(), 'ohneBegleiter');
		$this->assertSame(DirectAccessContext::DIRECT, $this->context->mode());
	}

	/**
	 * Anlegen im Ordner (POST /api/setlists): Ein Token fuer eine Partitur
	 * erlaubt das nur neben ihr - nicht in jedem anderen Ordner der Nutzerin,
	 * und nicht, wenn der Ordner gar nicht genannt ist.
	 */
	public function testAnlegenMitTokenNurImOrdnerDerTokenDatei(): void {
		$this->mobil();
		$this->params['folderFileId'] = '7';
		$this->middleware->beforeController($this->controller(), 'imOrdner');

		foreach (['8', null] as $falsch) {
			$this->params['folderFileId'] = $falsch;
			$this->abgewiesen('imOrdner', Http::STATUS_FORBIDDEN, 'token_folder_mismatch', 'Ordner ' . var_export($falsch, true));
		}
	}

	public function testWeistUngueltigenTokenAb(): void {
		$this->userSession->method('getUser')->willReturn(null);
		$this->header[DirectAccessMiddleware::HEADER] = 'abgelaufen';
		$this->directEditing->method('getToken')->willThrowException(new RuntimeException('weg'));

		$this->abgewiesen('mitCsrf', Http::STATUS_UNAUTHORIZED, 'token_expired', 'ungueltiger Token');
	}

	/** Nextclouds Direct Editing prueft das nicht selbst - ein deaktiviertes Konto hat keine Anfragen mehr. */
	public function testDeaktivierteNutzerinKommtAuchMitTokenNichtDurch(): void {
		$this->mobil();
		$this->params['fileId'] = '42';
		$this->aktiv = false;

		$this->abgewiesen('mitCsrf', Http::STATUS_UNAUTHORIZED, 'user_disabled', 'deaktiviert');
	}

	// --- Begleit-Token: der Gutfall -----------------------------------------

	public function testBegleitTokenOeffnetGenauSeineDatei(): void {
		$this->mobil($this->begleiter(43));
		$this->params['fileId'] = '43';
		$this->userSession->expects($this->exactly(2))->method('setVolatileActiveUser')
			->willReturnCallback(function (?IUser $user): void {
				static $aufruf = 0;
				$aufruf++;
				$aufruf === 1 ? $this->assertSame('anna', $user?->getUID()) : $this->assertNull($user);
			});
		$this->userSession->expects($this->never())->method('setUser');

		$controller = $this->controller();
		$this->middleware->beforeController($controller, 'mitCsrf');
		$this->assertSame(DirectAccessContext::COMPANION, $this->context->mode());
		$this->assertSame(42, $this->context->originFileId(), 'Ursprung bleibt die Datei des Direct-Editing-Tokens');
		$this->assertNotNull($this->context->knownNode('anna', 43), 'the companion file, resolved once in the middleware');
		$this->assertNull($this->context->knownNode('anna', 42));
		$this->middleware->afterController($controller, 'mitCsrf', new JSONResponse([]));
	}

	public function testSetlistenTokenOeffnetDieListe(): void {
		$this->mobil($this->begleiter(50, CompanionTokenService::PURPOSE_SETLIST));
		$this->params['fileId'] = '50';

		$this->middleware->beforeController($this->controller(), 'liste');
		$this->assertSame(DirectAccessContext::COMPANION, $this->context->mode());
	}

	// --- Begleit-Token: Faelschung, Ablauf, Bindung --------------------------

	public function testGefaelschterBegleiterGiltNicht(): void {
		$echt = $this->begleiter(43);
		[$v, $inhalt, $mac] = explode('.', $echt);
		// Die Datei im Inhalt umschreiben, Signatur behalten.
		$daten = json_decode(base64_decode(strtr($inhalt, '-_', '+/')), true);
		$daten['fid'] = 99;
		$umgeschrieben = rtrim(strtr(base64_encode(json_encode($daten)), '+/', '-_'), '=');
		$gekippt = $mac[0] === 'A' ? 'B' . substr($mac, 1) : 'A' . substr($mac, 1);

		foreach ([
			'Inhalt umgeschrieben' => "$v.$umgeschrieben.$mac",
			'Signatur gekippt' => "$v.$inhalt.$gekippt",
			'ohne Signatur' => "$v.$inhalt.",
			'andere Fassung' => "v2.$inhalt.$mac",
			'Muell' => 'kein.token',
			'zu lang' => 'v1.' . str_repeat('A', 5000) . '.' . $mac,
		] as $fall => $token) {
			$this->setUp();
			$this->mobil($token);
			$this->params['fileId'] = $fall === 'Inhalt umgeschrieben' ? '99' : '43';
			$this->sichtbar[] = 99;
			$this->abgewiesen('mitCsrf', Http::STATUS_UNAUTHORIZED, 'companion_invalid', $fall);
		}
	}

	/** Ein neues Geheimnis (`occ config:app:delete scoreview companion_secret`) widerruft alle Token. */
	public function testNeuesGeheimnisWiderruftAlles(): void {
		$alt = $this->begleiter(43);
		$this->geheimnis = str_repeat('ab', 32);
		$this->companions = $this->dienst();
		$this->middleware = $this->neu($this->cacheFactory);
		$this->mobil($alt);
		$this->params['fileId'] = '43';

		$this->abgewiesen('mitCsrf', Http::STATUS_UNAUTHORIZED, 'companion_invalid', 'altes Geheimnis');
	}

	public function testAbgelaufenerBegleiterGiltNicht(): void {
		$token = $this->begleiter(43);
		$this->jetzt += CompanionTokenService::LIFETIME_SECONDS;
		$this->mobil($token);
		$this->params['fileId'] = '43';

		$this->abgewiesen('mitCsrf', Http::STATUS_UNAUTHORIZED, 'companion_expired', '12 h vorbei');
	}

	/** `exp` wird nicht verlaengert: Auch rege Benutzung haelt einen Begleiter nicht ueber 12 h. */
	public function testGebrauchVerlaengertDenBegleiterNicht(): void {
		$token = $this->begleiter(43);
		$this->mobil($token);
		$this->params['fileId'] = '43';
		$this->jetzt += CompanionTokenService::LIFETIME_SECONDS - 1;
		$this->middleware->beforeController($this->controller(), 'mitCsrf');

		$this->jetzt += 1;
		$this->abgewiesen('mitCsrf', Http::STATUS_UNAUTHORIZED, 'companion_expired', 'nach Gebrauch trotzdem abgelaufen');
	}

	/** Ohne das Direct-Editing-Token, aus dem er stammt, taugt ein Begleiter nichts. */
	public function testBegleiterEinesAnderenDirectEditingTokens(): void {
		$this->mobil($this->begleiter(43, deToken: 'anderes-token'));
		$this->params['fileId'] = '43';

		$this->abgewiesen('mitCsrf', Http::STATUS_UNAUTHORIZED, 'companion_invalid', 'dt passt nicht');
	}

	public function testBegleiterEinerAnderenNutzerin(): void {
		$this->mobil($this->begleiter(43, uid: 'bert'));
		$this->params['fileId'] = '43';

		$this->abgewiesen('mitCsrf', Http::STATUS_UNAUTHORIZED, 'companion_invalid', 'uid passt nicht');
	}

	public function testBegleiterOhneLebendesDirectEditingToken(): void {
		$this->userSession->method('getUser')->willReturn(null);
		$this->header[DirectAccessMiddleware::HEADER] = self::DE_TOKEN;
		$this->header[DirectAccessMiddleware::COMPANION_HEADER] = $this->begleiter(43);
		$this->params['fileId'] = '43';
		$this->directEditing->method('getToken')->willThrowException(new RuntimeException('aufgeraeumt'));

		$this->abgewiesen('mitCsrf', Http::STATUS_UNAUTHORIZED, 'token_expired', 'Direct-Editing-Token tot');
	}

	/** Passwortwechsel oder Deaktivieren heben die Epoche - alte Begleiter sind dann tot. */
	public function testEpochenwechselWiderruft(): void {
		$token = $this->begleiter(43);
		$this->epoche = 1;
		$this->mobil($token);
		$this->params['fileId'] = '43';

		$this->abgewiesen('mitCsrf', Http::STATUS_UNAUTHORIZED, 'companion_revoked', 'Epoche gestiegen');
	}

	public function testBegleiterEinerDeaktiviertenNutzerin(): void {
		$this->mobil($this->begleiter(43));
		$this->params['fileId'] = '43';
		$this->aktiv = false;

		$this->abgewiesen('mitCsrf', Http::STATUS_UNAUTHORIZED, 'user_disabled', 'deaktiviert');
	}

	/** Ein Freigabeentzug wirkt sofort: Die Datei wird bei jeder Anfrage neu aufgeloest. */
	public function testFreigabeentzugBeendetDenBegleiter(): void {
		$this->mobil($this->begleiter(43));
		$this->params['fileId'] = '43';
		$this->sichtbar = [42];

		$this->abgewiesen('mitCsrf', Http::STATUS_NOT_FOUND, 'not_found', 'nicht mehr sichtbar');
	}

	// --- Begleit-Token: Datei und Zweck ------------------------------------

	public function testBegleiterFuerEineAndereDatei(): void {
		$this->mobil($this->begleiter(43));
		$this->params['fileId'] = '50';

		$this->abgewiesen('mitCsrf', Http::STATUS_FORBIDDEN, 'token_file_mismatch', 'andere Datei');
	}

	/** S1: Ein Token fuer die Setlisten-Datei oeffnet keine Partitur-Route - auch nicht fuer die Liste selbst. */
	public function testSetlistenTokenNichtAufPartiturRouten(): void {
		$this->mobil($this->begleiter(50, CompanionTokenService::PURPOSE_SETLIST));
		$this->params['fileId'] = '50';

		$this->abgewiesen('mitCsrf', Http::STATUS_FORBIDDEN, 'companion_purpose', 'Setlisten-Token auf Partitur-Route');
	}

	public function testPartiturTokenNieFuerSetlistenRouten(): void {
		$this->mobil($this->begleiter(50));
		$this->params['fileId'] = '50';

		$this->abgewiesen('liste', Http::STATUS_FORBIDDEN, 'companion_purpose', 'Partitur-Token auf Setlisten-Route');
	}

	/**
	 * S1: Aus einem Begleiter wird kein weiterer ausgegeben, keine Liste
	 * angelegt, und Routen ohne Begleiter-Zweck (Weg 2, Auswahl) bleiben zu.
	 */
	public function testKeineKetteUndKeinAnlegenMitBegleiter(): void {
		foreach (['ausgabe' => '43', 'imOrdner' => '43', 'ohneBegleiter' => '43'] as $methode => $datei) {
			$this->setUp();
			$this->mobil($this->begleiter(43));
			$this->params['fileId'] = $datei;
			$this->params['folderFileId'] = '7';
			$this->abgewiesen($methode, Http::STATUS_FORBIDDEN, 'companion_not_allowed', $methode);
		}
	}

	/** Ohne fileId gibt es nichts, wofuer ein Begleiter gelten koennte. */
	public function testBegleiterNichtAufRoutenOhneDatei(): void {
		$this->mobil($this->begleiter(43));

		$this->abgewiesen('ohneCsrf', Http::STATUS_FORBIDDEN, 'companion_not_allowed', 'SoundFont');
	}

	// --- Public share token ------------------------------------------------

	/** A grant in Anna's share - for score 42, or for no file at all. */
	private function freigabe(bool $hideDownload = false, ?int $fileId = 42): PublicShareGrant {
		$node = null;
		if ($fileId !== null) {
			$node = $this->createMock(File::class);
			$node->method('getId')->willReturn($fileId);
		}
		return new PublicShareGrant('anna', $node, $hideDownload, hash('sha256', self::SHARE_TOKEN));
	}

	/** A visitor without an account: no session, only the share header. */
	private function besucher(): void {
		$this->userSession->method('getUser')->willReturn(null);
		$this->header[DirectAccessMiddleware::SHARE_HEADER] = self::SHARE_TOKEN;
	}

	/**
	 * The token opens only the routes that say so - everything else (notes,
	 * recordings, setlists, ...) belongs to an account a visitor lacks.
	 */
	public function testShareHeaderOnRouteWithoutShareFlagIs401(): void {
		$this->besucher();
		$this->params['fileId'] = '42';
		$this->shares->expects($this->never())->method('grant');

		foreach (['mitCsrf', 'ohneCsrf', 'ausgabe', 'liste', 'imOrdner'] as $methode) {
			$this->abgewiesen($methode, Http::STATUS_UNAUTHORIZED, 'share_not_allowed', $methode);
		}
	}

	public function testShareHeaderGrantsReadRoute(): void {
		$this->besucher();
		$this->params['fileId'] = '42';
		$grant = $this->freigabe();
		$this->shares->expects($this->once())->method('grant')->with(self::SHARE_TOKEN, 42)->willReturn($grant);
		$this->throttler->expects($this->once())->method('sleepDelayOrThrowOnMax')->with(self::IP, 'scoreview_share');
		$this->throttler->expects($this->never())->method('registerAttempt');

		$this->middleware->beforeController($this->controller(), 'freigabeLesen');

		$this->assertSame(DirectAccessContext::SHARE, $this->context->mode());
		$this->assertTrue($this->context->resolved());
		$this->assertSame($grant, $this->context->shareGrant());
		$this->assertSame($grant->node, $this->context->knownNode('anna', 42), 'the file is known under the owner');
	}

	/** SoundFont: no fileId, so the grant is asked for no file - and names none. */
	public function testShareOnRouteWithoutFileIdAsksForNoFile(): void {
		$this->besucher();
		$this->shares->expects($this->once())->method('grant')->with(self::SHARE_TOKEN, null)
			->willReturn($this->freigabe(false, null));

		$this->middleware->beforeController($this->controller(), 'freigabeLesen');

		$this->assertSame(DirectAccessContext::SHARE, $this->context->mode());
		$this->assertNull($this->context->knownNode('anna', 42));
	}

	/**
	 * A logged-in member opening someone else's link must get the file of
	 * the link, not a 404 from her own tree - and the read-only route asks
	 * for no CSRF token on that path.
	 */
	public function testShareHeaderWinsOverSession(): void {
		$bert = $this->createMock(IUser::class);
		$bert->method('getUID')->willReturn('bert');
		$this->userSession->method('getUser')->willReturn($bert);
		$this->header[DirectAccessMiddleware::SHARE_HEADER] = self::SHARE_TOKEN;
		$this->params['fileId'] = '42';
		$this->request->expects($this->never())->method('passesCSRFCheck');
		$this->request->expects($this->never())->method('passesStrictCookieCheck');
		$this->shares->method('grant')->willReturn($this->freigabe());

		$this->middleware->beforeController($this->controller(), 'freigabeLesen');

		$this->assertSame(DirectAccessContext::SHARE, $this->context->mode());
		$this->assertNotNull($this->context->knownNode('anna', 42));
	}

	public function testHideDownloadBlocksSourceRoute(): void {
		$this->besucher();
		$this->params['fileId'] = '42';
		$this->shares->method('grant')->willReturn($this->freigabe(true));

		$this->abgewiesen('freigabeQuelle', Http::STATUS_FORBIDDEN, 'share_download_hidden', 'hidden download');

		// Rendering stays allowed - "hide download" closes only the source file.
		$this->middleware->beforeController($this->controller(), 'freigabeLesen');
		$this->assertSame(DirectAccessContext::SHARE, $this->context->mode());
	}

	public function testSourceRouteOpenWithoutHideDownload(): void {
		$this->besucher();
		$this->params['fileId'] = '42';
		$this->shares->method('grant')->willReturn($this->freigabe(false));

		$this->middleware->beforeController($this->controller(), 'freigabeQuelle');
		$this->assertSame(DirectAccessContext::SHARE, $this->context->mode());
	}

	/**
	 * @return array<string, array{string, int, bool}>
	 */
	public static function shareFailures(): array {
		return [
			'unknown token' => [PublicShareException::SHARE_INVALID, 401, true],
			'locked password' => [PublicShareException::SHARE_AUTH, 401, true],
			'switch off' => [PublicShareException::PUBLIC_DISABLED, 401, false],
			'file drop' => [PublicShareException::SHARE_NO_READ, 403, false],
			'file outside the share' => [PublicShareException::NOT_FOUND, 404, false],
		];
	}

	/** Only guessing signals count - a deleted file or a switched-off feature is no attack. */
	#[DataProvider('shareFailures')]
	public function testInvalidShareRegistersBruteForceAttempt(string $code, int $status, bool $counts): void {
		$this->besucher();
		$this->params['fileId'] = '42';
		$this->shares->method('grant')->willThrowException(new PublicShareException($code));
		$this->throttler->expects($counts ? $this->once() : $this->never())
			->method('registerAttempt')->with('scoreview_share', self::IP);

		$this->abgewiesen('freigabeLesen', $status, $code, $code);
	}

	public function testThrottledShareIs429(): void {
		$this->besucher();
		$this->throttler->method('sleepDelayOrThrowOnMax')->willThrowException(new MaxDelayReached());
		$this->shares->expects($this->never())->method('grant');

		$this->abgewiesen('freigabeLesen', Http::STATUS_TOO_MANY_REQUESTS, 'share_throttled', 'throttled');
	}

	/**
	 * A visitor is attributed to the owner, never logged in as her: no
	 * volatile user, no token scope, nothing that writes to the session -
	 * even when a Direct Editing token comes along.
	 */
	public function testNoScopeOrVolatileUserIsSet(): void {
		$this->besucher();
		$this->header[DirectAccessMiddleware::HEADER] = self::DE_TOKEN;
		$this->params['fileId'] = '42';
		$this->shares->method('grant')->willReturn($this->freigabe());
		$this->directEditing->expects($this->never())->method('getToken');
		$this->userSession->expects($this->never())->method('setVolatileActiveUser');
		$this->userSession->expects($this->never())->method('setUser');

		$controller = $this->controller();
		$this->middleware->beforeController($controller, 'freigabeLesen');
		$this->middleware->afterController($controller, 'freigabeLesen', new JSONResponse([]));
	}

	/**
	 * The list of routes a share token opens is a security promise, so it is
	 * pinned here: a new `share:` on any route must show up as a failing
	 * test, not slip through review. engine#get needs no entry - it is
	 * #[PublicPage] without this attribute and open to anyone anyway.
	 */
	public function testOnlyTheReadOnlyScoreRoutesAcceptAShareToken(): void {
		$found = [];
		foreach (glob(__DIR__ . '/../../../lib/Controller/*Controller.php') as $path) {
			$class = 'OCA\\ScoreView\\Controller\\' . basename($path, '.php');
			foreach ((new \ReflectionClass($class))->getMethods() as $method) {
				foreach ($method->getAttributes(DirectTokenOrSession::class) as $attribute) {
					$share = $attribute->newInstance()->share;
					if ($share !== null) {
						$found[basename($path, '.php') . '#' . $method->getName()] = $share;
					}
				}
			}
		}
		ksort($found);

		$this->assertSame([
			'ConversionController#artifact' => 'read',
			'ConversionController#source' => 'download',
			'ConversionController#status' => 'read',
			'SoundFontController#get' => 'read',
			'VariantController#artifact' => 'read',
			'VariantController#status' => 'read',
		], $found);
	}

	// --- Ruecknahme des Scopes ---------------------------------------------

	public function testNimmtSelbstGesetztenScopeNachDemLaufZurueck(): void {
		$this->mobil();
		$this->params['fileId'] = '42';
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
		$this->userSession->expects($this->never())->method('setVolatileActiveUser');

		$controller = $this->controller();
		$this->middleware->beforeController($controller, 'mitCsrf');
		$this->middleware->afterController($controller, 'mitCsrf', new JSONResponse([]));
	}

	public function testNimmtDenScopeAuchNachEinemFehlschlagZurueck(): void {
		$this->mobil();
		$this->params['fileId'] = '999';
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

	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(folderParam: 'folderFileId', companion: null)]
	public function imOrdner(): void {
	}

	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(companion: CompanionTokenService::PURPOSE_SETLIST)]
	public function liste(): void {
	}

	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(companion: null)]
	public function ohneBegleiter(): void {
	}

	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(companion: null, directOnly: true)]
	public function ausgabe(): void {
	}

	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(share: 'read')]
	public function freigabeLesen(): void {
	}

	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(csrfInSession: false, share: 'download')]
	public function freigabeQuelle(): void {
	}
}
