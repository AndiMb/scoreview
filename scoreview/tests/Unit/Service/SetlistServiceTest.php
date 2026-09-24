<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ClientFallback;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\SetlistException;
use OCA\ScoreView\Service\SetlistService;
use OCP\BackgroundJob\IJobList;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\Files\NotFoundException;
use OCP\IAppConfig;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Setlisten auf dem Server (E11, S2, S4, S6).
 *
 * Der Dateibaum ist ein Array von Pfaden (relativ zum Nutzerordner) auf
 * Inhalte; daraus baut der Test Datei- und Ordner-Attrappen, die sich wie
 * Nextclouds Knoten verhalten - `get()` mit Pfad, `getById()`,
 * `getRelativePath()`. So laesst sich dieselbe Liste aus der Sicht zweier
 * Konten mit verschiedenen Freigaben lesen.
 */
class SetlistServiceTest extends TestCase {
	private const LISTE = "# Konzert Herbst\n\nFreier Text.\n\n1. [Kyrie](../Messe/Kyrie.mscz)\n2. [Ave verum](Ave%20verum.mscz)\n3. Zugabe/Abendlied.mscz\n";

	/** @var array<string, string> Pfad => Inhalt, fuer die gerade gebaute Sicht */
	private array $baum = [];
	/** @var array<string, int> fileIds je Pfad - gleich fuer alle Sichten, wie in Nextcloud */
	private static array $ids = [];
	/** @var array<string, File|Folder> */
	private array $knoten = [];
	private array $etags = [];
	private bool $schreibbar = true;
	private bool $anlegbar = true;
	/** @var list<array> */
	private array $auftraege = [];
	private ?ScoreConversion $konvertierung = null;
	private bool $aktuellesFormat = true;
	private bool $rueckfall = false;
	private int $maxBytes = 0;
	private int $listings = 0;
	/** @var ?callable Laeuft bei jedem getById() - fuer eine Aenderung mitten im Speichern. */
	private $beiGetById = null;

	private IJobList&MockObject $jobList;
	private ConversionService&MockObject $conversions;

	protected function setUp(): void {
		$this->jobList = $this->createMock(IJobList::class);
		$this->jobList->method('add')->willReturnCallback(function (string $klasse, array $argument) {
			$this->auftraege[] = [$klasse, $argument];
		});
		$this->conversions = $this->createMock(ConversionService::class);
		$this->conversions->method('find')->willReturnCallback(fn () => $this->konvertierung);
		$this->conversions->method('isCurrentFormat')->willReturnCallback(fn () => $this->aktuellesFormat);
	}

	private function service(string $uid = 'anna'): SetlistService {
		$root = $this->createMock(IRootFolder::class);
		$root->method('getUserFolder')->with($uid)->willReturn($this->ordner(''));
		$config = $this->createMock(IAppConfig::class);
		$config->method('getValueInt')->willReturnCallback(fn (string $app, string $key, int $default) => $this->maxBytes ?: $default);
		$fallback = $this->createMock(ClientFallback::class);
		$fallback->method('applies')->willReturnCallback(fn () => $this->rueckfall);
		return new SetlistService($root, $this->jobList, $config, $this->conversions, $fallback, $this->createMock(LoggerInterface::class));
	}

	/** @param array<string, string> $dateien */
	private function baum(array $dateien): void {
		$this->baum = $dateien;
		$this->knoten = [];
	}

	private static function id(string $pfad): int {
		return self::$ids[$pfad] ??= 1000 + count(self::$ids);
	}

	private function datei(string $pfad): File {
		if (isset($this->knoten[$pfad])) {
			return $this->knoten[$pfad];
		}
		$datei = $this->createMock(File::class);
		$this->knoten[$pfad] = $datei;
		$datei->method('getId')->willReturn(self::id($pfad));
		$datei->method('getName')->willReturn(basename($pfad));
		$datei->method('getPath')->willReturn('/anna/files' . $pfad);
		$datei->method('getParent')->willReturnCallback(fn () => $this->ordner(dirname($pfad) === '/' ? '' : dirname($pfad)));
		$datei->method('getSize')->willReturnCallback(fn () => strlen($this->baum[$pfad] ?? ''));
		$datei->method('getContent')->willReturnCallback(fn () => $this->baum[$pfad]);
		$datei->method('getEtag')->willReturnCallback(fn () => $this->etags[$pfad] ?? 'e0');
		$datei->method('isUpdateable')->willReturnCallback(fn () => $this->schreibbar);
		$datei->method('putContent')->willReturnCallback(function (string $inhalt) use ($pfad) {
			$this->baum[$pfad] = $inhalt;
			$this->etags[$pfad] = 'e' . (count($this->etags) + 1);
		});
		return $datei;
	}

