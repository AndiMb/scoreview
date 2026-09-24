<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\SetlistFormat;
use PHPUnit\Framework\TestCase;

/**
 * Das Setlisten-Format (E11) an Dateien, wie sie
 * jemand im Texteditor schreibt - und die Zusage, dass die App beim
 * Schreiben nur die erste Liste anfasst.
 */
class SetlistFormatTest extends TestCase {
	private const BEISPIEL = <<<MD
		# Konzert Herbst 2026

		Freier Text bleibt erhalten.

		1. [Kyrie](../Messe/Kyrie.mscz)
		2. [Ave verum](Ave%20verum.mscz)
		3. Zugabe/Abendlied.mscz

		MD;

	/** @return list<string> */
	private static function ziele(string $text): array {
		return array_column(SetlistFormat::parse($text)['entries'], 'target');
	}

	/** @return list<string> */
	private static function titel(string $text): array {
		return array_column(SetlistFormat::parse($text)['entries'], 'label');
	}

	public function testBeispielMitTitelUndUnterpunkten(): void {
		$liste = SetlistFormat::parse(self::BEISPIEL);

		$this->assertSame('Konzert Herbst 2026', $liste['title']);
		$this->assertSame(['../Messe/Kyrie.mscz', 'Ave verum.mscz', 'Zugabe/Abendlied.mscz'], self::ziele(self::BEISPIEL));
		$this->assertSame(['Kyrie', 'Ave verum', 'Abendlied'], self::titel(self::BEISPIEL));
	}

	public function testUnnummerierteListeMitRohenPfadenUndLeerzeichen(): void {
		$text = "- Ave verum.mscz\n* nicht mehr dieselbe Liste.mscz\n";

		$this->assertSame(['Ave verum.mscz'], self::ziele($text), 'anderes Zeichen = neue Liste');
	}

	public function testPlusUndKlammerNummern(): void {
		$this->assertSame(['a.mscz', 'b.mscz'], self::ziele("+ a.mscz\n+ b.mscz"));
		$this->assertSame(['a.mscz', 'b.mscz'], self::ziele("1) a.mscz\n2) b.mscz"));
	}

	public function testNurDieErsteListeZaehlt(): void {
		$text = "# Probe\n\n- Kyrie.mscz\n- Gloria.mscz\n\nMitbringen:\n\n- Mappe\n- Bleistift\n";

		$this->assertSame(['Kyrie.mscz', 'Gloria.mscz'], self::ziele($text));
	}

	public function testListeWeiterUntenImText(): void {
		$text = "# Titel\n\nEin langer Absatz\nueber zwei Zeilen.\n\n## Programm\n\n1. Kyrie.mscz\n";

		$this->assertSame(['Kyrie.mscz'], self::ziele($text));
	}

	public function testOhneListeKeineEintraegeUndTitelAusDerUeberschrift(): void {
		$liste = SetlistFormat::parse("# Leer\n\nNoch nichts geplant.\n");

		$this->assertSame('Leer', $liste['title']);
		$this->assertSame([], $liste['entries']);
		$this->assertNull(SetlistFormat::parse("Nur Text\n")['title']);
		$this->assertSame([], SetlistFormat::parse('')['entries']);
	}

	public function testLeereElementeSindKeineEintraege(): void {
		$this->assertSame(['a.mscz'], self::ziele("-\n- a.mscz\n- \n"));
	}

	public function testDuplikateBleibenErhalten(): void {
		$text = "1. Halleluja.mscz\n2. Kyrie.mscz\n3. Halleluja.mscz\n";

		$this->assertSame(['Halleluja.mscz', 'Kyrie.mscz', 'Halleluja.mscz'], self::ziele($text));
	}

	public function testCrlfWirdGelesen(): void {
		$text = str_replace("\n", "\r\n", self::BEISPIEL);

		$this->assertSame(['../Messe/Kyrie.mscz', 'Ave verum.mscz', 'Zugabe/Abendlied.mscz'], self::ziele($text));
	}

	public function testUnterlistenUndAnmerkungenSindKeineEintraege(): void {
		$text = "1. Kyrie.mscz\n   - Solo: Anna\n   - Tempo ruhig\n2. Gloria.mscz\n  - zwei Leerzeichen reichen\n";

		$this->assertSame(['Kyrie.mscz', 'Gloria.mscz'], self::ziele($text));
	}

	public function testLockereListeMitLeerzeilen(): void {
		$this->assertSame(['a.mscz', 'b.mscz', 'c.mscz'], self::ziele("- a.mscz\n\n- b.mscz\n\n\n- c.mscz\n"));
	}

	public function testNichtEingerueckterSatzBeendetDieListe(): void {
		$text = "- a.mscz\nDanach Pause.\n- b.mscz\n";

		$this->assertSame(['a.mscz'], self::ziele($text));
	}

