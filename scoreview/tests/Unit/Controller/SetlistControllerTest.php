<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\SetlistController;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Middleware\DirectAccessContext;
use OCA\ScoreView\Middleware\DirectAccessMiddleware;
use OCA\ScoreView\Service\CompanionTokenService;
use OCA\ScoreView\Service\SetlistException;
use OCA\ScoreView\Service\SetlistService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Http;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\Node;
use OCP\IL10N;
use OCP\IRequest;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Die Setlisten-Routen (E11): Zugriff, Statuscodes, und dass
 * alle den Token-Weg der mobilen App anbieten. Die Regeln selbst testet
 * SetlistServiceTest.
 */
class SetlistControllerTest extends TestCase {
	private UserFileResolver&MockObject $fileResolver;
	private SetlistService&MockObject $service;
	private DirectAccessContext $access;
	private CompanionTokenService&MockObject $companions;
	private LoggerInterface&MockObject $logger;
	private IRequest&MockObject $request;

	protected function setUp(): void {
		$this->fileResolver = $this->createMock(UserFileResolver::class);
		$this->fileResolver->method('currentUserId')->willReturn('anna');
		$this->service = $this->createMock(SetlistService::class);
		$this->access = new DirectAccessContext();
		// Voreinstellung der Tests: Die Middleware hat eine Sitzung festgestellt.
		$this->access->setSession();
		$this->request = $this->createMock(IRequest::class);
		$this->companions = $this->createMock(CompanionTokenService::class);
		$this->companions->method('issue')->willReturnCallback(
			fn (string $uid, int $fileId, string $zweck, string $dt) => "tok:$uid:$fileId:$zweck:$dt");
		$this->logger = $this->createMock(LoggerInterface::class);
	}