	private function ordner(string $pfad): Folder {
		$schluessel = 'D:' . $pfad;
		if (isset($this->knoten[$schluessel])) {
			return $this->knoten[$schluessel];
		}
		$ordner = $this->createMock(Folder::class);
		$this->knoten[$schluessel] = $ordner;
		$ordner->method('getId')->willReturn(self::id($schluessel));
		$ordner->method('getName')->willReturn(basename($pfad));
		$ordner->method('getPath')->willReturn('/anna/files' . $pfad);
		$ordner->method('getParent')->willReturnCallback(fn () => $this->ordner(dirname($pfad) === '/' ? '' : dirname($pfad)));
		$ordner->method('isCreatable')->willReturnCallback(fn () => $this->anlegbar);
		$ordner->method('getRelativePath')->willReturnCallback(function (string $absolut) use ($pfad) {
			$basis = '/anna/files' . $pfad;
			if ($absolut === $basis) {
				return '/';
			}
			return str_starts_with($absolut, $basis . '/') ? substr($absolut, strlen($basis)) : null;
		});
		$ordner->method('get')->willReturnCallback(fn (string $relativ) => $this->finde($pfad . '/' . ltrim($relativ, '/')));
		$ordner->method('nodeExists')->willReturnCallback(fn (string $name) => isset($this->baum[$pfad . '/' . $name]));
		$ordner->method('getById')->willReturnCallback(function (int $id) {
			if ($this->beiGetById !== null) {
				($this->beiGetById)();
			}
			foreach (array_keys($this->baum) as $p) {
				if (self::id($p) === $id) {
					return [$this->datei($p)];
				}
			}
			return [];
		});
		$ordner->method('getDirectoryListing')->willReturnCallback(function () use ($pfad) {
			$this->listings++;
			$kinder = [];
			foreach (array_keys($this->baum) as $p) {
				if (!str_starts_with($p, $pfad . '/')) {
					continue;
				}
				$rest = explode('/', substr($p, strlen($pfad) + 1));
				$kinder[$rest[0]] = count($rest) === 1 ? $this->datei($p) : $this->ordner($pfad . '/' . $rest[0]);
			}
			return array_values($kinder);
		});
		$ordner->method('newFile')->willReturnCallback(function (string $name, string $inhalt) use ($pfad) {
			$this->baum[$pfad . '/' . $name] = $inhalt;
			return $this->datei($pfad . '/' . $name);
		});
		return $ordner;
	}

	private function finde(string $pfad): Node {
		if (isset($this->baum[$pfad])) {
			return $this->datei($pfad);
		}
		foreach (array_keys($this->baum) as $p) {
			if (str_starts_with($p, $pfad . '/')) {
				return $this->ordner($pfad);
			}
		}
		throw new NotFoundException($pfad);
	}

	private function chorBaum(): void {
		$this->baum([
			'/Chor/Konzert/Konzert.setlist.md' => self::LISTE,
			'/Chor/Konzert/Ave verum.mscz' => 'x',
			'/Chor/Konzert/Zugabe/Abendlied.mscz' => 'x',
			'/Chor/Messe/Kyrie.mscz' => 'x',
		]);
	}

	private function liste(): File {
		return $this->datei('/Chor/Konzert/Konzert.setlist.md');
	}

	public function testLoestRelativZurListeAufAuchImNachbarordner(): void {
		$this->chorBaum();

		$liste = $this->service()->load($this->liste(), 'anna', false);

		$this->assertSame('Konzert Herbst', $liste['title']);
		$this->assertTrue($liste['canEdit']);
		$this->assertSame(self::id('D:/Chor/Konzert'), $liste['folderFileId']);
		$this->assertSame([
			['label' => 'Kyrie', 'path' => '../Messe/Kyrie.mscz', 'fileId' => self::id('/Chor/Messe/Kyrie.mscz'), 'status' => 'ok'],
			['label' => 'Ave verum', 'path' => 'Ave verum.mscz', 'fileId' => self::id('/Chor/Konzert/Ave verum.mscz'), 'status' => 'ok'],
			['label' => 'Abendlied', 'path' => 'Zugabe/Abendlied.mscz', 'fileId' => self::id('/Chor/Konzert/Zugabe/Abendlied.mscz'), 'status' => 'ok'],
		], $liste['entries']);
	}

