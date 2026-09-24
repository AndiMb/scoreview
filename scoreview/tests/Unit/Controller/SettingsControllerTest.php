<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\SettingsController;
use OCA\ScoreView\Service\ClientFallback;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\HealthService;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\PushNotifier;
use OCA\ScoreView\Service\SidecarClient;
use OCP\IAppConfig;
use OCP\IRequest;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Die Schalter und das Abfrageintervall der Probefunktionen im
 * Admin-Formular. Zwei Zusagen:
 *
 * 1. **Das Abfrageintervall wird begrenzt, nicht abgelehnt** - und die
 *    Antwort nennt den gespeicherten Wert, damit das Formular ihn zeigt.
 * 2. **Ein fehlendes Feld aendert nichts.** Ein Formular aus einer aelteren
 *    Version, das nur die Sidecar-URL kennt, darf beim Speichern keine
 *    Funktion nebenbei abschalten.
 */
class SettingsControllerTest extends TestCase {
	private IAppConfig&MockObject $appConfig;
	private PushNotifier&MockObject $push;
	/** @var array<string, int> */
	private array $ints = [];
	/** @var array<string, bool> */
	private array $bools = [];

	protected function setUp(): void {
		$this->push = $this->createMock(PushNotifier::class);
		$this->appConfig = $this->createMock(IAppConfig::class);
		$this->appConfig->method('setValueInt')->willReturnCallback(function (string $app, string $key, int $value): bool {
			$this->ints[$key] = $value;
			return true;
		});
		$this->appConfig->method('getValueInt')->willReturnCallback(
			fn (string $app, string $key, int $default = 0) => $this->ints[$key] ?? $default,
		);
		$this->appConfig->method('getValueBool')->willReturnCallback(
			fn (string $app, string $key, bool $default = false) => $this->bools[$key] ?? $default,
		);
		$this->appConfig->method('setValueBool')->willReturnCallback(function (string $app, string $key, bool $value): bool {
			$this->bools[$key] = $value;
			return true;
		});
	}

	private function controller(): SettingsController {
		return new SettingsController(
			$this->createMock(IRequest::class),
			$this->appConfig,
			$this->createMock(HealthService::class),
			$this->createMock(ConversionBackend::class),
			$this->createMock(SidecarClient::class),
			$this->createMock(LocalConverter::class),
			$this->createMock(ClientFallback::class),
			new FeatureConfig($this->appConfig),
			$this->push,
		);
	}

	private function speichern(?int $followPollMs = null, ?bool $folgen = null, ?bool $aufnahme = null): array {
		return $this->controller()->update(
			'', '', false, '', ConversionBackend::LOCAL, '', '',
			$folgen, $aufnahme, null, null, $followPollMs,
		)->getData();
	}

	/**
	 * @return array<string, array{int, int}>
	 */
	public static function grenzen(): array {
		return [
			'unter der Untergrenze' => [100, 500],
			'Untergrenze' => [500, 500],
			'Vorgabe' => [800, 800],
			'Obergrenze' => [3000, 3000],
			'ueber der Obergrenze' => [10000, 3000],
		];
	}

	#[DataProvider('grenzen')]
	public function testBegrenztDasAbfrageintervall(int $eingabe, int $gespeichert): void {
		$antwort = $this->speichern($eingabe);

		$this->assertSame($gespeichert, $this->ints[FeatureConfig::FOLLOW_POLL_MS]);
		$this->assertSame($gespeichert, $antwort['followPollMs'], 'die Antwort nennt den gespeicherten Wert');
	}

	public function testGrenzenDerAufnahmenInMegabyteUndBegrenzt(): void {
		$daten = $this->controller()->update(
			'', '', false, '', ConversionBackend::LOCAL, '', '',
			null, null, null, null, null,
			0, 99999, 300, null,
		)->getData();

		$this->assertSame(1, $daten['maxRecordingsPerScore']);
		$this->assertSame(3600, $daten['maxRecordingSeconds']);
		$this->assertSame(300, $daten['maxRecordingMbPerUser']);
		$this->assertSame(300 * 1024 * 1024, $this->ints[FeatureConfig::MAX_RECORDING_BYTES_PER_USER]);
		// Nicht uebergeben: bleibt, wie es ist, und die Antwort nennt es.
		$this->assertSame(5120, $daten['maxRecordingMbTotal']);
		$this->assertArrayNotHasKey(FeatureConfig::MAX_RECORDING_BYTES_TOTAL, $this->ints);
	}

	public function testOhneIntervallBleibtDerGespeicherteWert(): void {
		$this->ints[FeatureConfig::FOLLOW_POLL_MS] = 1500;

		$antwort = $this->speichern();

		$this->assertSame(1500, $antwort['followPollMs']);
		$this->assertSame(1500, $this->ints[FeatureConfig::FOLLOW_POLL_MS]);
	}

	public function testSetztNurDieUebergebenenSchalter(): void {
		$this->speichern(null, false, true);

		$this->assertSame([
			FeatureConfig::FOLLOW_SESSION => false,
			FeatureConfig::RECORDING => true,
		], array_intersect_key($this->bools, FeatureConfig::SWITCHES));
		$this->assertArrayNotHasKey(FeatureConfig::INTONATION, $this->bools);
		$this->assertArrayNotHasKey(FeatureConfig::SCORE_FOLLOWER, $this->bools);
		// Der bestehende Schalter laeuft unveraendert mit.
		$this->assertArrayHasKey('eager_conversion', $this->bools);
	}

	/**
	 * Die Betriebsdiagnose nennt fuer „Folgt mir", ob Push greift (E10) -
	 * ohne Push fragen alle Geraete ab, und das soll die Administration
	 * sehen, bevor es der Server spuert.
	 */
	#[DataProvider('pushFaelle')]
	public function testDiagnoseNenntPushUndEmpfehlung(bool $push): void {
		$this->push->method('isAvailable')->willReturn($push);
		$this->ints[FeatureConfig::FOLLOW_POLL_MS] = 1200;

		$follow = $this->controller()->health()->getData()['follow'];

		$this->assertSame([
			'enabled' => true,
			'pushAvailable' => $push,
			'pollMs' => 1200,
			'recommendPushFromDevices' => 20,
		], $follow);
	}

	public static function pushFaelle(): array {
		return ['mit Push' => [true], 'ohne Push' => [false]];
	}
}
