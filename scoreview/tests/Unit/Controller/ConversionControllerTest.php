<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\ConversionController;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ClientFallback;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Http;
use OCP\BackgroundJob\IJobList;
use OCP\Files\Node;
use OCP\IAppConfig;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Hier faellt die Rechteentscheidung fuer jede Partitur - bisher ungeprueft.
 *
 * Drei Zusagen, die dieser Controller allein traegt:
 *
 * 1. **Keine rohe fileId wird je vertraut.** Aufgeloest wird ueber den
 *    Dateibaum der angemeldeten Nutzerin (UserFileResolver); was dort nicht
 *    auftaucht, endet als 404 - ohne Datenbankzugriff, also auch ohne die
 *    Existenz einer Konvertierung zu verraten.
 * 2. **„Neu konvertieren" braucht Schreibrecht.** Der Cache haengt an der
 *    fileId, nicht an der Nutzerin: Wer nur lesen darf, soll die Darstellung
 *    nicht fuer alle anderen verwerfen koennen.
 * 3. **Ein toter Lauf sperrt die Partitur nicht.** Stirbt der Prozess
 *    waehrend der Konvertierung, blieb der Datensatz fuer immer auf
 *    `processing`: ConvertScoreJob ueberspringt ihn, reconvert() verweigert
 *    an ihm. Beide Stellen fragen jetzt ConversionService::isStale().
 */
class ConversionControllerTest extends TestCase {
	private UserFileResolver&MockObject $fileResolver;
	private ConversionService&MockObject $conversionService;
	private ClientFallback&MockObject $clientFallback;
	private IJobList&MockObject $jobList;

	protected function setUp(): void {
		$this->fileResolver = $this->createMock(UserFileResolver::class);
		$this->conversionService = $this->createMock(ConversionService::class);
		$this->clientFallback = $this->createMock(ClientFallback::class);
		$this->jobList = $this->createMock(IJobList::class);
	}

