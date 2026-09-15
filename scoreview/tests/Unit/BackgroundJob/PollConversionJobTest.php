<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\BackgroundJob;

use OCA\ScoreView\BackgroundJob\PollConversionJob;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\SidecarClient;
use OCA\ScoreView\Service\SidecarException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Dieser Job ist die einzige Stelle, an der Daten aus einem FREMDEN Dienst in
 * den Cache der App gelangen - entsprechend liegt der Schwerpunkt darauf, was
 * er einer unerwarteten Sidecar-Antwort gegenueber tut.
 *
 * Die Zusagen:
 *
 * - Ein Statusabruf, der scheitert, endet als Fehler MIT Code - nicht als
 *   stehengebliebenes `processing` (das waere seit ConversionService::isStale
 *   zwar heilbar, aber erst nach einer halben Stunde).
 * - Eine ueberschrittene Frist endet als `timeout`, nicht als endlose
 *   Poll-Kette.
 * - Artefaktpfade aus der Sidecar-Antwort werden geprueft, bevor sie zu einer
 *   URL werden (SidecarClient::fetchFile).
 */
class PollConversionJobTest extends TestCase {
	private ConversionService&MockObject $conversionService;
	private SidecarClient&MockObject $sidecarClient;
	private IJobList&MockObject $jobList;
	private ITimeFactory&MockObject $time;

	protected function setUp(): void {
		$this->conversionService = $this->createMock(ConversionService::class);
		$this->sidecarClient = $this->createMock(SidecarClient::class);
		$this->jobList = $this->createMock(IJobList::class);
		$this->time = $this->createMock(ITimeFactory::class);
		$this->time->method('getTime')->willReturn(1_000_000);
	}

	private function job(): PollConversionJob {
		return new PollConversionJob(
			$this->time,
			$this->conversionService,
			$this->sidecarClient,
			$this->jobList,
			$this->createMock(LoggerInterface::class),
		);
	}

	/**
	 * `run()` ist protected (QueuedJob) - aufgerufen wird es hier direkt,
	 * statt ueber start() eine echte Job-Infrastruktur zu brauchen.
	 *
	 * @param array<string, mixed> $argument
	 */
	private function laufenLassen(array $argument): void {
		$job = $this->job();
		$methode = new \ReflectionMethod($job, 'run');
		$methode->invoke($job, $argument);
	}

	/**
	 * @return array<string, mixed>
	 */
	private function argument(int $deadline = 1_000_300): array {
		return ['fileId' => 42, 'etag' => 'etag1', 'jobId' => 'abc', 'deadline' => $deadline];
	}

	private function datensatz(): ScoreConversion {
		$conversion = new ScoreConversion();
		$conversion->setFileId(42);
		$conversion->setEtag('etag1');
		$conversion->setStatus(ScoreConversion::STATUS_PROCESSING);
		return $conversion;
	}

	/**
	 * Die Artefaktpfade, wie der Sidecar sie tatsaechlich baut
	 * (sidecar/scoreview_sidecar/app.py, convert_status).
	 *
	 * @return array<string, string>
	 */
	private static function echteDateien(): array {
		return [
			'pages' => ['/convert/abc/artifact/page-1'],
			'midi' => '/convert/abc/artifact/midi',
			'timingJson' => '/convert/abc/artifact/timing',
			'measuresJson' => '/convert/abc/artifact/measures',
			'metaJson' => '/convert/abc/artifact/meta',
		];
	}

	// --- Der Normalfall ----------------------------------------------------

	public function testEineFertigeKonvertierungLandetImCache(): void {
		$conversion = $this->datensatz();
		$this->conversionService->method('find')->willReturn($conversion);
		$this->sidecarClient->method('pollStatus')
			->willReturn(['status' => 'ready', 'files' => self::echteDateien()]);
		$this->sidecarClient->method('fetchFile')->willReturn('inhalt');

		// Die Herkunft steht hier fest: diesen Job gibt es nur auf dem
		// Sidecar-Weg. Wird sie je nachgeschlagen statt gesetzt, faellt es hier auf.
		$this->conversionService->expects($this->once())
			->method('markReady')
			->with($conversion, ['inhalt'], 'inhalt', 'inhalt', 'inhalt', 'inhalt', ConversionBackend::SIDECAR);

		$this->laufenLassen($this->argument());
	}

	// --- Unerwartete Antworten ---------------------------------------------