	/**
	 * S6: Dieselbe Liste aus Sicht einer Saengerin, der die Freigabe fuer
	 * das mittlere Stueck fehlt - fuer sie fehlt es, die anderen bleiben.
	 */
	public function testOhneFreigabeFehltNurDasEineStueck(): void {
		$this->chorBaum();
		unset($this->baum['/Chor/Konzert/Ave verum.mscz']);

		$liste = $this->service('berta')->load($this->liste(), 'berta', false);

		$this->assertSame(['ok', 'missing', 'ok'], array_column($liste['entries'], 'status'));
		$this->assertNull($liste['entries'][1]['fileId']);
	}

	public function testFremdeFehlendeUndUnpassendeEintraege(): void {
		$this->baum([
			'/Liste.setlist.md' => "- ../../etc/passwd.mscz\n- /Noten/Kyrie.mscz\n- Noten\n- Noten/Plan.pdf\n- https://example.org/a.mscz\n- Weg.mscz\n- Noten/../Noten/Kyrie.mscz\n",
			'/Noten/Kyrie.mscz' => 'x',
			'/Noten/Plan.pdf' => 'x',
		]);

		$liste = $this->service()->load($this->datei('/Liste.setlist.md'), 'anna', false);

		$this->assertSame(['missing', 'ok', 'unsupported', 'unsupported', 'missing', 'missing', 'ok'], array_column($liste['entries'], 'status'));
		$this->assertSame('Liste', $liste['title'], 'ohne Ueberschrift der Dateiname');
	}

	public function testDuplikateZeigenAufDieselbeDatei(): void {
		$this->baum(['/A/L.setlist.md' => "- x.mscz\n- y.mscz\n- x.mscz\n", '/A/x.mscz' => '1', '/A/y.mscz' => '2']);

		$ids = array_column($this->service()->load($this->datei('/A/L.setlist.md'), 'anna', false)['entries'], 'fileId');

		$this->assertSame($ids[0], $ids[2]);
		$this->assertNotSame($ids[0], $ids[1]);
	}

	/** Beim Oeffnen einer Liste wird jedes Stueck einmal angestossen. */
	public function testOeffnenStoesstNochNichtKonvertierteAn(): void {
		$this->chorBaum();

		$this->service()->load($this->liste(), 'anna');

		$this->assertCount(3, $this->auftraege);
		$this->assertSame([ConvertScoreJob::class, ['userId' => 'anna', 'fileId' => self::id('/Chor/Messe/Kyrie.mscz')]], $this->auftraege[0]);
	}

	public function testFertigeWerdenNichtErneutAngestossenVeraltetesFormatSchon(): void {
		$this->chorBaum();
		$this->konvertierung = new ScoreConversion();
		$this->konvertierung->setStatus(ScoreConversion::STATUS_READY);

		$this->service()->load($this->liste(), 'anna');
		$this->assertSame([], $this->auftraege);

		$this->aktuellesFormat = false;
		$this->service()->load($this->liste(), 'anna');
		$this->assertCount(3, $this->auftraege);
	}

	public function testLaufendeUndFehlgeschlageneBleibenDemOeffnenUeberlassen(): void {
		$this->chorBaum();
		$this->konvertierung = new ScoreConversion();
		$this->konvertierung->setStatus(ScoreConversion::STATUS_PROCESSING);

		$this->service()->load($this->liste(), 'anna');

		$this->assertSame([], $this->auftraege);
	}

	public function testGroessengrenzeUndBrowserRueckfallDeckeln(): void {
		$this->chorBaum();
		$this->baum['/Chor/Messe/Kyrie.mscz'] = str_repeat('x', 50);
		$this->maxBytes = 10;

		$this->service()->load($this->liste(), 'anna');
		$this->assertCount(2, $this->auftraege, 'die zu grosse bleibt aussen vor');

		$this->auftraege = [];
		$this->rueckfall = true;
		$this->service()->load($this->liste(), 'anna');
		$this->assertSame([], $this->auftraege, 'ohne Serverkonvertierung nichts vorab');
	}