	public function testTrennlinieUndCodeblockSindKeineListe(): void {
		$text = "---\n```\n- im Code.mscz\n```\n* * *\n- echt.mscz\n";

		$this->assertSame(['echt.mscz'], self::ziele($text));
	}

	public function testLinkvarianten(): void {
		$text = implode("\n", [
			'- [Mit Titel](a.mscz "Tooltip")',
			'- [](Ohne%20Titel.mscz)',
			'- [Spitz](<Mit Leerzeichen.mscz>)',
			'- [Klammer \\] im Titel](b.mscz)',
			'- Vorwort [Link weiter hinten](c.mscz) und Rest',
			'- [x] Aufgabe.mscz',
			'- Kyrie.mscz (Solo: Anna)',
			'- [Umlaut](%C3%9Cbung.mscz)',
			'- [Prozent](100%25.mscz)',
		]);

		$this->assertSame(
			['a.mscz', 'Ohne Titel.mscz', 'Mit Leerzeichen.mscz', 'b.mscz', 'c.mscz', 'Aufgabe.mscz', 'Kyrie.mscz', 'Übung.mscz', '100%.mscz'],
			self::ziele($text),
		);
		$this->assertSame(
			['Mit Titel', 'Ohne Titel', 'Spitz', 'Klammer ] im Titel', 'Link weiter hinten', 'Aufgabe', 'Kyrie', 'Umlaut', 'Prozent'],
			self::titel($text),
		);
	}

	/**
	 * Der Kern des Formats: Umordnen fasst nur die Liste an. Ein unveraenderter
	 * Eintrag kommt so zurueck, wie er geschrieben war - roher Pfad bleibt
	 * roher Pfad -, nur die Nummer folgt der neuen Stelle.
	 */
	public function testUmordnenLaesstDenRestByteGleich(): void {
		$eintraege = SetlistFormat::parse(self::BEISPIEL)['entries'];

		$neu = SetlistFormat::write(self::BEISPIEL, [$eintraege[2], $eintraege[0], $eintraege[1]]);

		$this->assertSame(<<<MD
			# Konzert Herbst 2026

			Freier Text bleibt erhalten.

			1. Zugabe/Abendlied.mscz
			2. [Kyrie](../Messe/Kyrie.mscz)
			3. [Ave verum](Ave%20verum.mscz)

			MD, $neu);
	}

	public function testUnveraendertGeschriebenIstIdentisch(): void {
		$texte = [
			self::BEISPIEL,
			"- a.mscz\n- b.mscz",
			"Vorspann\n\n  - eingerueckt.mscz\n  - zwei.mscz\n\nNachspann\n",
			"3. drei.mscz\n4. vier.mscz\n",
			"- a.mscz\n\n- b.mscz\n\nText\n",
		];
		foreach ($texte as $text) {
			$this->assertSame($text, SetlistFormat::write($text, SetlistFormat::parse($text)['entries']), $text);
		}
	}

	public function testNeueEintraegeWerdenLinksMitDateinamenAlsTitel(): void {
		$text = "# Probe\n\n- Kyrie.mscz\n\nEnde\n";
		$neu = [
			...SetlistFormat::parse($text)['entries'],
			['content' => SetlistFormat::linkContent(SetlistFormat::labelFromPath('../Messe/Ave verum (neu).mscz'), '../Messe/Ave verum (neu).mscz')],
		];

		$geschrieben = SetlistFormat::write($text, $neu);

		$this->assertSame("# Probe\n\n- Kyrie.mscz\n- [Ave verum (neu)](../Messe/Ave%20verum%20%28neu%29.mscz)\n\nEnde\n", $geschrieben);
		$this->assertSame(['Kyrie.mscz', '../Messe/Ave verum (neu).mscz'], self::ziele($geschrieben), 'liest sich zurueck');
	}

	public function testLinkTitelMitKlammernUndProzentOverlebtDieRundreise(): void {
		$inhalt = SetlistFormat::linkContent('A [b] \\ c', 'x/100% <y>.mscz');
		$liste = SetlistFormat::parse('- ' . $inhalt);

		$this->assertSame('A [b] \\ c', $liste['entries'][0]['label']);
		$this->assertSame('x/100% <y>.mscz', $liste['entries'][0]['target']);
	}

	public function testCrlfBleibtBeimSchreiben(): void {
		$text = "# T\r\n\r\n1. a.mscz\r\n2. b.mscz\r\n\r\nEnde\r\n";
		$e = SetlistFormat::parse($text)['entries'];

		$this->assertSame("# T\r\n\r\n1. b.mscz\r\n2. a.mscz\r\n\r\nEnde\r\n", SetlistFormat::write($text, [$e[1], $e[0]]));
	}

