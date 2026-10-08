<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Controller\PracticeTrackController;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Middleware\DirectAccessContext;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\PracticeTrackException;
use OCA\ScoreView\Service\PracticeTrackService;
use OCA\ScoreView\Service\RequestBodyReader;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\AnonRateLimit;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\Node;
use OCP\IAppConfig;
use OCP\IL10N;
use OCP\IRequest;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Der Upload eines Uebe-Tracks (E13). Festgehalten wird, was ein Fehler hier
 * anrichten wuerde: fremde Dateien abtasten (404), mit einem Begleit-Token
 * Dateien anlegen (S2), riesige Rumpfe einlesen (413) oder ein beliebiges
 * Byte-Gemisch als .mp3 ablegen (400). Die Ordnerlogik prueft
 * PracticeTrackServiceTest.
 */
class PracticeTrackControllerTest extends TestCase {
	private UserFileResolver&MockObject $fileResolver;
	private PracticeTrackService&MockObject $tracks;
	private RequestBodyReader&MockObject $body;
	private IRequest&MockObject $request;
	private DirectAccessContext $access;
	private array $bools = [];

	protected function setUp(): void {
		$this->fileResolver = $this->createMock(UserFileResolver::class);
		$this->tracks = $this->createMock(PracticeTrackService::class);
		$this->body = $this->createMock(RequestBodyReader::class);
		$this->request = $this->createMock(IRequest::class);
		$this->access = new DirectAccessContext();
		$this->access->setSession();
	}