	public function testFehlerBeimAnstossenVerhindertDasOeffnenNicht(): void {
		$this->chorBaum();
		$this->conversions = $this->createMock(ConversionService::class);
		$this->conversions->method('find')->willThrowException(new \RuntimeException('DB weg'));

		$liste = $this->service()->load($this->liste(), 'anna');

		$this->assertCount(3, $liste['entries']);
	}

	public function testZuGrosseListeWirdNichtGelesen(): void {
		$this->baum(['/L.setlist.md' => str_repeat('x', SetlistService::MAX_BYTES + 1)]);

		$this->expectExceptionObject(new SetlistException(SetlistException::TOO_LARGE));
		$this->service()->load($this->datei('/L.setlist.md'), 'anna');
	}

	/**
	 * Umordnen und ein neues Stueck aus einem anderen Ordner. Der Rest
	 * der Datei bleibt, der alte Eintrag bleibt roh, der neue wird ein Link
	 * mit relativem Pfad.
	 */
	public function testSpeichernOrdnetUmUndRechnetDenPfadSelbst(): void {
		$this->chorBaum();
		$this->baum['/Gottesdienst/Psalm 23.mscz'] = 'x';

		$liste = $this->service()->save($this->liste(), 'anna', [
			['origin' => 2],
			['origin' => 0],
			['fileId' => self::id('/Gottesdienst/Psalm 23.mscz')],
			['origin' => 0],
		], 'e0');

		$this->assertSame(
			"# Konzert Herbst\n\nFreier Text.\n\n1. Zugabe/Abendlied.mscz\n2. [Kyrie](../Messe/Kyrie.mscz)\n3. [Psalm 23](../../Gottesdienst/Psalm%2023.mscz)\n4. [Kyrie](../Messe/Kyrie.mscz)\n",
			$this->baum['/Chor/Konzert/Konzert.setlist.md'],
		);
		$this->assertSame(['ok', 'ok', 'ok', 'ok'], array_column($liste['entries'], 'status'));
		$this->assertNotSame('e0', $liste['etag']);
	}

	public function testSpeichernMitVeraltetemStandWirdAbgelehnt(): void {
		$this->chorBaum();
		$this->etags['/Chor/Konzert/Konzert.setlist.md'] = 'e7';

		try {
			$this->service()->save($this->liste(), 'anna', [['origin' => 0]], 'e0');
			$this->fail('Konflikt erwartet');
		} catch (SetlistException $e) {
			$this->assertSame(SetlistException::CONFLICT, $e->getReason());
		}
		$this->assertSame(self::LISTE, $this->baum['/Chor/Konzert/Konzert.setlist.md']);
	}

	public function testSpeichernOhneSchreibrechtWirdAbgelehnt(): void {
		$this->chorBaum();
		$this->schreibbar = false;

		$this->expectExceptionObject(new SetlistException(SetlistException::FORBIDDEN));
		$this->service()->save($this->liste(), 'anna', [], null);
	}

	public function testUnbrauchbareEintraegeWerdenAbgelehnt(): void {
		$this->chorBaum();
		$faelle = [
			'kein Array' => 'x',
			'Herkunft ausserhalb' => [['origin' => 9]],
			'Herkunft als Text' => [['origin' => '0']],
			'unbekannte Datei' => [['fileId' => 1]],
			'leer' => [[]],
			'zu viele' => array_fill(0, SetlistService::MAX_ENTRIES + 1, ['origin' => 0]),
		];
		foreach ($faelle as $name => $eintraege) {
			try {
				$this->service()->save($this->liste(), 'anna', $eintraege, null);
				$this->fail($name);
			} catch (SetlistException $e) {
				$this->assertSame(SetlistException::INVALID, $e->getReason(), $name);
			}
		}
		$this->assertSame(self::LISTE, $this->baum['/Chor/Konzert/Konzert.setlist.md']);
	}

	public function testNeueListeImOrdnerDerPartitur(): void {
		$this->chorBaum();

		$datei = $this->service()->create($this->ordner('/Chor/Konzert'), 'anna', ' Probe/Mai.setlist.md ', [
			['fileId' => self::id('/Chor/Konzert/Ave verum.mscz')],
			['fileId' => self::id('/Chor/Messe/Kyrie.mscz'), 'label' => 'Kyrie eleison'],
		]);

		$this->assertSame('Probe Mai.setlist.md', $datei->getName());
		$this->assertSame(
			"# Probe Mai\n\n1. [Ave verum](Ave%20verum.mscz)\n2. [Kyrie eleison](../Messe/Kyrie.mscz)\n",
			$this->baum['/Chor/Konzert/Probe Mai.setlist.md'],
		);
	}

