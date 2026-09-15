<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreConversionMapper;
use OCA\ScoreView\Service\ConversionService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Zwei Zusagen dieser Klasse, die von aussen nicht zu sehen sind.
 *
 * **Die Artefaktnamen sind eine Allowlist, kein Dateipfad.** Der Name kommt
 * aus der URL (Route `conversion#artifact`); die Zeichenklasse dort laesst
 * `page-...` in jeder Schreibweise durch, und erst getArtifact() entscheidet.
 * Die Faelle unten stehen genau so im Kommentar an der Pruefung - bis jetzt
 * aber nur dort.
 *
 * **Ein Datensatz kann ueberaltern.** `pending`/`processing` sagen "ein Lauf
 * arbeitet daran"; stirbt der Prozess, bleibt die Zusage ohne jemanden, der
 * sie einloest. isStale() ist die einzige Stelle, die das beantwortet -
 * Controller\ConversionController fragt sie an zwei Stellen.
 */
class ConversionServiceTest extends TestCase {
	private ScoreConversionMapper&MockObject $mapper;
	private IAppData&MockObject $appData;
	private ITimeFactory&MockObject $time;

	protected function setUp(): void {
		$this->mapper = $this->createMock(ScoreConversionMapper::class);
		$this->appData = $this->createMock(IAppData::class);
		$this->time = $this->createMock(ITimeFactory::class);
	}

	private function service(): ConversionService {
		return new ConversionService($this->mapper, $this->appData, $this->time);
	}

	// --- Allowlist der Artefakte ------------------------------------------

	/**
	 * @return array<string, array{string}>
	 */
	public static function unguelteArtefaktnamen(): array {
		return [
			// Die drei aus dem Kommentar an der Pruefung: sie duerfen nicht
			// ueber eine (int)-Kastung durchrutschen.
			'fuehrende Null' => ['page-01'],
			'Kommazahl' => ['page-1.5'],
			'Pfadwechsel' => ['page-../x'],
			// Was (int) sonst noch stillschweigend annimmt.
			'Vorzeichen' => ['page-+1'],
			'fuehrendes Leerzeichen' => ['page- 1'],
			'Nachsatz' => ['page-1x'],
			// Die Raender.
			'ohne Nummer' => ['page-'],
			'Seite null' => ['page-0'],
			'negativ' => ['page--1'],
			// Kein Seitenname und kein Schluessel aus ARTIFACTS.
			'unbekanntes Artefakt' => ['pdf'],
			'leer' => [''],
		];
	}

	#[DataProvider('unguelteArtefaktnamen')]
	public function testEinUnbekannterArtefaktnameWirdNichtAufgeloest(string $name): void {
		// Der Ordner darf gar nicht erst angefasst werden - die Pruefung
		// sitzt vor dem Dateizugriff, nicht dahinter.
		$this->appData->expects($this->never())->method('getFolder');

		$this->expectException(NotFoundException::class);
		$this->service()->getArtifact(42, 'etag1', $name);
	}

	public function testEineSeitenzahlWirdZumPassendenDateinamen(): void {
		$file = $this->createMock(ISimpleFile::class);
		$this->ordnerMitDatei('page-7.svg', $file);

		[$gefunden, $mimeType] = $this->service()->getArtifact(42, 'etag1', 'page-7');

		$this->assertSame($file, $gefunden);
		$this->assertSame('image/svg+xml', $mimeType);
	}

	public function testEinBekanntesArtefaktTraegtSeinenMimeTyp(): void {
		$file = $this->createMock(ISimpleFile::class);
		$this->ordnerMitDatei('score.mid', $file);

		[$gefunden, $mimeType] = $this->service()->getArtifact(42, 'etag1', 'midi');

		$this->assertSame($file, $gefunden);
		$this->assertSame('audio/midi', $mimeType);
	}

	private function ordnerMitDatei(string $dateiname, ISimpleFile $file): void {
		$etagOrdner = $this->createMock(ISimpleFolder::class);
		$etagOrdner->method('getFile')->with($dateiname)->willReturn($file);
		$fileIdOrdner = $this->createMock(ISimpleFolder::class);
		$fileIdOrdner->method('getFolder')->willReturn($etagOrdner);
		$wurzel = $this->createMock(ISimpleFolder::class);
		$wurzel->method('getFolder')->willReturn($fileIdOrdner);
		$this->appData->method('getFolder')->with('scoreview')->willReturn($wurzel);
	}

	// --- Ueberalterung ----------------------------------------------------

	/**
	 * @return array<string, array{string}>
	 */
	public static function abgeschlosseneZustaende(): array {
		return [
			'fertig' => [ScoreConversion::STATUS_READY],
			'fehlgeschlagen' => [ScoreConversion::STATUS_ERROR],
		];
	}

	/**
	 * Ein abgeschlossener Datensatz kann nicht ueberaltern - niemand haelt
	 * ihn mehr. Ohne diese Einschraenkung wuerde jede laenger nicht geoeffnete
	 * Partitur beim naechsten Aufruf als Fehler gemeldet.
	 */
	#[DataProvider('abgeschlosseneZustaende')]
	public function testEinAbgeschlossenerDatensatzUeberaltertNie(string $status): void {
		$this->time->method('getTime')->willReturn(1_000_000);

		$this->assertFalse($this->service()->isStale($this->datensatz($status, 1)));
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

	#[DataProvider('laufendeZustaende')]
	public function testEinLaufenderDatensatzGiltNachDerFristAlsTot(string $status): void {
		$begonnen = 1_000_000;
		$this->time->method('getTime')->willReturn($begonnen + ConversionService::STALE_AFTER_SECONDS + 1);

		$this->assertTrue($this->service()->isStale($this->datensatz($status, $begonnen)));
	}

	/**
	 * Der Rand gehoert dem laufenden Prozess: Genau auf der Frist laeuft er
	 * noch. Sonst risse ein Lauf, der die Grenze exakt trifft, sich selbst
	 * den Datensatz weg.
	 */
	#[DataProvider('laufendeZustaende')]
	public function testAufDerFristLaeuftErNoch(string $status): void {
		$begonnen = 1_000_000;
		$this->time->method('getTime')->willReturn($begonnen + ConversionService::STALE_AFTER_SECONDS);

		$this->assertFalse($this->service()->isStale($this->datensatz($status, $begonnen)));
	}

	#[DataProvider('laufendeZustaende')]
	public function testEinFrischerLaufBleibtUnberuehrt(string $status): void {
		$begonnen = 1_000_000;
		$this->time->method('getTime')->willReturn($begonnen + 5);

		$this->assertFalse($this->service()->isStale($this->datensatz($status, $begonnen)));
	}

	private function datensatz(string $status, int $aktualisiertAm): ScoreConversion {
		$conversion = new ScoreConversion();
		$conversion->setStatus($status);
		$conversion->setUpdatedAt((new \DateTime())->setTimestamp($aktualisiertAm));
		return $conversion;
	}
}
