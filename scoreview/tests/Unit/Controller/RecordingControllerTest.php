<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\RecordingController;
use OCA\ScoreView\Db\Recording;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\RecordingException;
use OCA\ScoreView\Service\RecordingService;
use OCA\ScoreView\Service\RequestBodyReader;
use OCA\ScoreView\Service\UserFileResolver;
use OCA\ScoreView\Tests\Unit\Service\RecordingServiceTest;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\FileDisplayResponse;
use OCP\Files\Node;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\IAppConfig;
use OCP\IL10N;
use OCP\IRequest;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Die Endpunkte der Aufnahmen. Vier Zusagen:
 *
 * 1. **Schalter aus → 404** auf jedem Endpunkt.
 * 2. **Ohne Dateizugriff 404**, und fremde Aufnahmen ebenso (S8).
 * 3. **Jede Ablehnung hat ihren Status**: 409 an der Obergrenze, 413 bei
 *    Ueberlaenge, 507 bei vollem Speicher - der Viewer verzweigt daran.
 * 4. **Zu grosse Rumpfe werden gar nicht erst gelesen.**
 */
class RecordingControllerTest extends TestCase {
	private UserFileResolver&MockObject $fileResolver;
	private RecordingService&MockObject $recordings;
	private RequestBodyReader&MockObject $body;
	private IRequest&MockObject $request;
	/** @var array<string, bool> */
	private array $bools = [];

	protected function setUp(): void {
		$this->fileResolver = $this->createMock(UserFileResolver::class);
		$this->recordings = $this->createMock(RecordingService::class);
		$this->body = $this->createMock(RequestBodyReader::class);
		$this->request = $this->createMock(IRequest::class);
	}

