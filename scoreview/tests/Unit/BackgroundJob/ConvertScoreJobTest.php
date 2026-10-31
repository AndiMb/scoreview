<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\BackgroundJob;

use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreVariant;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\LocalConverterException;
use OCA\ScoreView\Service\SidecarBusyException;
use OCA\ScoreView\Service\SidecarClient;
use OCA\ScoreView\Service\SidecarException;
use OCA\ScoreView\Service\VariantService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\IAppConfig;
use OCP\ITempManager;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Hier faellt die Entscheidung zwischen den beiden Konvertierungswegen
 * (docs/architecture.md E3). Sie ist von aussen unsichtbar - beide Wege
 * erzeugen dieselben Artefakte -, und genau deshalb wuerde eine falsch
 * verdrahtete Wahl nicht auffallen: die Konvertierung liefe weiter, nur eben
 * ueber den Dienst, den der Betreiber gerade abgeschaltet hat.
 */
class ConvertScoreJobTest extends TestCase {
	private IRootFolder&MockObject $rootFolder;
	private ConversionService&MockObject $conversionService;
	private SidecarClient&MockObject $sidecarClient;
	private LocalConverter&MockObject $localConverter;
	private IJobList&MockObject $jobList;
	private IAppConfig&MockObject $appConfig;
	private ITempManager&MockObject $tempManager;
	private string $backend = ConversionBackend::SIDECAR;
	private string $renderer = ConversionBackend::RENDERER_ENGINE;
	private VariantService&MockObject $variantService;
	private File&MockObject $file;
	private ?ScoreConversion $gefunden = null;

	protected function setUp(): void {
		$this->rootFolder = $this->createMock(IRootFolder::class);
		$this->conversionService = $this->createMock(ConversionService::class);
		$this->sidecarClient = $this->createMock(SidecarClient::class);
		$this->localConverter = $this->createMock(LocalConverter::class);
		$this->jobList = $this->createMock(IJobList::class);
		$this->appConfig = $this->createMock(IAppConfig::class);
		$this->tempManager = $this->createMock(ITempManager::class);
		$this->variantService = $this->createMock(VariantService::class);

		// Eine Partitur, die es gibt, die klein genug ist und noch nie
		// konvertiert wurde - alles Weitere entscheidet dann die Wegwahl.
		$file = $this->file = $this->createMock(File::class);
		$file->method('getEtag')->willReturn('etag1');
		$file->method('getSize')->willReturn(30_000);
		$file->method('getName')->willReturn('probe.mscz');
		$file->method('fopen')->willReturn(fopen('php://memory', 'rb+'));
		$folder = $this->createMock(Folder::class);
		$folder->method('getById')->willReturn([$file]);
		$this->rootFolder->method('getUserFolder')->willReturn($folder);

		$this->conversionService->method('find')->willReturnCallback(fn () => $this->gefunden);
		$this->conversionService->method('createPending')->willReturn(new ScoreConversion());
		$this->appConfig->method('getValueInt')->willReturnCallback(
			static fn (string $app, string $key, int $default = 0) => $default,
		);
	}

	private function job(): ConvertScoreJob {
		$backend = $this->createMock(ConversionBackend::class);
		$backend->method('isLocal')->willReturn($this->backend === ConversionBackend::LOCAL);
		$backend->method('sidecarRenderer')->willReturn($this->renderer);
		$backend->method('supportsVariants')->willReturn($this->backend === ConversionBackend::LOCAL || $this->renderer === ConversionBackend::RENDERER_ENGINE);

		return new ConvertScoreJob(
			$this->createMock(ITimeFactory::class),
			$this->rootFolder,
			$this->conversionService,
			$backend,
			$this->sidecarClient,
			$this->localConverter,
			$this->jobList,
			$this->appConfig,
			$this->tempManager,
			$this->createMock(LoggerInterface::class),
			$this->variantService,
		);
	}

	private function jobLaufenLassen(array $zusatz = []): void {
		$job = $this->job();
		$method = new \ReflectionMethod($job, 'run');
		$method->setAccessible(true);
		$method->invoke($job, ['userId' => 'andreas', 'fileId' => 42] + $zusatz);
	}

	public function testReichtDiePartiturBeimSidecarEinUndLaesstPollen(): void {
		// The renderer goes along with every job: the sidecar does not
		// decide it, the app's setting does.
		$this->renderer = ConversionBackend::RENDERER_MUSESCORE;
		$this->sidecarClient->expects($this->once())->method('submitConversion')
			->with($this->anything(), 'probe.mscz', ConversionBackend::RENDERER_MUSESCORE)
			->willReturn('job-1');
		$this->localConverter->expects($this->never())->method('convert');
		$this->jobList->expects($this->once())->method('add');

		$this->jobLaufenLassen();
	}