	public function testNeueListeUeberschreibtNichts(): void {
		$this->chorBaum();

		$this->expectExceptionObject(new SetlistException(SetlistException::EXISTS));
		$this->service()->create($this->ordner('/Chor/Konzert'), 'anna', 'Konzert', []);
	}

	public function testNeueListeBrauchtSchreibrechtImOrdner(): void {
		$this->chorBaum();
		$this->anlegbar = false;

		$this->expectExceptionObject(new SetlistException(SetlistException::FORBIDDEN));
		$this->service()->create($this->ordner('/Chor/Konzert'), 'anna', 'Neu', []);
	}

	public function testNamenWerdenBereinigt(): void {
		$this->assertSame('Konzert', SetlistService::sanitizeName('Konzert.setlist.md'));
		$this->assertSame('Kon zert', SetlistService::sanitizeName("Kon\x00zert.md"), 'Steuerzeichen werden zu Leerzeichen');
		$this->assertSame('a b', SetlistService::sanitizeName('a/b'));
		$this->assertSame(SetlistService::MAX_NAME_LENGTH, mb_strlen(SetlistService::sanitizeName(str_repeat('ä', 500))));
		foreach (['', '   ', '..', '.setlist.md', '/'] as $schlecht) {
			try {
				SetlistService::sanitizeName($schlecht);
				$this->fail($schlecht);
			} catch (SetlistException $e) {
				$this->assertSame(SetlistException::INVALID, $e->getReason());
			}
		}
	}

	/** Weg 2 (E11): nur Listen im selben Ordner, die die Partitur enthalten. */
	public function testListenImSelbenOrdnerDieDiePartiturEnthalten(): void {
		$this->chorBaum();
		$this->baum['/Chor/Konzert/Andere.setlist.md'] = "- Zugabe/Abendlied.mscz\n";
		$this->baum['/Chor/Konzert/Zweimal.setlist.md'] = "- [A](./Ave%20verum.mscz)\n- Ave verum.mscz\n- Ave%20verum.mscz\n";
		$this->baum['/Chor/Konzert/Notiz.md'] = "- Ave verum.mscz\n";
		$this->baum['/Chor/Konzert/Zugabe/Tief.setlist.md'] = "- ../Ave verum.mscz\n";

		$treffer = $this->service()->containing($this->datei('/Chor/Konzert/Ave verum.mscz'), 'anna');

		$this->assertSame([
			['id' => self::id('/Chor/Konzert/Konzert.setlist.md'), 'name' => 'Konzert.setlist.md', 'title' => 'Konzert Herbst', 'positions' => [1]],
			['id' => self::id('/Chor/Konzert/Zweimal.setlist.md'), 'name' => 'Zweimal.setlist.md', 'title' => 'Zweimal', 'positions' => [0, 1]],
		], $treffer);
	}

	public function testHoechstensZwanzigListenJeOrdner(): void {
		$dateien = ['/A/x.mscz' => 'x'];
		for ($i = 1; $i <= 25; $i++) {
			$dateien['/A/L' . $i . '.setlist.md'] = "- x.mscz\n";
		}
		$this->baum($dateien);

		$treffer = $this->service()->containing($this->datei('/A/x.mscz'), 'anna');

		$this->assertCount(SetlistService::MAX_SETLISTS_PER_FOLDER, $treffer);
		$this->assertSame('L1.setlist.md', $treffer[0]['name']);
		$this->assertSame('L20.setlist.md', $treffer[19]['name'], 'natuerlich sortiert');
	}

	public function testKandidatenBisTiefeZwei(): void {
		$this->baum([
			'/Chor/Konzert/Ave verum.mscz' => 'x',
			'/Chor/Konzert/Plan.pdf' => 'x',
			'/Chor/Konzert/A/a.mscz' => 'x',
			'/Chor/Konzert/A/B/b.mscz' => 'x',
			'/Chor/Konzert/A/B/C/zu-tief.mscz' => 'x',
			'/Chor/Messe/Kyrie.mscz' => 'x',
		]);

		$kandidaten = $this->service()->candidates($this->datei('/Chor/Konzert/Ave verum.mscz'));

		$this->assertSame(['A/a.mscz', 'A/B/b.mscz', 'Ave verum.mscz'], array_column($kandidaten, 'path'));
		$this->assertSame(self::id('/Chor/Konzert/A/a.mscz'), $kandidaten[0]['fileId']);
	}

