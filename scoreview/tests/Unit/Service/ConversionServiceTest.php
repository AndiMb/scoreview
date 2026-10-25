<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreConversionMapper;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\VariantService;
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
		return new ConversionService($this->mapper, $this->appData, $this->time, $this->createMock(VariantService::class));
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

	// --- Search fields (E17) ------------------------------------------------

	public function testSearchFieldsJoinTitleSubtitleComposerAndPoetInLowerCase(): void {
		$fields = ConversionService::searchFields(json_encode([
			'title' => 'Aequale  No. 1',
			'subtitle' => '',
			'composer' => 'Anton Bruckner',
			'poet' => 'Ödön',
			'pages' => 4,
		]));

		$this->assertSame('Aequale No. 1', $fields['title'], 'runs of white space become one');
		$this->assertSame('Anton Bruckner', $fields['composer']);
		$this->assertSame('aequale no. 1 anton bruckner ödön', $fields['searchText']);
	}

	public function testEmptyValuesAreNull(): void {
		$fields = ConversionService::searchFields(json_encode(['title' => ' ', 'composer' => '', 'pages' => 1]));
		$this->assertSame(['title' => null, 'composer' => null, 'searchText' => null], $fields);
	}

	public function testUnreadableMetaGivesNull(): void {
		$this->assertSame(['title' => null, 'composer' => null, 'searchText' => null], ConversionService::searchFields('{broken'));
		$this->assertNull(ConversionService::searchFields(json_encode(['title' => ['not', 'text']]))['title']);
	}

	public function testLongValuesAreCutByBytesWithoutBreakingACharacter(): void {
		$fields = ConversionService::searchFields(json_encode(['title' => str_repeat('ü', 300), 'composer' => str_repeat('x', 2000)]));

		$this->assertSame(254, strlen($fields['title']), '127 two-byte characters fit into 255 bytes');
		$this->assertTrue(mb_check_encoding($fields['title'], 'UTF-8'));
		$this->assertSame(255, strlen($fields['composer']));
		$this->assertLessThanOrEqual(1024, strlen($fields['searchText']));
	}

	public function testMarkReadyFillsTheSearchColumns(): void {
		$folder = $this->createMock(ISimpleFolder::class);
		$folder->method('fileExists')->willReturn(false);
		$folder->method('newFile')->willReturn($this->createMock(ISimpleFile::class));
		$root = $this->createMock(ISimpleFolder::class);
		$root->method('getFolder')->willReturn($folder);
		$this->appData->method('getFolder')->willReturn($root);
		$this->mapper->method('findAllByFileId')->willReturn([]);
		$this->mapper->expects($this->once())->method('update')->with($this->callback(
			fn (ScoreConversion $c) => $c->getTitle() === 'Ave' && $c->getComposer() === 'Bruckner' && $c->getSearchText() === 'ave bruckner',
		));
		$conversion = new ScoreConversion();
		$conversion->setFileId(7);
		$conversion->setEtag('e');

		$this->service()->markReady($conversion, ['<svg/>'], 'MThd', '{}', '{}', json_encode(['title' => 'Ave', 'composer' => 'Bruckner']), 'local');
	}
}