	private function controller(): RecordingController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueBool')->willReturnCallback(
			fn (string $app, string $key, bool $default = false) => $this->bools[$key] ?? $default,
		);
		$appConfig->method('getValueInt')->willReturnArgument(2);
		return new RecordingController($this->request, $this->fileResolver, $this->recordings, new FeatureConfig($appConfig), $this->body, $l);
	}

	private function angemeldet(?Node $datei): void {
		$this->fileResolver->method('currentUserId')->willReturn('anna');
		$this->fileResolver->method('resolveOwnNode')->willReturn($datei);
	}

	private function aufnahme(): Recording {
		$r = new Recording();
		$r->setId(3);
		$r->setFileId(42);
		$r->setUserId('anna');
		$r->setCreatedAt(new \DateTime('@1700000000'));
		$r->setDurationMs(1500);
		$r->setSizeBytes(48044);
		$r->setScoreStartMs(-120);
		$r->setTempoFactor(0.8);
		$r->setWithAccompaniment(true);
		return $r;
	}

	public function testListeNurDerEigenenMitDenGrenzen(): void {
		$this->angemeldet($this->createMock(Node::class));
		$this->recordings->expects($this->once())->method('list')->with(42, 'anna')->willReturn([$this->aufnahme()]);

		$daten = $this->controller()->index(42)->getData();

		$this->assertSame(5, $daten['maxPerScore']);
		$this->assertSame(600, $daten['maxSeconds']);
		$this->assertSame([
			'id' => 3,
			'createdAt' => 1700000000,
			'durationMs' => 1500,
			'sizeBytes' => 48044,
			'scoreStartMs' => -120,
			'tempoFactor' => 0.8,
			'withAccompaniment' => true,
		], $daten['recordings'][0]);
	}

	public function testHochladenReichtRumpfUndAngabenWeiter(): void {
		$this->angemeldet($this->createMock(Node::class));
		$strom = RecordingServiceTest::strom('WAV');
		$this->body->method('readToStream')->willReturn($strom);
		$this->recordings->expects($this->once())->method('create')
			->with(42, 'anna', $strom, ['scoreStartMs' => 500, 'tempoFactor' => 4.0, 'withAccompaniment' => true], true)
			->willReturn($this->aufnahme());

		$antwort = $this->controller()->create(42, 500, 9.0, true, true);

		$this->assertSame(Http::STATUS_CREATED, $antwort->getStatus());
	}

	public function testAngekuendigteUeberlaengeWirdNichtGelesen(): void {
		$this->angemeldet($this->createMock(Node::class));
		$this->request->method('getHeader')->with('Content-Length')->willReturn((string)(700 * 32000));
		$this->body->expects($this->never())->method('readToStream');

		$this->assertSame(Http::STATUS_REQUEST_ENTITY_TOO_LARGE, $this->controller()->create(42)->getStatus());
	}

	public function testUeberlangerRumpfOhneAngabe(): void {
		$this->angemeldet($this->createMock(Node::class));
		$this->request->method('getHeader')->willReturn('');
		$this->body->method('readToStream')->willReturn(null);
		$this->recordings->expects($this->never())->method('create');

		$this->assertSame(Http::STATUS_REQUEST_ENTITY_TOO_LARGE, $this->controller()->create(42)->getStatus());
	}

	/**
	 * @return array<string, array{string, int}>
	 */
	public static function ablehnungen(): array {
		return [
			'kein WAV' => [RecordingException::INVALID, Http::STATUS_BAD_REQUEST],
			'zu lang' => [RecordingException::TOO_LONG, Http::STATUS_REQUEST_ENTITY_TOO_LARGE],
			'Obergrenze' => [RecordingException::LIMIT_REACHED, Http::STATUS_CONFLICT],
			'Speicher je Person' => [RecordingException::USER_STORAGE_FULL, Http::STATUS_INSUFFICIENT_STORAGE],
			'Speicher der Instanz' => [RecordingException::TOTAL_STORAGE_FULL, Http::STATUS_INSUFFICIENT_STORAGE],
		];
	}

	#[DataProvider('ablehnungen')]
	public function testAblehnungenHabenIhrenStatus(string $grund, int $status): void {
		$this->angemeldet($this->createMock(Node::class));
		$this->body->method('readToStream')->willReturn(RecordingServiceTest::strom('WAV'));
		$this->recordings->method('create')->willThrowException(new RecordingException($grund));

		$antwort = $this->controller()->create(42);

		$this->assertSame($status, $antwort->getStatus());
		$this->assertNotEmpty($antwort->getData()['error']);
	}

	public function testAbspielenLiefertDieWav(): void {
		$this->angemeldet($this->createMock(Node::class));
		$datei = $this->createMock(ISimpleFile::class);
		$datei->method('getName')->willReturn('3.wav');
		$datei->method('getMTime')->willReturn(1700000000);
		$this->recordings->method('open')->with(42, 'anna', 3)->willReturn($datei);

		$antwort = $this->controller()->show(42, 3);

		$this->assertInstanceOf(FileDisplayResponse::class, $antwort);
		$this->assertSame(Http::STATUS_OK, $antwort->getStatus());
		// getHeaders() braucht den Server - der Kopf steht im Feld.
		$kopf = (new \ReflectionProperty(Http\Response::class, 'headers'))->getValue($antwort);
		$this->assertSame('audio/wav', $kopf['Content-Type']);
	}

	public function testFremdeAufnahmeIstVierNullVier(): void {
		$this->angemeldet($this->createMock(Node::class));
		$this->recordings->method('open')->willThrowException(new RecordingException(RecordingException::NOT_FOUND));
		$this->recordings->method('delete')->willThrowException(new RecordingException(RecordingException::NOT_FOUND));

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->show(42, 3)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->destroy(42, 3)->getStatus());
	}

	public function testOhneDateizugriffVierNullVier(): void {
		$this->angemeldet(null);
		$this->recordings->expects($this->never())->method($this->anything());

		$c = $this->controller();
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->index(42)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->create(42)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->show(42, 3)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->destroy(42, 3)->getStatus());
	}

	public function testSchalterAusVierNullVier(): void {
		$this->bools[FeatureConfig::RECORDING] = false;
		$this->angemeldet($this->createMock(Node::class));
		$this->recordings->expects($this->never())->method($this->anything());

		$c = $this->controller();
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->index(42)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->create(42)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->show(42, 3)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->destroy(42, 3)->getStatus());
	}

	/**
	 * @return array<string, array{string}>
	 */
	public static function routen(): array {
		return [['index'], ['create'], ['show'], ['destroy']];
	}

	#[DataProvider('routen')]
	public function testAlleRoutenNehmenDasTokenDerApp(string $methode): void {
		$r = new \ReflectionMethod(RecordingController::class, $methode);
		$this->assertNotEmpty($r->getAttributes(PublicPage::class));
		$this->assertNotEmpty($r->getAttributes(DirectTokenOrSession::class));
		$this->assertSame('score', $r->getAttributes(DirectTokenOrSession::class)[0]->newInstance()->companion);
	}
}