	private function controller(): PracticeTrackController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueBool')->willReturnCallback(
			fn (string $app, string $key, bool $default = false) => $this->bools[$key] ?? $default,
		);
		$appConfig->method('getValueInt')->willReturnArgument(2);
		return new PracticeTrackController($this->request, $this->fileResolver, $this->tracks, new FeatureConfig($appConfig), $this->body, $this->access, $l);
	}

	private function partitur(): File {
		$datei = $this->createMock(File::class);
		$datei->method('getMimetype')->willReturn(Application::MSCZ_MIMETYPE);
		return $datei;
	}

	private function angemeldet(?Node $datei): void {
		$this->fileResolver->method('currentUserId')->willReturn('anna');
		$this->fileResolver->method('resolveOwnNode')->willReturn($datei);
	}

	/** @return resource */
	private function strom(string $inhalt) {
		$s = fopen('php://temp', 'r+');
		fwrite($s, $inhalt);
		rewind($s);
		return $s;
	}

	public function testSpeichertEinMp3(): void {
		$this->angemeldet($this->partitur());
		$this->body->method('readToStream')->willReturn($this->strom("ID3\x03\x00rest"));
		$this->tracks->expects($this->once())->method('save')
			->with($this->anything(), 'anna', $this->anything(), 'Ave – Tenor', 'sub', null, true)
			->willReturn(['fileId' => 9, 'name' => 'Ave – Tenor.mp3', 'path' => '/Chor/Übe-Tracks/Ave – Tenor.mp3']);

		$antwort = $this->controller()->create(42, 'Ave – Tenor', 'sub', null, true);

		$this->assertSame(Http::STATUS_CREATED, $antwort->getStatus());
		$this->assertSame(9, $antwort->getData()['fileId']);
	}

	public function testFremdeDateiIstEineVierNullVier(): void {
		$this->angemeldet(null);
		$this->body->expects($this->never())->method('readToStream');
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->create(42, 'x')->getStatus());
	}

	public function testAbgeschaltetIstEineVierNullVier(): void {
		$this->bools[FeatureConfig::PRACTICE_EXPORT] = false;
		$this->angemeldet($this->partitur());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->create(42, 'x')->getStatus());
	}

	public function testBegleitTokenLegtNichtsAn(): void {
		$this->access->setToken(DirectAccessContext::COMPANION, 42, str_repeat('a', 32));
		$this->angemeldet($this->partitur());
		$this->body->expects($this->never())->method('readToStream');
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->create(42, 'x')->getStatus());
	}

	public function testDirectTokenKeinEigenerOrdner(): void {
		$this->access->setToken(DirectAccessContext::DIRECT, 42, str_repeat('a', 32));
		$this->angemeldet($this->partitur());
		$this->body->expects($this->never())->method('readToStream');
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->create(42, 'x', 'own', 7)->getStatus());
	}

	public function testDirectTokenNebenDiePartitur(): void {
		$this->access->setToken(DirectAccessContext::DIRECT, 42, str_repeat('a', 32));
		$this->angemeldet($this->partitur());
		$this->body->method('readToStream')->willReturn($this->strom('ID3rest'));
		$this->tracks->method('save')->willReturn(['fileId' => 1, 'name' => 'x.mp3', 'path' => '/x.mp3']);
		$this->assertSame(Http::STATUS_CREATED, $this->controller()->create(42, 'x', 'folder')->getStatus());
	}

	public function testUneingeordneterAusweisWirdAbgelehnt(): void {
		$this->access = new DirectAccessContext();
		$this->angemeldet($this->partitur());
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->create(42, 'x')->getStatus());
	}

	public function testNurNebenEinePartitur(): void {
		// Ein Ordner (etwa der Nutzerordner) oder eine beliebige Datei als fileId: 404.
		$this->angemeldet($this->createMock(Folder::class));
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->create(42, 'x')->getStatus());
	}

	public function testZuGrossNachAngabe(): void {
		$this->angemeldet($this->partitur());
		$this->request->method('getHeader')->with('Content-Length')->willReturn((string)(61 * 1048576));
		$this->body->expects($this->never())->method('readToStream');
		$this->assertSame(Http::STATUS_REQUEST_ENTITY_TOO_LARGE, $this->controller()->create(42, 'x')->getStatus());
	}

	public function testZuGrossBeimLesen(): void {
		$this->angemeldet($this->partitur());
		$this->body->method('readToStream')->willReturn(null);
		$this->assertSame(Http::STATUS_REQUEST_ENTITY_TOO_LARGE, $this->controller()->create(42, 'x')->getStatus());
	}

	public function testKeinMp3(): void {
		$this->angemeldet($this->partitur());
		$this->body->method('readToStream')->willReturn($this->strom('RIFF....WAVEfmt '));
		$this->tracks->expects($this->never())->method('save');
		$this->assertSame(Http::STATUS_BAD_REQUEST, $this->controller()->create(42, 'x')->getStatus());
	}

	public function testNamenskonfliktMitVorschlag(): void {
		$this->angemeldet($this->partitur());
		$this->body->method('readToStream')->willReturn($this->strom("\xFF\xFB\x90\x00"));
		$this->tracks->method('save')->willThrowException(new PracticeTrackException(PracticeTrackException::EXISTS, 'x (2).mp3'));
		$antwort = $this->controller()->create(42, 'x');
		$this->assertSame(Http::STATUS_CONFLICT, $antwort->getStatus());
		$this->assertSame('x (2).mp3', $antwort->getData()['suggested']);
	}

	public static function fehler(): array {
		return [
			'kein Schreibrecht' => [PracticeTrackException::FORBIDDEN, Http::STATUS_FORBIDDEN],
			'Kontingent voll' => [PracticeTrackException::STORAGE_FULL, Http::STATUS_INSUFFICIENT_STORAGE],
			'unbrauchbar' => [PracticeTrackException::INVALID, Http::STATUS_BAD_REQUEST],
		];
	}

	#[DataProvider('fehler')]
	public function testFehlerWerdenAbgebildet(string $grund, int $status): void {
		$this->angemeldet($this->partitur());
		$this->body->method('readToStream')->willReturn($this->strom('ID3x'));
		$this->tracks->method('save')->willThrowException(new PracticeTrackException($grund));
		$this->assertSame($status, $this->controller()->create(42, 'x')->getStatus());
	}

	public function testRoutenAttribute(): void {
		$m = new \ReflectionMethod(PracticeTrackController::class, 'create');
		$this->assertNotEmpty($m->getAttributes(DirectTokenOrSession::class));
		$this->assertNotEmpty($m->getAttributes(PublicPage::class));
		$this->assertNotEmpty($m->getAttributes(UserRateLimit::class));
		$this->assertNotEmpty($m->getAttributes(AnonRateLimit::class));
	}
}
