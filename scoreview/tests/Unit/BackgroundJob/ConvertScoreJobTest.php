<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\BackgroundJob;

use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\LocalConverterException;
use OCA\ScoreView\Service\SidecarClient;
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

	protected function setUp(): void {
		$this->rootFolder = $this->createMock(IRootFolder::class);
		$this->conversionService = $this->createMock(ConversionService::class);
		$this->sidecarClient = $this->createMock(SidecarClient::class);
		$this->localConverter = $this->createMock(LocalConverter::class);
		$this->jobList = $this->createMock(IJobList::class);
		$this->appConfig = $this->createMock(IAppConfig::class);
		$this->tempManager = $this->createMock(ITempManager::class);

		// Eine Partitur, die es gibt, die klein genug ist und noch nie
		// konvertiert wurde - alles Weitere entscheidet dann die Wegwahl.
		$file = $this->createMock(File::class);
		$file->method('getEtag')->willReturn('etag1');
		$file->method('getSize')->willReturn(30_000);
		$file->method('getName')->willReturn('probe.mscz');
		$file->method('fopen')->willReturn(fopen('php://memory', 'rb+'));
		$folder = $this->createMock(Folder::class);
		$folder->method('getById')->willReturn([$file]);
		$this->rootFolder->method('getUserFolder')->willReturn($folder);

		$this->conversionService->method('find')->willReturn(null);
		$this->conversionService->method('createPending')->willReturn(new ScoreConversion());
		$this->appConfig->method('getValueInt')->willReturnCallback(
			static fn (string $app, string $key, int $default = 0) => $default,
		);
	}

	private function jobLaufenLassen(): void {
		$backend = $this->createMock(ConversionBackend::class);
		$backend->method('isLocal')->willReturn($this->backend === ConversionBackend::LOCAL);

		$job = new ConvertScoreJob(
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
		);
		$method = new \ReflectionMethod($job, 'run');
		$method->setAccessible(true);
		$method->invoke($job, ['userId' => 'andreas', 'fileId' => 42]);
	}

	public function testReichtDiePartiturBeimSidecarEinUndLaesstPollen(): void {
		$this->sidecarClient->expects($this->once())->method('submitConversion')->willReturn('job-1');
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
		$this->conversionService->expects($this->once())->method('markReady')
			->with($this->anything(), ['<svg/>'], 'MThd', '{"events":[],"elements":{}}', '{"events":[],"elements":{}}', '{"pages":1}');

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
		$file = $this->createMock(File::class);
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
}