	/**
	 * Pfade, die den Host wechseln wuerden. `getBaseUrl() . $pfad` ist reine
	 * Zeichenverkettung - ohne Pruefung ginge die Anfrage samt Secret-Header
	 * an eine fremde Adresse.
	 *
	 * @return array<string, array{string}>
	 */
	public static function fremdePfade(): array {
		return [
			'Userinfo-Trick' => ['@example.invalid/x'],
			'netzwerkrelativ' => ['//example.invalid/x'],
			'eigenes Schema' => ['https://example.invalid/x'],
			'Doppelpunkt' => ['/convert:8080/x'],
			'Aufstieg' => ['/convert/../../etc/passwd'],
			'Aufstieg getarnt' => ['/convert/abc/..%2fx'],
			'kein fuehrender Schraegstrich' => ['convert/abc/artifact/midi'],
			'leer' => [''],
		];
	}

	#[DataProvider('fremdePfade')]
	public function testEinFremderArtefaktpfadWirdAbgelehnt(string $pfad): void {
		// Bewusst gegen den ECHTEN SidecarClient, nicht gegen einen Mock: Die
		// Pruefung sitzt dort, und ein Mock haette sie wegdefiniert.
		$client = new SidecarClient(
			$this->createMock(\OCP\Http\Client\IClientService::class),
			$this->createMock(\OCP\IAppConfig::class),
		);

		$this->expectException(SidecarException::class);
		$client->fetchFile($pfad);
	}

	public function testEinRegulaererArtefaktpfadWirdNichtAbgelehnt(): void {
		$clientService = $this->createMock(\OCP\Http\Client\IClientService::class);
		$response = $this->createMock(\OCP\Http\Client\IResponse::class);
		$response->method('getBody')->willReturn('inhalt');
		$httpClient = $this->createMock(\OCP\Http\Client\IClient::class);
		$httpClient->method('get')->willReturn($response);
		$clientService->method('newClient')->willReturn($httpClient);

		$client = new SidecarClient($clientService, $this->createMock(\OCP\IAppConfig::class));

		$this->assertSame('inhalt', $client->fetchFile('/convert/abc/artifact/page-1'));
	}

	public function testEinGescheiterterAbrufEndetAlsFehlerMitCode(): void {
		$this->conversionService->method('find')->willReturn($this->datensatz());
		$this->sidecarClient->method('pollStatus')->willThrowException(
			new SidecarException('weg', 0, null, ScoreConversion::ERROR_SIDECAR_UNREACHABLE));

		$this->conversionService->expects($this->once())
			->method('markError')
			->with($this->anything(), $this->anything(), ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		$this->jobList->expects($this->never())->method('scheduleAfter');

		$this->laufenLassen($this->argument());
	}

	/**
	 * Die einzige textbasierte Codeerkennung der App - sie haengt an der
	 * genauen Meldung aus jobs.py. Bricht die, faellt es hier auf.
	 */
	public function testEinePartiturOhneSeitenBekommtIhrenEigenenCode(): void {
		$this->conversionService->method('find')->willReturn($this->datensatz());
		$this->sidecarClient->method('pollStatus')->willReturn([
			'status' => 'error',
			'error' => 'mscore4portable --score-media returned no SVG pages.',
		]);

		$this->conversionService->expects($this->once())
			->method('markError')
			->with($this->anything(), $this->anything(), ScoreConversion::ERROR_NO_PAGES);

		$this->laufenLassen($this->argument());
	}

	// --- Fristen und Selbstaufgabe ------------------------------------------

	public function testEineUeberschritteneFristEndetAlsTimeout(): void {
		$this->conversionService->method('find')->willReturn($this->datensatz());
		$this->sidecarClient->method('pollStatus')->willReturn(['status' => 'processing']);

		$this->conversionService->expects($this->once())
			->method('markError')
			->with($this->anything(), $this->anything(), ScoreConversion::ERROR_TIMEOUT);
		$this->jobList->expects($this->never())->method('scheduleAfter');

		$this->laufenLassen($this->argument(deadline: 999_999));
	}

	public function testVorDerFristWirdWeiterGepollt(): void {
		$this->conversionService->method('find')->willReturn($this->datensatz());
		$this->sidecarClient->method('pollStatus')->willReturn(['status' => 'processing']);

		$this->conversionService->expects($this->never())->method('markError');
		$this->jobList->expects($this->once())->method('scheduleAfter');

		$this->laufenLassen($this->argument(deadline: 1_000_300));
	}

	/**
	 * Wurde die Datei in der Zwischenzeit neu geschrieben, gehoert dieser
	 * Poll-Strang zu einem etag, den niemand mehr ansieht - dann darf er auch
	 * nichts mehr anfassen.
	 */
	public function testEinObsoleterPollStrangTutNichts(): void {
		$this->conversionService->method('find')->willReturn(null);

		$this->sidecarClient->expects($this->never())->method('pollStatus');
		$this->conversionService->expects($this->never())->method('markError');
		$this->jobList->expects($this->never())->method('scheduleAfter');

		$this->laufenLassen($this->argument());
	}
}