	public function testKonvertiertLokalUndFasstDenSidecarNichtAn(): void {
		// Der eigentliche Punkt: auf dem lokalen Weg darf keine einzige
		// Anfrage an den Sidecar gehen - sonst haenge eine Instanz ohne
		// Container weiterhin an einem Dienst, den es dort nicht gibt.
		$this->backend = ConversionBackend::LOCAL;
		$this->tempManager->method('getTemporaryFile')->willReturn(tempnam(sys_get_temp_dir(), 'sv'));
		$this->localConverter->method('engineVersion')->willReturn('4.7.6-engine.3');
		$this->localConverter->expects($this->once())->method('convert')->willReturn([
			'pages' => ['<svg/>'],
			'midi' => 'MThd',
			'timing' => '{"events":[],"elements":{}}',
			'measures' => '{"events":[],"elements":{}}',
			'meta' => '{"pages":1}',
		]);
		$this->sidecarClient->expects($this->never())->method('submitConversion');
		// Kein Poll-Job: es gibt nichts zu pollen, die Artefakte liegen schon vor.
		$this->jobList->expects($this->never())->method('add');
		// Der aufgezeichnete Weg gehoert zum Ergebnis: der Viewer zeigt ihn
		// an, und aus der Admin-Einstellung waere er spaeter nicht mehr
		// rekonstruierbar (sie sagt nur, was JETZT gilt).
		$this->conversionService->expects($this->once())->method('markReady')
			->with($this->anything(), ['<svg/>'], 'MThd', '{"events":[],"elements":{}}', '{"events":[],"elements":{}}', '{"pages":1}', ConversionBackend::LOCAL, '4.7.6-engine.3');

		$this->jobLaufenLassen();
	}

	public function testUebernimmtDenFehlercodeDeslokalenKonverters(): void {
		// Ohne das stuende in der Oberflaeche "unbekannter Fehler", wo der
		// Konverter genau gesagt hat, was fehlt (siehe ScoreConversion::ERROR_*).
		$this->backend = ConversionBackend::LOCAL;
		$this->tempManager->method('getTemporaryFile')->willReturn(tempnam(sys_get_temp_dir(), 'sv'));
		$this->localConverter->method('convert')->willThrowException(
			new LocalConverterException('kein node', errorCode: ScoreConversion::ERROR_LOCAL_UNAVAILABLE),
		);
		$this->conversionService->expects($this->once())->method('markError')
			->with($this->anything(), 'kein node', ScoreConversion::ERROR_LOCAL_UNAVAILABLE);

		$this->jobLaufenLassen();
	}

	public function testLehntEineZuGrosseDateiVorJedemKonvertierenAb(): void {
		// Gilt fuer beide Wege gleichermassen - die Grenze sitzt vor der
		// Wegwahl, damit sie nicht an einem der beiden vorbeigeht.
		$this->backend = ConversionBackend::LOCAL;
		$file = $this->file = $this->createMock(File::class);
		$file->method('getEtag')->willReturn('etag1');
		$file->method('getSize')->willReturn(500 * 1024 * 1024);
		$folder = $this->createMock(Folder::class);
		$folder->method('getById')->willReturn([$file]);
		$rootFolder = $this->createMock(IRootFolder::class);
		$rootFolder->method('getUserFolder')->willReturn($folder);
		$this->rootFolder = $rootFolder;

		$this->localConverter->expects($this->never())->method('convert');
		$this->conversionService->expects($this->once())->method('markError')
			->with($this->anything(), $this->anything(), ScoreConversion::ERROR_TOO_LARGE);

		$this->jobLaufenLassen();
	}

	// --- Sidecar ausgelastet (volle Warteschlange, HTTP 503) ---------------

	/**
	 * Kein Fehlercode, also nichts, was ClientFallback als
	 * Infrastrukturfehler lesen und fuer alle auf den Browser umschalten
	 * koennte. Stattdessen: zurueck auf pending, Neuversuch nach Retry-After.
	 */
	public function testAusgelasteterSidecarWirdSpaeterErneutVersuchtStattZuScheitern(): void {
		$this->sidecarClient->method('submitConversion')->willThrowException(new SidecarBusyException('voll', 30));
		$this->conversionService->expects($this->never())->method('markError');
		$this->conversionService->expects($this->once())->method('markWaiting');
		$this->jobList->expects($this->never())->method('add');
		$this->jobList->expects($this->once())->method('scheduleAfter')
			->with(ConvertScoreJob::class, 30, ['userId' => 'andreas', 'fileId' => 42, 'busyRetry' => 1]);

		$this->jobLaufenLassen();
	}

	/**
	 * @return array<string, array{int, int}>
	 */
	public static function wartezeiten(): array {
		return [
			'Null wird zur Untergrenze' => [0, 15],
			'Stunde wird zur Obergrenze' => [3600, 300],
		];
	}