	public function testNormalisierenBleibtImNutzerordner(): void {
		$this->assertSame('/Chor/Messe/K.mscz', SetlistService::normalize('/Chor/Konzert', '../Messe/K.mscz'));
		$this->assertSame('/K.mscz', SetlistService::normalize('', 'K.mscz'));
		$this->assertSame('/Noten/K.mscz', SetlistService::normalize('/Chor', '/Noten/K.mscz'));
		$this->assertNull(SetlistService::normalize('/Chor', '../../K.mscz'));
		$this->assertNull(SetlistService::normalize('/Chor', '..'));
		$this->assertNull(SetlistService::normalize('/Chor', 'file:///etc/passwd'));
		$this->assertNull(SetlistService::normalize('/Chor', '  '));
	}

	public function testRelativerPfad(): void {
		$this->assertSame('K.mscz', SetlistService::relativePath('/Chor', '/Chor/K.mscz'));
		$this->assertSame('../Messe/K.mscz', SetlistService::relativePath('/Chor/Konzert', '/Chor/Messe/K.mscz'));
		$this->assertSame('Sub/K.mscz', SetlistService::relativePath('', '/Sub/K.mscz'));
		$this->assertSame('../../K.mscz', SetlistService::relativePath('/A/B', '/K.mscz'));
		$this->assertSame('../B2/K.mscz', SetlistService::relativePath('/A/B', '/A/B2/K.mscz'), 'Praefix ist kein gemeinsamer Ordner');
	}
	/**
	 * S4: Die Auswahl besucht hoechstens MAX_CANDIDATE_FOLDERS Ordner - auch
	 * wenn die Trefferzahl noch lange nicht erreicht ist. Ein Baum aus vielen
	 * Ordnern kostete sonst je Ordner eine Verzeichnisabfrage.
	 */
	public function testKandidatenBesuchenHoechstensHundertOrdner(): void {
		$dateien = ['/Chor/Start.mscz' => 'x'];
		for ($i = 1; $i <= 150; $i++) {
			$dateien[sprintf('/Chor/O%03d/a.mscz', $i)] = 'x';
		}
		$this->baum($dateien);
		$this->listings = 0;

		$kandidaten = $this->service()->candidates($this->datei('/Chor/Start.mscz'));

		$this->assertSame(SetlistService::MAX_CANDIDATE_FOLDERS, $this->listings);
		// Der Startordner und 99 Unterordner - je einer mit einer Partitur.
		$this->assertCount(1 + SetlistService::MAX_CANDIDATE_FOLDERS - 1, $kandidaten);
	}

	/** S6: Steuerzeichen in Titel oder Pfad werden abgelehnt, nicht still bereinigt. */
	public function testSteuerzeichenInEintraegenWerdenAbgelehnt(): void {
		$this->chorBaum();
		$faelle = [
			'Umbruch im Pfad' => [['path' => "a.mscz\n2. b.mscz"]],
			'Wagenruecklauf im Pfad' => [['path' => "a.mscz\rb"]],
			'NUL im Pfad' => [['path' => "a\x00.mscz"]],
			'Umbruch im Titel' => [['fileId' => self::id('/Chor/Konzert/Ave verum.mscz'), 'label' => "Ave\n- Kyrie.mscz"]],
			'Tab im Titel' => [['path' => 'a.mscz', 'label' => "A\tB"]],
		];
		foreach ($faelle as $name => $eintraege) {
			try {
				$this->service()->save($this->liste(), 'anna', $eintraege, null);
				$this->fail($name);
			} catch (SetlistException $e) {
				$this->assertSame(SetlistException::INVALID, $e->getReason(), $name);
			}
			try {
				$this->service()->create($this->ordner('/Chor/Konzert'), 'anna', 'Neu ' . $name, $eintraege);
				$this->fail('anlegen: ' . $name);
			} catch (SetlistException $e) {
				$this->assertSame(SetlistException::INVALID, $e->getReason(), 'anlegen: ' . $name);
			}
		}
		$this->assertSame(self::LISTE, $this->baum['/Chor/Konzert/Konzert.setlist.md']);
	}