	private function controller(): SetlistController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		return new SetlistController($this->request, $this->fileResolver, $this->service, $l,
			$this->access, $this->companions, $this->logger);
	}

	private function datei(string $name, int $id = 0): File&MockObject {
		$ordner = $this->createMock(Folder::class);
		$ordner->method('getId')->willReturn(7);
		$ordner->method('isCreatable')->willReturn(true);
		$datei = $this->createMock(File::class);
		$datei->method('getName')->willReturn($name);
		$datei->method('getId')->willReturn($id);
		$datei->method('getParent')->willReturn($ordner);
		return $datei;
	}

	private function sieht(?Node $knoten): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($knoten);
	}

	public function testLiestEineSetliste(): void {
		$liste = $this->datei('Konzert.setlist.md');
		$this->sieht($liste);
		$this->service->expects($this->once())->method('load')->with($liste, 'anna')->willReturn(['id' => 5]);

		$antwort = $this->controller()->show(5);

		$this->assertSame(Http::STATUS_OK, $antwort->getStatus());
		$this->assertSame(['id' => 5], $antwort->getData());
	}

	/** Eine gewoehnliche Markdown-Datei ist keine Setliste - und wird nicht beschrieben. */
	public function testGewoehnlichesMarkdownIstKeineSetliste(): void {
		$this->sieht($this->datei('Notizen.md'));
		$this->service->expects($this->never())->method('load');
		$this->service->expects($this->never())->method('save');

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->show(5)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->update(5, [])->getStatus());
	}

	public function testOhneZugriffEineVierNullVier(): void {
		$this->sieht(null);

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->show(5)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->forScore(5)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->candidates(5)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->create(5, 'x', [])->getStatus());
	}

	public static function fehler(): array {
		return [
			[SetlistException::FORBIDDEN, Http::STATUS_FORBIDDEN],
			[SetlistException::CONFLICT, Http::STATUS_CONFLICT],
			[SetlistException::EXISTS, Http::STATUS_CONFLICT],
			[SetlistException::INVALID, Http::STATUS_BAD_REQUEST],
			[SetlistException::TOO_LARGE, Http::STATUS_REQUEST_ENTITY_TOO_LARGE],
		];
	}

	#[DataProvider('fehler')]
	public function testFehlerWerdenZuStatuscodes(string $grund, int $status): void {
		$this->sieht($this->datei('Konzert.setlist.md'));
		$this->service->method('save')->willThrowException(new SetlistException($grund));

		$antwort = $this->controller()->update(5, [['origin' => 0]], 'e1');

		$this->assertSame($status, $antwort->getStatus());
		$this->assertSame($grund, $antwort->getData()['reason']);
	}

	public function testSpeichernReichtEintraegeUndStandDurch(): void {
		$liste = $this->datei('Konzert.setlist.md');
		$this->sieht($liste);
		$this->service->expects($this->once())->method('save')->with($liste, 'anna', [['origin' => 1]], 'e1')->willReturn(['id' => 5]);

		$this->assertSame(Http::STATUS_OK, $this->controller()->update(5, [['origin' => 1]], 'e1')->getStatus());
	}

	public function testAnlegenNurInEinemOrdner(): void {
		$this->sieht($this->datei('Kyrie.mscz'));

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->create(5, 'Neu', [])->getStatus());
	}

	public function testAnlegenAntwortetMitDerNeuenListe(): void {
		$ordner = $this->createMock(Folder::class);
		$this->sieht($ordner);
		$neu = $this->datei('Neu.setlist.md');
		$this->service->expects($this->once())->method('create')->with($ordner, 'anna', 'Neu', [['fileId' => 3]])->willReturn($neu);
		$this->service->method('load')->with($neu, 'anna')->willReturn(['id' => 9]);

		$antwort = $this->controller()->create(7, 'Neu', [['fileId' => 3]]);

		$this->assertSame(Http::STATUS_CREATED, $antwort->getStatus());
		$this->assertSame(['id' => 9], $antwort->getData());
	}

	public function testListenZurPartiturMitOrdnerFuerNeueListe(): void {
		$partitur = $this->datei('Kyrie.mscz');
		$this->sieht($partitur);
		$this->service->method('containing')->with($partitur, 'anna')->willReturn([['id' => 5]]);

		$daten = $this->controller()->forScore(3)->getData();

		$this->assertSame(['setlists' => [['id' => 5]], 'folderFileId' => 7, 'canCreate' => true], $daten);
	}

	public function testKandidaten(): void {
		$partitur = $this->datei('Kyrie.mscz');
		$this->sieht($partitur);
		$this->service->method('candidates')->with($partitur)->willReturn([['fileId' => 1]]);

		$this->assertSame(['candidates' => [['fileId' => 1]]], $this->controller()->candidates(3)->getData());
	}

	/**
	 * Alle Routen sind auch mit Token offen (E8). Anlegen nur im Ordner
	 * der Token-Datei - das prueft die Middleware am Parameter.
	 */
	public function testAlleRoutenBietenDenTokenWegAn(): void {
		foreach (['show', 'update', 'create', 'forScore', 'candidates'] as $methode) {
			$attribute = (new \ReflectionMethod(SetlistController::class, $methode))->getAttributes(DirectTokenOrSession::class);
			$this->assertCount(1, $attribute, $methode);
		}
		$anlegen = (new \ReflectionMethod(SetlistController::class, 'create'))->getAttributes(DirectTokenOrSession::class)[0]->newInstance();
		$this->assertSame('folderFileId', $anlegen->folderParam);
	}

	/**
	 * S1, am Attribut abgelesen: Setlisten-Token nur fuer
	 * Lesen und Schreiben der Liste, keine Begleiter fuer Anlegen, Weg 2,
	 * Auswahl und Ausgabe - und die Ausgabe nur mit Direct-Editing-Token.
	 */
	public function testBegleiterZweckeJeRoute(): void {
		$erwartet = [
			'show' => [CompanionTokenService::PURPOSE_SETLIST, false],
			'update' => [CompanionTokenService::PURPOSE_SETLIST, false],
			'create' => [null, false],
			'forScore' => [null, false],
			'candidates' => [null, false],
			'tokens' => [null, true],
		];
		foreach ($erwartet as $methode => [$zweck, $nurDirect]) {
			$attribut = (new \ReflectionMethod(SetlistController::class, $methode))->getAttributes(DirectTokenOrSession::class)[0]->newInstance();
			$this->assertSame($zweck, $attribut->companion, $methode);
			$this->assertSame($nurDirect, $attribut->directOnly, $methode);
		}
	}

	// --- S2: was mit Token neu in eine Liste darf ----------------------------

	public function testInDerSitzungOhneGrenze(): void {
		$liste = $this->datei('Konzert.setlist.md');
		$this->sieht($liste);
		$this->service->expects($this->once())->method('save')
			->with($liste, 'anna', [['path' => '/x.mscz']], null, null)->willReturn([]);

		$this->controller()->update(5, [['path' => '/x.mscz']]);
	}

	public function testMitDirectEditingTokenNurDieAuswahlUmDiePartitur(): void {
		$ordner = $this->createMock(Folder::class);
		$partitur = $this->datei('Kyrie.mscz', 42);
		$this->fileResolver->method('resolveOwnNode')->willReturnCallback(fn (int $id) => $id === 42 ? $partitur : $ordner);
		$this->access->setToken(DirectAccessContext::DIRECT, 42, str_repeat('a', 32));
		$this->service->method('candidates')->with($partitur)->willReturn([['fileId' => 42], ['fileId' => 43]]);
		$this->service->expects($this->once())->method('create')
			->with($ordner, 'anna', 'Neu', [['fileId' => 99]], [42, 43])
			->willThrowException(new SetlistException(SetlistException::FORBIDDEN));

		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->create(7, 'Neu', [['fileId' => 99]])->getStatus());
	}

	public function testMitBegleitTokenNichtsNeues(): void {
		$liste = $this->datei('Konzert.setlist.md');
		$this->sieht($liste);
		$this->access->setToken(DirectAccessContext::COMPANION, 42, str_repeat('a', 32));
		$this->service->expects($this->once())->method('save')
			->with($liste, 'anna', [['origin' => 1]], 'e1', [])->willReturn(['id' => 5]);

		$this->assertSame(Http::STATUS_OK, $this->controller()->update(5, [['origin' => 1]], 'e1')->getStatus());
	}

	/**
	 * Hat die Middleware die Anfrage nicht eingeordnet - etwa weil Controller
	 * und Middleware verschiedene Instanzen des Kontexts bekamen -, wird
	 * nicht geschrieben. Die Voreinstellung waere die Sitzung ohne Grenze.
	 */
	public function testOhneEingeordnetenAusweisWirdNichtGeschrieben(): void {
		$this->access = new DirectAccessContext();
		$this->request->method('getHeader')->willReturnCallback(
			fn (string $name) => $name === DirectAccessMiddleware::HEADER ? 'direct-token' : '');
		$liste = $this->datei('Konzert.setlist.md');
		$ordner = $this->createMock(Folder::class);
		$this->fileResolver->method('resolveOwnNode')->willReturnCallback(fn (int $id) => $id === 5 ? $liste : $ordner);
		$this->service->expects($this->never())->method('save');
		$this->service->expects($this->never())->method('create');
		$this->logger->expects($this->exactly(2))->method('error');

		$this->assertSame(DirectAccessContext::SESSION, $this->access->mode(), 'Voreinstellung');
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->update(5, [['path' => '/x.mscz']])->getStatus());
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->create(7, 'Neu', [['path' => '/x.mscz']])->getStatus());
	}

	// --- Ausgabe der Begleit-Token -----------------------------------------

	/** @return array{0: File, 1: File} Partitur 42 und Liste 50 */
	private function mobileSeite(): array {
		$partitur = $this->datei('Kyrie.mscz', 42);
		$liste = $this->datei('Konzert.setlist.md', 50);
		$this->fileResolver->method('resolveOwnNode')->willReturnCallback(fn (int $id) => match ($id) {
			42 => $partitur,
			50 => $liste,
			default => null,
		});
		$this->access->setToken(DirectAccessContext::DIRECT, 42, str_repeat('d', 32));
		return [$partitur, $liste];
	}

	public function testGibtTokenFuerSichtbareStueckeUndDieListe(): void {
		[$partitur, $liste] = $this->mobileSeite();
		$this->service->method('containing')->with($partitur, 'anna')->willReturn([['id' => 50]]);
		$this->service->expects($this->once())->method('load')->with($liste, 'anna', false)->willReturn(['entries' => [
			['fileId' => 42, 'status' => 'ok'],
			['fileId' => 43, 'status' => 'ok'],
			['fileId' => null, 'status' => 'missing'],
			['fileId' => 43, 'status' => 'ok'],
			['fileId' => 44, 'status' => 'ok'],
		]]);
		$this->companions->method('expiresAt')->willReturn(1234);
		// Protokolliert wird, wer wie viele bekam - nie ein Token.
		$this->logger->expects($this->once())->method('info')->with(
			$this->anything(),
			$this->callback(fn (array $kontext) => $kontext === ['uid' => 'anna', 'fileId' => 42, 'setlistId' => 50, 'count' => 3]),
		);

		$antwort = $this->controller()->tokens(42, 50);

		$this->assertSame(Http::STATUS_OK, $antwort->getStatus());
		$dt = str_repeat('d', 32);
		$this->assertSame([
			'tokens' => [
				['fileId' => 50, 'token' => "tok:anna:50:setlist:$dt"],
				['fileId' => 43, 'token' => "tok:anna:43:score:$dt"],
				['fileId' => 44, 'token' => "tok:anna:44:score:$dt"],
			],
			'expiresAt' => 1234,
		], $antwort->getData());
	}

	/** S1: nur fuer eine Liste, die die Partitur enthaelt und neben ihr liegt. */
	public function testKeineTokenFuerEineFremdeListe(): void {
		[$partitur] = $this->mobileSeite();
		$this->service->method('containing')->with($partitur, 'anna')->willReturn([['id' => 51]]);
		$this->companions->expects($this->never())->method('issue');

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->tokens(42, 50)->getStatus());
	}

	/**
	 * Doppelt gesichert: Auch wenn die Middleware einmal etwas durchliesse,
	 * gibt der Controller nur mit einem Direct-Editing-Token aus.
	 */
	public function testKeineTokenOhneDirectEditingToken(): void {
		$this->mobileSeite();
		$this->service->method('containing')->willReturn([['id' => 50]]);
		$this->companions->expects($this->never())->method('issue');

		foreach ([DirectAccessContext::COMPANION, DirectAccessContext::SESSION] as $art) {
			$this->access = new DirectAccessContext();
			if ($art !== DirectAccessContext::SESSION) {
				$this->access->setToken($art, 42, str_repeat('d', 32));
			}
			$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->tokens(42, 50)->getStatus(), $art);
		}
	}
}
