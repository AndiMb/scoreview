<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\Recording;
use OCA\ScoreView\Db\RecordingMapper;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\RecordingException;
use OCA\ScoreView\Service\RecordingService;
use OCA\ScoreView\Service\RecordingStorage;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\NotFoundException;
use OCP\IAppConfig;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Die Regeln fuer eigene Aufnahmen (S5 und S8 in docs/architecture.md):
 *
 * - Nichts wird still ueberschrieben: an der Obergrenze nur mit Bestaetigung.
 * - Die Grenzen greifen VOR dem Schreiben, und was das Ersetzen freigibt,
 *   zaehlt schon als frei.
 * - Die verdraengte Aufnahme geht erst, wenn die neue liegt.
 * - Fremd ist nicht da.
 */
class RecordingServiceTest extends TestCase {
	private RecordingMapper&MockObject $mapper;
	private RecordingStorage&MockObject $storage;
	/** @var array<string, int> */
	private array $ints = [];

	protected function setUp(): void {
		$this->mapper = $this->createMock(RecordingMapper::class);
		$this->storage = $this->createMock(RecordingStorage::class);
		$this->storage->method('store')->willReturnCallback(function (Recording $r) {
			$r->setId(99);
			return $r;
		});
	}

	private function service(): RecordingService {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueInt')->willReturnCallback(
			fn (string $app, string $key, int $default = 0) => $this->ints[$key] ?? $default,
		);
		$time = $this->createMock(ITimeFactory::class);
		$time->method('getDateTime')->willReturn(new \DateTime('2026-09-24 10:00:00'));
		return new RecordingService($this->mapper, $this->storage, new FeatureConfig($appConfig), $time);
	}

	private function vorhanden(int $anzahl, int $groesse = 1000): array {
		$liste = [];
		for ($i = 1; $i <= $anzahl; $i++) {
			$r = new Recording();
			$r->setId($i);
			$r->setSizeBytes($groesse);
			$liste[] = $r;
		}
		$this->mapper->method('findByFileAndUser')->with(42, 'anna')->willReturn($liste);
		return $liste;
	}

	private const META = ['scoreStartMs' => 1234, 'tempoFactor' => 0.8, 'withAccompaniment' => true];

	private function erzeugen(string $wav, bool $ersetzen = false): Recording {
		return $this->service()->create(42, 'anna', self::strom($wav), self::META, $ersetzen);
	}

	/**
	 * Der Rumpf so, wie ihn der Controller weiterreicht: als Strom.
	 *
	 * @return resource
	 */
	public static function strom(string $bytes) {
		$strom = fopen('php://memory', 'w+b');
		fwrite($strom, $bytes);
		rewind($strom);
		return $strom;
	}

	private function aufnahme(int $id): Recording {
		$r = new Recording();
		$r->setId($id);
		$r->setSizeBytes(1000);
		return $r;
	}

	private function grund(callable $fn): string {
		try {
			$fn();
		} catch (RecordingException $e) {
			return $e->getReason();
		}
		$this->fail('Keine RecordingException');
	}

	public function testSpeichertMitDauerAusDenBytesUndDenAngabenZumAbgleich(): void {
		$this->vorhanden(0);
		$this->storage->expects($this->once())->method('store');
		$this->storage->expects($this->never())->method('delete');

		$r = $this->erzeugen(WavFormatTest::wav(24000));

		$this->assertSame(1500, $r->getDurationMs());
		$this->assertSame('anna', $r->getUserId());
		$this->assertSame(42, $r->getFileId());
		$this->assertSame(1234, $r->getScoreStartMs());
		$this->assertSame(0.8, $r->getTempoFactor());
		$this->assertTrue($r->getWithAccompaniment());
	}

	public function testKeineWavIstUngueltig(): void {
		$this->vorhanden(0);
		$this->storage->expects($this->never())->method('store');
		$this->assertSame(RecordingException::INVALID, $this->grund(fn () => $this->erzeugen('kein Ton')));
	}

	public function testZuLangIstAbgelehnt(): void {
		$this->ints[FeatureConfig::MAX_RECORDING_SECONDS] = 10;
		$this->vorhanden(0);
		$this->storage->expects($this->never())->method('store');
		$this->assertSame(RecordingException::TOO_LONG, $this->grund(fn () => $this->erzeugen(WavFormatTest::wav(16000 * 11))));
	}

	public function testAnDerObergrenzeOhneBestaetigungNichts(): void {
		$this->vorhanden(5);
		$this->storage->expects($this->never())->method('store');
		$this->storage->expects($this->never())->method('delete');
		$this->assertSame(RecordingException::LIMIT_REACHED, $this->grund(fn () => $this->erzeugen(WavFormatTest::wav(100))));
	}

	public function testMitBestaetigungGehtDieAeltesteNachDemSchreiben(): void {
		$liste = $this->vorhanden(5);
		$reihenfolge = [];
		$this->storage = $this->createMock(RecordingStorage::class);
		$this->storage->method('store')->willReturnCallback(function (Recording $r) use (&$reihenfolge) {
			$reihenfolge[] = 'store';
			return $r;
		});
		$this->storage->expects($this->once())->method('delete')->with($liste[0])
			->willReturnCallback(function () use (&$reihenfolge) {
				$reihenfolge[] = 'delete';
			});

		$this->erzeugen(WavFormatTest::wav(100), true);

		$this->assertSame(['store', 'delete'], $reihenfolge);
	}

	public function testGesenkteObergrenzeVerdraengtSovieleWieNoetig(): void {
		$this->ints[FeatureConfig::MAX_RECORDINGS_PER_SCORE] = 2;
		$liste = $this->vorhanden(4);
		$geloescht = [];
		$this->storage->method('delete')->willReturnCallback(function (Recording $r) use (&$geloescht) {
			$geloescht[] = $r->getId();
		});

		$this->erzeugen(WavFormatTest::wav(100), true);

		$this->assertSame([1, 2, 3], $geloescht);
	}

	public function testSpeicherJePersonVoll(): void {
		$this->ints[FeatureConfig::MAX_RECORDING_BYTES_PER_USER] = 10 * 1024 * 1024;
		$this->vorhanden(0);
		$this->mapper->method('sumSizeByUser')->willReturn(10 * 1024 * 1024 - 100);
		$this->storage->expects($this->never())->method('store');

		$this->assertSame(RecordingException::USER_STORAGE_FULL, $this->grund(fn () => $this->erzeugen(WavFormatTest::wav(1000))));
	}

	public function testErsetzenZaehltAlsFrei(): void {
		$this->ints[FeatureConfig::MAX_RECORDING_BYTES_PER_USER] = 10 * 1024 * 1024;
		$this->vorhanden(5, 5000);
		// Ohne die 5000 Bytes der aeltesten waere es zu viel.
		$this->mapper->method('sumSizeByUser')->willReturn(10 * 1024 * 1024 - 1000);
		$this->storage->expects($this->once())->method('store');

		$this->erzeugen(WavFormatTest::wav(1000), true);
	}

	public function testSpeicherDerInstanzVoll(): void {
		$this->ints[FeatureConfig::MAX_RECORDING_BYTES_TOTAL] = 100 * 1024 * 1024;
		$this->vorhanden(0);
		$this->mapper->method('sumSizeByUser')->willReturn(0);
		$this->mapper->method('sumSizeTotal')->willReturn(100 * 1024 * 1024);
		$this->storage->expects($this->never())->method('store');

		$this->assertSame(RecordingException::TOTAL_STORAGE_FULL, $this->grund(fn () => $this->erzeugen(WavFormatTest::wav(10))));
	}

	public function testFremdeAufnahmeIstNichtDa(): void {
		$this->mapper->method('findOwn')->with(7, 42, 'ben')->willReturn(null);
		$this->storage->expects($this->never())->method('open');
		$this->storage->expects($this->never())->method('delete');

		$this->assertSame(RecordingException::NOT_FOUND, $this->grund(fn () => $this->service()->open(42, 'ben', 7)));
		$this->assertSame(RecordingException::NOT_FOUND, $this->grund(fn () => $this->service()->delete(42, 'ben', 7)));
	}

	public function testZeileOhneDateiIstNichtDa(): void {
		$this->mapper->method('findOwn')->willReturn(new Recording());
		$this->storage->method('open')->willThrowException(new NotFoundException());

		$this->assertSame(RecordingException::NOT_FOUND, $this->grund(fn () => $this->service()->open(42, 'anna', 7)));
	}

	public function testLiestNurDieEigenenGrenzenDerApp(): void {
		// Absicherung gegen einen Tippfehler im Schluessel: gelesen wird
		// unter der App-ID, sonst griffe die Vorgabe still.
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects($this->atLeastOnce())->method('getValueInt')
			->with(Application::APP_ID, $this->anything(), $this->anything())
			->willReturnArgument(2);
		$this->vorhanden(0);
		$service = new RecordingService($this->mapper, $this->storage, new FeatureConfig($appConfig), $this->createMock(ITimeFactory::class));
		$this->mapper->method('sumSizeByUser')->willReturn(0);

		$this->assertInstanceOf(Recording::class, $service->create(42, 'anna', self::strom(WavFormatTest::wav(10)), self::META, false));
	}

	public function testGleichzeitigerUploadMitErsetzenRaeumtDieAeltesteNach(): void {
		// Beide Uploads zaehlten fuenf und verdraengten dieselbe aelteste -
		// danach liegen sechs. Die naechstaeltere geht, nie die eigene.
		$vorher = array_map(fn (int $id) => $this->aufnahme($id), [1, 2, 3, 4, 5]);
		$nachher = array_map(fn (int $id) => $this->aufnahme($id), [2, 3, 4, 5, 100, 99]);
		$this->mapper->method('findByFileAndUser')->willReturnOnConsecutiveCalls($vorher, $nachher);
		$geloescht = [];
		$this->storage->method('delete')->willReturnCallback(function (Recording $r) use (&$geloescht) {
			$geloescht[] = $r->getId();
		});

		$this->assertSame(99, $this->erzeugen(WavFormatTest::wav(100), true)->getId());
		$this->assertSame([1, 2], $geloescht);
	}

	public function testGleichzeitigerUploadOhneErsetzenNimmtDieEigeneZurueck(): void {
		$vorher = array_map(fn (int $id) => $this->aufnahme($id), [1, 2, 3, 4]);
		$nachher = array_map(fn (int $id) => $this->aufnahme($id), [1, 2, 3, 4, 100, 99]);
		$this->mapper->method('findByFileAndUser')->willReturnOnConsecutiveCalls($vorher, $nachher);
		$geloescht = [];
		$this->storage->method('delete')->willReturnCallback(function (Recording $r) use (&$geloescht) {
			$geloescht[] = $r->getId();
		});

		$this->assertSame(RecordingException::LIMIT_REACHED, $this->grund(fn () => $this->erzeugen(WavFormatTest::wav(100))));
		$this->assertSame([99], $geloescht, 'keine fremde Aufnahme ungefragt geopfert');
	}

	public function testGleichzeitigerUploadOhneErsetzenBehaeltDieFruehere(): void {
		// Die eigene kam zuerst an: Den Ueberhang hat der andere Upload zu
		// verantworten, und der nimmt seine zurueck.
		$vorher = array_map(fn (int $id) => $this->aufnahme($id), [1, 2, 3, 4]);
		$nachher = array_map(fn (int $id) => $this->aufnahme($id), [1, 2, 3, 4, 99, 100]);
		$this->mapper->method('findByFileAndUser')->willReturnOnConsecutiveCalls($vorher, $nachher);
		$this->storage->expects($this->never())->method('delete');

		$this->assertSame(99, $this->erzeugen(WavFormatTest::wav(100))->getId());
	}

	public function testDieGroesseKommtAusDemStrom(): void {
		$this->vorhanden(0);
		$wav = WavFormatTest::wav(16000);

		$this->assertSame(strlen($wav), $this->erzeugen($wav)->getSizeBytes());
	}
}