	/** S6: `\` und NUL fuehren nirgendwohin - auch nicht als Umweg an der Segmentpruefung vorbei. */
	public function testNormalisierenLehntBackslashUndNulAb(): void {
		$this->assertNull(SetlistService::normalize('/Chor', '..\..\K.mscz'));
		$this->assertNull(SetlistService::normalize('/Chor', 'Messe\K.mscz'));
		$this->assertNull(SetlistService::normalize('/Chor', "K.mscz\x00.txt"));
		$this->assertNull(SetlistService::normalize('/Chor', "K\x01.mscz"));
		$this->assertSame('/Chor/K.mscz', SetlistService::normalize('/Chor', 'K.mscz'), 'Gegenprobe');
	}

	/**
	 * S2: Mit Token darf nur herein, was um die offene Partitur liegt - weder
	 * als fileId noch als Pfad eine Datei von anderswo. `origin` bleibt.
	 */
	public function testMitTokenNurErlaubteDateien(): void {
		$this->chorBaum();
		$this->baum['/Privat/Tagebuch.mscz'] = 'x';
		$erlaubt = [self::id('/Chor/Konzert/Ave verum.mscz'), self::id('/Chor/Konzert/Zugabe/Abendlied.mscz')];
		$faelle = [
			'fileId anderswo' => [['origin' => 0], ['fileId' => self::id('/Privat/Tagebuch.mscz')]],
			'absoluter Pfad anderswo' => [['path' => '/Privat/Tagebuch.mscz']],
			'relativer Pfad anderswo' => [['path' => '../../Privat/Tagebuch.mscz']],
			'Pfad ins Leere' => [['path' => 'gibt-es-nicht.mscz']],
		];
		foreach ($faelle as $name => $eintraege) {
			try {
				$this->service()->save($this->liste(), 'anna', $eintraege, 'e0', $erlaubt);
				$this->fail($name);
			} catch (SetlistException $e) {
				$this->assertSame(SetlistException::FORBIDDEN, $e->getReason(), $name);
			}
			try {
				$neu = array_values(array_filter($eintraege, static fn (array $e) => !isset($e['origin'])));
				$this->service()->create($this->ordner('/Chor/Konzert'), 'anna', 'Neu', $neu, $erlaubt);
				$this->fail('anlegen: ' . $name);
			} catch (SetlistException $e) {
				$this->assertSame(SetlistException::FORBIDDEN, $e->getReason(), 'anlegen: ' . $name);
			}
		}
		$this->assertSame(self::LISTE, $this->baum['/Chor/Konzert/Konzert.setlist.md']);
		$this->assertArrayNotHasKey('/Chor/Konzert/Neu.setlist.md', $this->baum);

		// Gegenprobe: Erlaubtes geht, als fileId wie als Pfad, dazu origin -
		// auch ein origin, der ausserhalb der Menge liegt (Kyrie im Nachbarordner).
		$liste = $this->service()->save($this->liste(), 'anna', [
			['origin' => 0],
			['fileId' => self::id('/Chor/Konzert/Ave verum.mscz')],
			['path' => 'Zugabe/Abendlied.mscz'],
		], 'e0', $erlaubt);
		$this->assertSame(['ok', 'ok', 'ok'], array_column($liste['entries'], 'status'));
	}

	/** Mit Begleit-Token (`[]`) bleiben nur Umordnen und Entfernen (S2). */
	public function testOhneErlaubteDateienNurUmordnen(): void {
		$this->chorBaum();

		$liste = $this->service()->save($this->liste(), 'anna', [['origin' => 2], ['origin' => 0]], 'e0', []);
		$this->assertSame(['Zugabe/Abendlied.mscz', '../Messe/Kyrie.mscz'], array_column($liste['entries'], 'path'));

		$this->expectExceptionObject(new SetlistException(SetlistException::FORBIDDEN));
		$this->service()->save($this->liste(), 'anna', [['fileId' => self::id('/Chor/Konzert/Ave verum.mscz')]], null, []);
	}