	#[\PHPUnit\Framework\Attributes\DataProvider('wartezeiten')]
	public function testDieWartezeitIstGedeckelt(int $retryAfter, int $erwartet): void {
		$this->sidecarClient->method('submitConversion')->willThrowException(new SidecarBusyException('voll', $retryAfter));
		$this->jobList->expects($this->once())->method('scheduleAfter')
			->with(ConvertScoreJob::class, $erwartet, $this->anything());

		$this->jobLaufenLassen();
	}

	public function testDerNeuversuchUebergehtDenEigenenWartendenDatensatzNicht(): void {
		// Ohne busyRetry hielte der Guard den eigenen pending-Datensatz fuer
		// "laeuft schon" und der Neuversuch taete nichts.
		$this->gefunden = $this->datensatz(ScoreConversion::STATUS_PENDING);
		$this->sidecarClient->expects($this->once())->method('submitConversion')->willReturn('job-1');
		$this->jobList->expects($this->once())->method('add');

		$this->jobLaufenLassen(['busyRetry' => 3]);
	}

	public function testEinNormalerJobUeberspringtDenWartendenDatensatz(): void {
		// Sonst reichte ein zweiter Upload-Event dieselbe Partitur neben dem
		// eingeplanten Neuversuch ein zweites Mal ein.
		$this->gefunden = $this->datensatz(ScoreConversion::STATUS_PENDING);
		$this->sidecarClient->expects($this->never())->method('submitConversion');

		$this->jobLaufenLassen();
	}

	public function testEinUeberholterNeuversuchTutNichts(): void {
		// Inzwischen fertig (oder verworfen) - der eingeplante Versuch ist
		// hinfaellig.
		$this->gefunden = $this->datensatz(ScoreConversion::STATUS_READY);
		$this->sidecarClient->expects($this->never())->method('submitConversion');
		$this->conversionService->expects($this->never())->method('createPending');

		$this->jobLaufenLassen(['busyRetry' => 2]);
	}

	public function testNachDenNeuversuchenEndetEsMitEigenemCode(): void {
		$this->gefunden = $this->datensatz(ScoreConversion::STATUS_PENDING);
		$this->sidecarClient->method('submitConversion')->willThrowException(new SidecarBusyException('voll', 30));
		$this->jobList->expects($this->never())->method('scheduleAfter');
		$this->conversionService->expects($this->once())->method('markError')
			->with($this->anything(), $this->anything(), ScoreConversion::ERROR_SIDECAR_BUSY);

		$this->jobLaufenLassen(['busyRetry' => ConvertScoreJob::MAX_BUSY_RETRIES]);
	}

	private function datensatz(string $status): ScoreConversion {
		$c = new ScoreConversion();
		$c->setStatus($status);
		$c->setFormatVersion(\OCA\ScoreView\Service\ConversionService::CURRENT_FORMAT_VERSION);
		return $c;
	}

	private function variante(): ScoreVariant {
		$variant = new ScoreVariant();
		$variant->setFileId(42);
		$variant->setEtag('etag1');
		$variant->setVariant('part3~phone~w~-2');
		return $variant;
	}

	public function testVarianteUeberDenSidecarMitDerEngine(): void {
		$this->conversionService->method('readArtifact')->willReturnMap([
			[42, 'etag1', 'timing', '{"t":1}'],
			[42, 'etag1', 'measures', '{"m":1}'],
		]);
		$this->localConverter->expects($this->never())->method('convertVariant');
		$this->sidecarClient->expects($this->once())->method('convertVariant')
			->with($this->anything(), 'probe.mscz', 'part3~phone~w~-2', '{"t":1}', '{"m":1}')
			->willReturn(['pages' => ['<svg/>'], 'timing' => 'T', 'measures' => 'M', 'meta' => '{}', 'engine' => '4.7.5-engine.6']);
		// The engine version is the sidecar's, not the one bundled with the app.
		$this->variantService->expects($this->once())->method('markReady')
			->with($this->anything(), ['<svg/>'], 'T', 'M', '{}', '4.7.5-engine.6');

		$this->job()->convertVariant($this->file, $this->variante());
	}

	public function testVarianteDesSidecarsScheitertMitSeinemCode(): void {
		$this->conversionService->method('readArtifact')->willReturn('{}');
		$this->sidecarClient->method('convertVariant')->willThrowException(
			new SidecarException('too old', errorCode: ScoreVariant::ERROR_UNSUPPORTED),
		);
		$this->variantService->expects($this->once())->method('markError')
			->with($this->anything(), 'too old', ScoreVariant::ERROR_UNSUPPORTED);

		$this->job()->convertVariant($this->file, $this->variante());
	}

	public function testMitMuseScoreGibtEsKeineVariante(): void {
		$this->renderer = ConversionBackend::RENDERER_MUSESCORE;
		$this->sidecarClient->expects($this->never())->method('convertVariant');
		$this->variantService->expects($this->once())->method('markError')
			->with($this->anything(), $this->anything(), ScoreVariant::ERROR_UNSUPPORTED);

		$this->job()->convertVariant($this->file, $this->variante());
	}
}