	private function controller(): ConversionController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		return new ConversionController(
			$this->createMock(IRequest::class),
			$this->fileResolver,
			$this->conversionService,
			$this->clientFallback,
			$this->createMock(LocalConverter::class),
			$this->jobList,
			$this->createMock(IURLGenerator::class),
			$this->createMock(IAppConfig::class),
			$l,
		);
	}

	/** @return Node&MockObject */
	private function node(bool $schreibbar = true): Node {
		$node = $this->createMock(Node::class);
		$node->method('getId')->willReturn(42);
		$node->method('getEtag')->willReturn('etag1');
		$node->method('isUpdateable')->willReturn($schreibbar);
		return $node;
	}

	private function datensatz(string $status): ScoreConversion {
		$conversion = new ScoreConversion();
		$conversion->setFileId(42);
		$conversion->setEtag('etag1');
		$conversion->setStatus($status);
		$conversion->setUpdatedAt(new \DateTime());
		return $conversion;
	}

	/** Was markError() an der Entity tut - der Controller verlaesst sich darauf. */
	private function markErrorSchreibtInDieEntity(): callable {
		return static function (ScoreConversion $c, string $message, string $code) {
			$c->setStatus(ScoreConversion::STATUS_ERROR);
			$c->setErrorMessage($message);
			$c->setErrorCode($code);
		};
	}

	// --- Zusage 1: keine rohe fileId ---------------------------------------

	/**
	 * @return array<string, array{string}>
	 */
	public static function endpunkte(): array {
		return [
			'Status' => ['status'],
			'Neu konvertieren' => ['reconvert'],
		];
	}

	#[DataProvider('endpunkte')]
	public function testEineNichtAufloesbareDateiEndetAls404(string $methode): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn(null);
		// Es darf gar nicht erst in der Datenbank nachgesehen werden - sonst
		// haette die Antwortzeit gesagt, ob es zu dieser fileId etwas gibt.
		$this->conversionService->expects($this->never())->method('find');

		$response = $this->controller()->$methode(42);

		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
	}

	// --- Zusage 2: Schreibrecht --------------------------------------------

	public function testNeuKonvertierenBrauchtSchreibrecht(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node(schreibbar: false));
		$this->conversionService->expects($this->never())->method('deleteAllForFile');
		$this->jobList->expects($this->never())->method('add');

		$response = $this->controller()->reconvert(42);

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
	}

	/**
	 * Die Anzeigehilfe `canReconvert` muss dieselbe Bedingung tragen wie die
	 * Pruefung in reconvert() - sonst stuende der Knopf an einer nur
	 * geliehenen Partitur und endete jedes Mal in einem 403.
	 */
	public function testCanReconvertFolgtDemSchreibrecht(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node(schreibbar: false));
		$this->conversionService->method('find')->willReturn($this->datensatz(ScoreConversion::STATUS_READY));
		$this->conversionService->method('isCurrentFormat')->willReturn(true);
		$this->conversionService->method('getPageCount')->willReturn(1);

		$response = $this->controller()->status(42);

		$this->assertFalse($response->getData()['canReconvert']);
	}

	// --- Zusage 3: ein toter Lauf sperrt nicht -----------------------------

	public function testEinToterLaufWirdBeimStatusAlsFehlerGemeldet(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$tot = $this->datensatz(ScoreConversion::STATUS_PROCESSING);
		$this->conversionService->method('find')->willReturn($tot);
		$this->conversionService->method('isStale')->with($tot)->willReturn(true);
		$this->conversionService->expects($this->once())
			->method('markError')
			->with($tot, $this->anything(), ScoreConversion::ERROR_STALE)
			->willReturnCallback($this->markErrorSchreibtInDieEntity());

		$response = $this->controller()->status(42);

		$this->assertSame(ScoreConversion::STATUS_ERROR, $response->getData()['status']);
		$this->assertSame(ScoreConversion::ERROR_STALE, $response->getData()['errorCode']);
	}

	/**
	 * Ein toter Lauf ist KEIN Grund, die Instanz fuer unfaehig zu erklaeren:
	 * Das Urteil von ClientFallback gilt instanzweit und fuenf Minuten lang -
	 * ein einzelner Neustart wuerde sonst jede Partitur der Instanz in den
	 * Browser schicken. Statt dessen wird ein neuer Versuch eingereiht.
	 */
	public function testEinToterLaufSchicktNichtInDenBrowser(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->conversionService->method('find')->willReturn($this->datensatz(ScoreConversion::STATUS_PROCESSING));
		$this->conversionService->method('isStale')->willReturn(true);
		$this->conversionService->method('markError')->willReturnCallback($this->markErrorSchreibtInDieEntity());
		$this->clientFallback->expects($this->once())
			->method('noteConversionError')
			->with(ScoreConversion::ERROR_STALE)
			->willReturn(false);
		$this->jobList->expects($this->once())->method('add');

		$response = $this->controller()->status(42);

		$this->assertSame(ScoreConversion::STATUS_ERROR, $response->getData()['status']);
	}

	#[DataProvider('laufendeZustaende')]
	public function testEinFrischerLaufBleibtUnberuehrt(string $status): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->conversionService->method('find')->willReturn($this->datensatz($status));
		$this->conversionService->method('isStale')->willReturn(false);
		$this->conversionService->expects($this->never())->method('markError');

		$response = $this->controller()->status(42);

		$this->assertSame($status, $response->getData()['status']);
	}

	public function testNeuKonvertierenVerwirftEinenTotenLauf(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->conversionService->method('find')->willReturn($this->datensatz(ScoreConversion::STATUS_PROCESSING));
		$this->conversionService->method('isStale')->willReturn(true);
		$this->conversionService->expects($this->once())->method('deleteAllForFile')->with(42);
		$this->jobList->expects($this->once())->method('add');

		$response = $this->controller()->reconvert(42);

		$this->assertSame(ScoreConversion::STATUS_PENDING, $response->getData()['status']);
	}

	/**
	 * Der Gegenfall, und der Grund, warum die Pruefung ueberhaupt bedingt
	 * ist: Waehrend ein Job laeuft, darf nichts verworfen werden - sonst
	 * schriebe er sein Ergebnis auf eine geloeschte Zeile.
	 */
	#[DataProvider('laufendeZustaende')]
	public function testNeuKonvertierenVerschontEinenLaufendenJob(string $status): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->conversionService->method('find')->willReturn($this->datensatz($status));
		$this->conversionService->method('isStale')->willReturn(false);
		$this->conversionService->expects($this->never())->method('deleteAllForFile');
		$this->jobList->expects($this->never())->method('add');

		$response = $this->controller()->reconvert(42);

		$this->assertSame($status, $response->getData()['status']);
	}

	/**
	 * @return array<string, array{string}>
	 */
	public static function laufendeZustaende(): array {
		return [
			'eingereiht' => [ScoreConversion::STATUS_PENDING],
			'in Arbeit' => [ScoreConversion::STATUS_PROCESSING],
		];
	}
}
