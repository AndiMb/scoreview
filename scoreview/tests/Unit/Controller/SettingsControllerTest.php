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
use OCP\IGroupManager;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
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
	/** @var array<string, string> */
	private array $strings = [];
	private bool $vollerAdmin = true;

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
		$this->appConfig->method('getValueString')->willReturnCallback(
			fn (string $app, string $key, string $default = '') => $this->strings[$key] ?? $default,
		);
		$this->appConfig->method('setValueString')->willReturnCallback(function (string $app, string $key, string $value): bool {
			$this->strings[$key] = $value;
			return true;
		});
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
			$this->sitzung(),
			$this->gruppen(),
			$this->l10n(),
		);
	}

	private function sitzung(): IUserSession {
		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('admin');
		$session = $this->createMock(IUserSession::class);
		$session->method('getUser')->willReturn($user);
		return $session;
	}

	private function gruppen(): IGroupManager {
		$gruppen = $this->createMock(IGroupManager::class);
		$gruppen->method('isAdmin')->willReturnCallback(fn (string $uid) => $uid === 'admin' && $this->vollerAdmin);
		return $gruppen;
	}

	private function l10n(): IL10N {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		return $l;
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

	public function testOhneKonvertierungswegBleibtErUnveraendert(): void {
		// Ein POST ohne das Feld darf nicht still auf einen anderen Weg
		// umschalten.
		$this->controller()->update(followPollMs: 800);

		$this->assertArrayNotHasKey(ConversionBackend::CONFIG_KEY, $this->strings);
		$this->assertArrayNotHasKey('node_path', $this->strings);
		$this->assertArrayNotHasKey('sidecar_url', $this->strings);
	}

	public function testOhneFelderBleibenSofortkonvertierungUndSoundFontAdresse(): void {
		// Ein POST ohne die Felder setzte frueher "aus" bzw. leer.
		$this->bools['eager_conversion'] = true;
		$this->strings['soundfont_url'] = 'https://example.org/sf.sf3';

		$this->controller()->update(followPollMs: 800);

		$this->assertTrue($this->bools['eager_conversion']);
		$this->assertSame('https://example.org/sf.sf3', $this->strings['soundfont_url']);
	}

	public function testMitFeldernWerdenSofortkonvertierungUndSoundFontAdresseGeschrieben(): void {
		$this->bools['eager_conversion'] = true;
		$this->strings['soundfont_url'] = 'https://example.org/sf.sf3';

		$this->controller()->update(eagerConversion: false, soundFontUrl: ' ');

		$this->assertFalse($this->bools['eager_conversion']);
		$this->assertSame('', $this->strings['soundfont_url']);
	}

	public function testDelegierteAdminDarfDenNodePfadNichtAendern(): void {
		// Der node-Pfad wird per proc_open ausgefuehrt: Aus "darf
		// ScoreView-Einstellungen pflegen" wuerde sonst Codeausfuehrung.
		$this->vollerAdmin = false;
		$this->strings['node_path'] = '/usr/bin/node';

		$antwort = $this->controller()->update(nodePath: '/tmp/node', followPollMs: 900);

		$this->assertSame(403, $antwort->getStatus());
		$this->assertSame('admin_only', $antwort->getData()['reason']);
		$this->assertSame(['nodePath'], $antwort->getData()['fields']);
		$this->assertSame('/usr/bin/node', $this->strings['node_path']);
		$this->assertArrayNotHasKey(FeatureConfig::FOLLOW_POLL_MS, $this->ints, 'eine abgelehnte Anfrage aendert gar nichts');
	}

	public function testDelegierteAdminDarfSidecarUndSoundFontQuelleNichtAendern(): void {
		$this->vollerAdmin = false;

		$antwort = $this->controller()->update(
			sidecarUrl: 'http://169.254.169.254',
			sidecarSecret: 'neu',
			soundFontFetchUrl: 'http://intern.example/sf2',
		);

		$this->assertSame(403, $antwort->getStatus());
		$this->assertSame(['sidecarUrl', 'soundFontFetchUrl', 'sidecarSecret'], $antwort->getData()['fields']);
		$this->assertSame([], $this->strings);
	}

	public function testDelegierteAdminSpeichertDasFormularMitUnveraendertenFeldern(): void {
		// Das Formular schickt immer alle Felder mit. Unveraendert ist keine
		// Aenderung - sonst scheiterte jedes Speichern der Aufnahmegrenzen.
		$this->vollerAdmin = false;
		$this->strings = ['node_path' => '/usr/bin/node', 'sidecar_url' => 'http://sidecar:8765'];

		$antwort = $this->controller()->update(
			sidecarUrl: 'http://sidecar:8765',
			sidecarSecret: '',
			conversionBackend: ConversionBackend::LOCAL,
			nodePath: ' /usr/bin/node ',
			soundFontFetchUrl: '',
			followPollMs: 900,
		);

		$this->assertSame(200, $antwort->getStatus());
		$this->assertSame(900, $this->ints[FeatureConfig::FOLLOW_POLL_MS]);
		$this->assertSame(ConversionBackend::LOCAL, $this->strings[ConversionBackend::CONFIG_KEY]);
	}

	/**
	 * @return array<string, array{string, bool}>
	 */
	public static function nodePfade(): array {
		return [
			'leer = automatisch suchen' => ['', true],
			'Standardpfad' => ['/usr/bin/node', true],
			'nvm' => ['/home/nc/.nvm/versions/node/v22.1.0/bin/node', true],
			'aelteres Debian' => ['/usr/bin/nodejs', true],
			'versioniert' => ['/usr/bin/node-20', true],
			'Windows' => ['C:\\Program Files\\nodejs\\node.exe', true],
			'relativ' => ['node', false],
			'fremdes Programm' => ['/bin/sh', false],
			'Name nur als Praefix' => ['/tmp/node-evil.sh', false],
			'Steuerzeichen' => ["/usr/bin/node\n", false],
		];
	}

	#[DataProvider('nodePfade')]
	public function testPrueftDenNodePfad(string $pfad, bool $gueltig): void {
		$this->assertSame($gueltig, SettingsController::isValidNodePath($pfad));
	}

	public function testUngueltigerNodePfadWirdAuchVollenAdminsAbgelehnt(): void {
		$antwort = $this->controller()->update(nodePath: '/bin/sh');

		$this->assertSame(400, $antwort->getStatus());
		$this->assertSame('invalid_node_path', $antwort->getData()['reason']);
		$this->assertArrayNotHasKey('node_path', $this->strings);
	}

	public function testVolleAdminSetztEinenGueltigenNodePfad(): void {
		$antwort = $this->controller()->update(nodePath: ' /usr/local/bin/node ');

		$this->assertSame(200, $antwort->getStatus());
		$this->assertSame('/usr/local/bin/node', $this->strings['node_path']);
	}

	public function testEinUnveraenderterAlterWertBlockiertDasSpeichernNicht(): void {
		// Per occ gesetzt, ausserhalb der Regeln - soll das Formular nicht
		// dauerhaft unspeicherbar machen.
		$this->strings['node_path'] = 'node';

		$this->assertSame(200, $this->controller()->update(nodePath: 'node')->getStatus());
	}

	/**
	 * @return array<string, array{string, bool}>
	 */
	public static function adressen(): array {
		return [
			'leer' => ['', true],
			'http' => ['http://scoreview-sidecar:8765', true],
			'https' => ['https://example.org/sf/MS%20Basic.sf3', true],
			'file' => ['file:///etc/passwd', false],
			'gopher' => ['gopher://intern:70/x', false],
			'ohne Host' => ['http://', false],
			'ohne Schema' => ['scoreview-sidecar:8765', false],
			'Leerzeichen' => ['http://a b', false],
		];
	}

	#[DataProvider('adressen')]
	public function testPrueftServerAdressen(string $url, bool $gueltig): void {
		$this->assertSame($gueltig, SettingsController::isValidServerUrl($url));
	}

	public function testUngueltigeAdresseWirdAbgelehnt(): void {
		$antwort = $this->controller()->update(sidecarUrl: 'file:///etc/passwd');

		$this->assertSame(400, $antwort->getStatus());
		$this->assertSame('invalid_url', $antwort->getData()['reason']);
		$this->assertSame(['sidecarUrl'], $antwort->getData()['fields']);
	}
}