	public function testUnterpunkteWandernMitIhremEintrag(): void {
		$text = "1. Kyrie.mscz\n   - Solo: Anna\n2. Gloria.mscz\n";
		$e = SetlistFormat::parse($text)['entries'];

		$this->assertSame("1. Gloria.mscz\n2. Kyrie.mscz\n   - Solo: Anna\n", SetlistFormat::write($text, [$e[1], $e[0]]));
	}

	public function testLockereListeBleibtLocker(): void {
		$text = "- a.mscz\n\n- b.mscz\n";
		$e = SetlistFormat::parse($text)['entries'];

		$this->assertSame("- b.mscz\n\n- a.mscz\n", SetlistFormat::write($text, [$e[1], $e[0]]));
	}

	public function testAnfangsnummerUndTrennerBleiben(): void {
		$text = "5) a.mscz\n6) b.mscz\n";
		$e = SetlistFormat::parse($text)['entries'];

		$this->assertSame("5) b.mscz\n6) a.mscz\n", SetlistFormat::write($text, [$e[1], $e[0]]));
	}

	public function testOhneListeKommtSieAnsEnde(): void {
		$neu = [['content' => SetlistFormat::linkContent('Kyrie', 'Kyrie.mscz')]];

		$this->assertSame("# Leer\n\nText\n\n1. [Kyrie](Kyrie.mscz)\n", SetlistFormat::write("# Leer\n\nText\n\n\n", $neu));
		$this->assertSame("# Leer\n\n1. [Kyrie](Kyrie.mscz)\n", SetlistFormat::write('# Leer', $neu));
		$this->assertSame("1. [Kyrie](Kyrie.mscz)\n", SetlistFormat::write('', $neu));
	}

	public function testAlleEntferntLaesstDenTextStehen(): void {
		$this->assertSame("# T\n\n\nEnde\n", SetlistFormat::write("# T\n\n- a.mscz\n\nEnde\n", []));
		$this->assertSame("# T\n", SetlistFormat::write("# T\n", []));
	}

	public function testSchreibenErsetztNurDieErsteListe(): void {
		$text = "- a.mscz\n\nMitbringen:\n\n- Mappe\n";
		$e = SetlistFormat::parse($text)['entries'];

		$this->assertSame("- a.mscz\n- a.mscz\n\nMitbringen:\n\n- Mappe\n", SetlistFormat::write($text, [$e[0], $e[0]]));
	}

	public function testTitelMitSchliessendenRauten(): void {
		$this->assertSame('Konzert', SetlistFormat::parse("## Unter\n# Konzert ##\n")['title']);
	}

	public function testDateinameOhneEndungAlsTitel(): void {
		$this->assertSame('Abendlied', SetlistFormat::labelFromPath('Zugabe/Abendlied.mscz'));
		$this->assertSame('Ave verum', SetlistFormat::labelFromPath('Ave verum.mscz'));
		$this->assertSame('ohne', SetlistFormat::labelFromPath('ohne'));
	}
	/**
	 * S6: Ein Zeilenumbruch machte aus einem Eintrag zwei - der zweite ein
	 * Stueck, das niemand gewaehlt hat. Abgelehnt, nicht ersetzt.
	 */
	public function testSteuerzeichenImNeuenEintragWerdenAbgelehnt(): void {
		foreach ([["Kyrie\n2. [x](../../Privat/x.mscz)", 'K.mscz'], ['Kyrie', "K.mscz\n- b.mscz"], ['Ky' . chr(0) . 'rie', 'K.mscz'], ['Kyrie', 'K' . chr(127) . '.mscz']] as [$titel, $ziel]) {
			try {
				SetlistFormat::linkContent($titel, $ziel);
				$this->fail(json_encode([$titel, $ziel]));
			} catch (\InvalidArgumentException) {
				$this->addToAssertionCount(1);
			}
		}
	}

	public function testSchreiberLehntUmbruchImEintragAb(): void {
		foreach ([['content' => "a.mscz\n- b.mscz"], ['content' => 'a.mscz', 'tail' => ["  x\r- b.mscz"]], ['content' => 'a' . chr(0)]] as $eintrag) {
			try {
				SetlistFormat::write("- x.mscz\n", [$eintrag]);
				$this->fail(json_encode($eintrag));
			} catch (\InvalidArgumentException) {
				$this->addToAssertionCount(1);
			}
		}
	}

	/** Tabulatoren in von Hand eingerueckten Unterpunkten bleiben erlaubt - sie kommen unveraendert zurueck. */
	public function testTabulatorImUnterpunktBleibt(): void {
		$text = "1. Kyrie.mscz\n\t- Solo: Anna\n2. Gloria.mscz\n";
		$e = SetlistFormat::parse($text)['entries'];

		$this->assertSame("1. Gloria.mscz\n2. Kyrie.mscz\n\t- Solo: Anna\n", SetlistFormat::write($text, [$e[1], $e[0]]));
	}
}