	/**
	 * Eine im Texteditor aufgeblaehte Liste wird weder aufgeloest noch
	 * durchsucht - jede Zeile kostete einen Zugriff auf den Dateibaum.
	 */
	public function testUebergrosseListeWirdBeimLesenAbgelehnt(): void {
		$zeilen = '';
		for ($i = 0; $i < 5000; $i++) {
			$zeilen .= "- x.mscz\n";
		}
		$this->assertLessThan(SetlistService::MAX_BYTES, strlen($zeilen), 'unter der Bytegrenze, nur zu viele Eintraege');
		$this->baum(['/A/Lang.setlist.md' => $zeilen, '/A/Kurz.setlist.md' => "- x.mscz\n", '/A/x.mscz' => 'x']);

		try {
			$this->service()->load($this->datei('/A/Lang.setlist.md'), 'anna');
			$this->fail('TOO_LARGE erwartet');
		} catch (SetlistException $e) {
			$this->assertSame(SetlistException::TOO_LARGE, $e->getReason());
		}
		$this->assertSame([], $this->auftraege, 'nichts angestossen');

		try {
			$this->service()->save($this->datei('/A/Lang.setlist.md'), 'anna', [['origin' => 0]], 'e0');
			$this->fail('TOO_LARGE erwartet');
		} catch (SetlistException $e) {
			$this->assertSame(SetlistException::TOO_LARGE, $e->getReason());
		}

		$treffer = $this->service()->containing($this->datei('/A/x.mscz'), 'anna');
		$this->assertSame(['Kurz.setlist.md'], array_column($treffer, 'name'), 'die lange wird uebergangen');

		// Gegenprobe an der Grenze: genau MAX_ENTRIES geht.
		$this->baum['/A/Lang.setlist.md'] = str_repeat("- x.mscz\n", SetlistService::MAX_ENTRIES);
		$this->assertCount(SetlistService::MAX_ENTRIES, $this->service()->load($this->datei('/A/Lang.setlist.md'), 'anna', false)['entries']);
	}

	/** `origin` zeigt in einen bestimmten Stand - ohne Etag laesst er sich nicht pruefen. */
	public function testHerkunftBrauchtDenGelesenenStand(): void {
		$this->chorBaum();

		foreach ([null, ''] as $etag) {
			try {
				$this->service()->save($this->liste(), 'anna', [['origin' => 1], ['origin' => 0]], $etag);
				$this->fail('INVALID erwartet');
			} catch (SetlistException $e) {
				$this->assertSame(SetlistException::INVALID, $e->getReason());
			}
		}
		$this->assertSame(self::LISTE, $this->baum['/Chor/Konzert/Konzert.setlist.md']);

		// Ohne origin bleibt der Etag freiwillig - eine Liste neu zu fuellen
		// bezieht sich auf keinen Stand.
		$liste = $this->service()->save($this->liste(), 'anna', [['path' => 'Ave verum.mscz']], null);
		$this->assertSame(['Ave verum.mscz'], array_column($liste['entries'], 'path'));
	}

	/**
	 * Speichert der Texteditor, waehrend die Eintraege aufgeloest werden,
	 * faellt das bei der zweiten Pruefung unmittelbar vor dem Schreiben auf -
	 * statt dass sein Stand still ueberschrieben wird.
	 */
	public function testAenderungWaehrendDesAufloesensWirdErkannt(): void {
		$this->chorBaum();
		$pfad = '/Chor/Konzert/Konzert.setlist.md';
		$dazwischen = "# Konzert Herbst\n\n1. Neu.mscz\n";
		$this->beiGetById = function () use ($pfad, $dazwischen) {
			$this->beiGetById = null;
			$this->baum[$pfad] = $dazwischen;
			$this->etags[$pfad] = 'e-editor';
		};

		try {
			$this->service()->save($this->liste(), 'anna', [['origin' => 0], ['fileId' => self::id('/Chor/Konzert/Ave verum.mscz')]], 'e0');
			$this->fail('CONFLICT erwartet');
		} catch (SetlistException $e) {
			$this->assertSame(SetlistException::CONFLICT, $e->getReason());
		}
		$this->assertSame($dazwischen, $this->baum[$pfad], 'der Stand des Editors bleibt');
	}

	/** Auch ein Inhalt, dessen Etag (noch) gleich ist, zaehlt als Aenderung. */
	public function testGeaenderterInhaltBeiGleichemEtagWirdErkannt(): void {
		$this->chorBaum();
		$pfad = '/Chor/Konzert/Konzert.setlist.md';
		$this->beiGetById = function () use ($pfad) {
			$this->beiGetById = null;
			$this->baum[$pfad] = self::LISTE . "4. Nachtrag.mscz\n";
		};

		$this->expectExceptionObject(new SetlistException(SetlistException::CONFLICT));
		$this->service()->save($this->liste(), 'anna', [['fileId' => self::id('/Chor/Konzert/Ave verum.mscz')]], 'e0');
	}
}
