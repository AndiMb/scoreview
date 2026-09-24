<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\FeatureConfig;
use OCP\IAppConfig;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Die Zahlenwerte kommen aus zwei Richtungen - dem Admin-Formular und
 * `occ config:app:set` - und nur das Formular prueft. Gelesen wird deshalb
 * IMMER begrenzt: Ein Abfrageintervall von 0 ms waere bei 40 Folgegeraeten
 * eine selbstgebaute Lastprobe.
 */
class FeatureConfigTest extends TestCase {
	/**
	 * @param array<string, int> $gespeichert
	 */
	private function config(array $gespeichert = [], array $schalter = []): FeatureConfig {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueInt')->willReturnCallback(
			fn (string $app, string $key, int $default) => $gespeichert[$key] ?? $default,
		);
		$appConfig->method('getValueBool')->willReturnCallback(
			fn (string $app, string $key, bool $default) => $schalter[$key] ?? $default,
		);
		return new FeatureConfig($appConfig);
	}

	public function testVorgaben(): void {
		$config = $this->config();

		$this->assertSame(800, $config->followPollMs());
		$this->assertSame(5, $config->maxRecordingsPerScore());
		$this->assertSame(600, $config->maxRecordingSeconds());
		$this->assertTrue($config->isEnabled(FeatureConfig::FOLLOW_SESSION));
		$this->assertTrue($config->isEnabled(FeatureConfig::RECORDING));
		$this->assertTrue($config->isEnabled(FeatureConfig::INTONATION));
		// Das Mitverfolgen ist nicht gebaut - ein Schalter auf „an" waere
		// eine falsche Auskunft.
		$this->assertFalse($config->isEnabled(FeatureConfig::SCORE_FOLLOWER));
	}

	/**
	 * @return array<string, array{int, int}>
	 */
	public static function abfrageintervalle(): array {
		return [
			'zu klein' => [0, 500],
			'Untergrenze' => [500, 500],
			'mittendrin' => [1200, 1200],
			'Obergrenze' => [3000, 3000],
			'zu gross' => [60000, 3000],
			'negativ' => [-1, 500],
		];
	}

	#[DataProvider('abfrageintervalle')]
	public function testBegrenztDasAbfrageintervallBeimLesen(int $gespeichert, int $erwartet): void {
		$this->assertSame($erwartet, $this->config([FeatureConfig::FOLLOW_POLL_MS => $gespeichert])->followPollMs());
	}

	public function testBegrenztDieAufnahmewerteBeimLesen(): void {
		$config = $this->config([
			FeatureConfig::MAX_RECORDINGS_PER_SCORE => 0,
			FeatureConfig::MAX_RECORDING_SECONDS => 999999,
		]);

		$this->assertSame(1, $config->maxRecordingsPerScore());
		$this->assertSame(3600, $config->maxRecordingSeconds());
	}

	public function testSpeichergrenzenDerAufnahmenMitVorgabeUndBegrenzung(): void {
		$vorgabe = $this->config([]);
		$this->assertSame(200 * 1024 * 1024, $vorgabe->maxRecordingBytesPerUser());
		$this->assertSame(5 * 1024 * 1024 * 1024, $vorgabe->maxRecordingBytesTotal());

		$unsinn = $this->config([
			FeatureConfig::MAX_RECORDING_BYTES_PER_USER => 1,
			FeatureConfig::MAX_RECORDING_BYTES_TOTAL => 1,
		]);
		$this->assertSame(10 * 1024 * 1024, $unsinn->maxRecordingBytesPerUser());
		$this->assertSame(100 * 1024 * 1024, $unsinn->maxRecordingBytesTotal());
	}

	public function testSpeichertBegrenztUndAntwortetMitDemGespeicherten(): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects($this->once())->method('setValueInt')
			->with(Application::APP_ID, FeatureConfig::FOLLOW_POLL_MS, 500);

		$this->assertSame(500, (new FeatureConfig($appConfig))->setNumber(FeatureConfig::FOLLOW_POLL_MS, 100));
	}

	public function testKenntKeineErfundenenSchalter(): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects($this->never())->method('setValueBool');
		$config = new FeatureConfig($appConfig);

		$config->setEnabled('feature_alles', true);
		$this->assertFalse($config->isEnabled('feature_alles'));
	}

	public function testUnbekannterZahlenwertIstEinProgrammierfehler(): void {
		$this->expectException(\InvalidArgumentException::class);
		FeatureConfig::clamp('max_irgendwas', 3);
	}

	public function testLiefertDemViewerAllesAufEinmal(): void {
		$daten = $this->config([FeatureConfig::FOLLOW_POLL_MS => 1000], [FeatureConfig::RECORDING => false])->forViewer();

		$this->assertSame([
			'followSession' => true,
			'recording' => false,
			'intonation' => true,
			'scoreFollower' => false,
			'followPollMs' => 1000,
			'maxRecordingsPerScore' => 5,
			'maxRecordingSeconds' => 600,
		], $daten);
	}
}
