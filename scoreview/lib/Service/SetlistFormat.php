<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Das Dateiformat der Setliste (E11) - rein, ohne
 * Nextcloud, damit es sich an handgeschriebenen Dateien testen laesst.
 *
 * Eine Setliste ist Markdown, das man im Texteditor von Hand schreibt:
 *
 *     # Konzert Herbst 2026
 *
 *     Freier Text bleibt erhalten.
 *
 *     1. [Kyrie](../Messe/Kyrie.mscz)
 *     2. [Ave verum](Ave%20verum.mscz)
 *     3. Zugabe/Abendlied.mscz
 *
 * **Eintraege sind die Elemente der ERSTEN Liste**, nummeriert oder nicht.
 * Alles andere ist freier Text und bleibt beim Schreiben Byte fuer Byte
 * stehen - die App fasst nur an, was sie selbst versteht. Eine zweite Liste
 * (etwa „Mitbringen: Mappe, Bleistift") ist damit kein Programm, sondern
 * Notiz.
 *
 * Ein Eintrag ist ein Markdown-Link - dann gilt das Linkziel, mit %-Kodierung
 * wie in jedem Link - oder ein roher Pfad, dort sind Leerzeichen roh erlaubt,
 * weil so jemand tippt. Dasselbe Stueck darf mehrfach vorkommen.
 *
 * **Bewusst nicht CommonMark in jeder Ecke:** Eine nicht eingerueckte Zeile
 * direkt nach einem Eintrag beendet die Liste, statt als „faule Fortsetzung"
 * zum Eintrag zu gehoeren. Wer „eine Zeile je Stueck" schreibt und darunter
 * ohne Leerzeile einen Satz, meint den Satz nicht als Teil des letzten
 * Stuecks; als Pfad gelesen waere der Eintrag sonst „fehlend". Eingerueckte
 * Zeilen (Unterlisten, Anmerkungen) gehoeren dagegen zum Eintrag davor und
 * wandern beim Umordnen mit ihm.
 */
class SetlistFormat {
	/** Die Endung, an der Files, Viewer und Server eine Setliste erkennen (E6, E11). */
	public const EXTENSION = '.setlist.md';

	/**
	 * Liest Titel und Eintraege.
	 *
	 * @return array{
	 *     title: ?string,
	 *     entries: list<array{label: string, target: string, content: string, tail: list<string>}>,
	 * }
	 *   `target` ist das Linkziel (dekodiert) bzw. der rohe Pfad; `content`
	 *   und `tail` sind der Originaltext des Eintrags samt eingerueckter
	 *   Folgezeilen - damit schreibt der Writer einen unveraenderten Eintrag
	 *   genau so zurueck, wie er war.
	 */
	public static function parse(string $text): array {
		$lines = self::lines($text)['lines'];
		$block = self::findList($lines);
		$entries = [];
		foreach ($block['items'] ?? [] as $item) {
			$entry = self::entry($item['content']);
			if ($entry !== null) {
				$entries[] = $entry + ['content' => $item['content'], 'tail' => $item['tail']];
			}
		}
		return ['title' => self::title($lines), 'entries' => $entries];
	}

	/**
	 * Ersetzt die erste Liste durch `$items` und laesst alles andere stehen
	 * (E11). Gibt es noch keine Liste, kommt sie ans Ende.
	 *
	 * Nummerierung, Aufzaehlungszeichen und Einrueckung der vorhandenen Liste
	 * bleiben, ebenso ihre Lockerheit (Leerzeilen zwischen den Eintraegen) -
	 * eine von Hand geschriebene Liste sieht danach aus wie vorher, nur in
	 * neuer Reihenfolge.
	 *
	 * @param list<array{content: string, tail?: list<string>}> $items
	 * @throws \InvalidArgumentException bei Zeilenumbruch oder NUL in einem Eintrag (S6)
	 */
	public static function write(string $text, array $items): string {
		// Ein Zeilenumbruch in einem Eintrag machte aus EINER Zeile zwei - die
		// zweite waere freier Text oder, schlimmer, ein weiterer Eintrag, den
		// niemand gewaehlt hat (S6). NUL hat in einer Textdatei nichts
		// verloren. Tabulatoren bleiben erlaubt: Von Hand eingerueckte
		// Unterpunkte tragen sie, und sie kommen unveraendert zurueck.
		foreach ($items as $item) {
			foreach ([$item['content'], ...($item['tail'] ?? [])] as $line) {
				if (preg_match('/[\r\n\x00]/', $line) === 1) {
					throw new \InvalidArgumentException('Zeilenumbruch oder NUL in einem Eintrag');
				}
			}
		}
		['lines' => $lines, 'eol' => $eol, 'finalEol' => $finalEol] = self::lines($text);
		$block = self::findList($lines);

		$indent = $block['indent'] ?? '';
		$ordered = $block['ordered'] ?? true;
		$start = $block['startNumber'] ?? 1;
		$marker = $block['marker'] ?? '.';
		$loose = $block['loose'] ?? false;

		$generated = [];
		foreach (array_values($items) as $i => $item) {
			if ($loose && $i > 0) {
				$generated[] = '';
			}
			$prefix = $ordered ? ($start + $i) . $marker : $marker;
			$generated[] = rtrim($indent . $prefix . ' ' . $item['content']);
			foreach ($item['tail'] ?? [] as $tailLine) {
				$generated[] = $tailLine;
			}
		}

		if ($block !== null) {
			array_splice($lines, $block['start'], $block['end'] - $block['start'], $generated);
		} elseif ($generated !== []) {
			// Neue Liste ans Ende, durch eine Leerzeile vom Text getrennt -
			// ohne sie klebte sie an einem Absatz und waere dessen Teil.
			while ($lines !== [] && trim(end($lines)) === '') {
				array_pop($lines);
			}
			if ($lines !== []) {
				$lines[] = '';
			}
			array_push($lines, ...$generated);
			$finalEol = true;
		}

		$result = implode($eol, $lines);
		return $finalEol && $lines !== [] ? $result . $eol : $result;
	}

	/**
	 * Der Text eines neuen Eintrags: ein Link mit dem Dateinamen ohne Endung
	 * als Titel - lesbar im Texteditor, und das Ziel bleibt
	 * auch mit Leerzeichen und Klammern ein gueltiger Link.
	 *
	 * @throws \InvalidArgumentException bei Steuerzeichen in Titel oder Pfad (S6)
	 */
	public static function linkContent(string $label, string $target): string {
		// Abgelehnt statt still ersetzt: Ein Eintrag mit Zeilenumbruch braeche
		// die Liste, und wer ihn schickt, hat ihn nicht getippt.
		if (self::hasControlChars($label) || self::hasControlChars($target)) {
			throw new \InvalidArgumentException('Steuerzeichen in Titel oder Pfad');
		}
		$label = trim($label);
		$label = addcslashes($label, '\\[]');
		// Nur, was einen Link bricht, wird kodiert - Umlaute bleiben lesbar.
		// `%` zuerst im Sinn von strtr (alle Ersetzungen auf einmal), damit
		// ein echtes Prozentzeichen im Namen beim Lesen nicht dekodiert wird.
		$encoded = strtr($target, [
			'%' => '%25',
			' ' => '%20',
			'(' => '%28',
			')' => '%29',
			'<' => '%3C',
			'>' => '%3E',
		]);
		return '[' . $label . '](' . $encoded . ')';
	}

	/** Ob ein Titel oder Pfad Steuerzeichen (C0, DEL) enthaelt - in keinem von beiden hat eines etwas verloren. */
	public static function hasControlChars(string $value): bool {
		return preg_match('/[\x00-\x1F\x7F]/', $value) === 1;
	}

	/** Der Dateiname ohne Verzeichnis und ohne Endung - der Titel eines Eintrags ohne eigenen. */
	public static function labelFromPath(string $path): string {
		$base = basename(str_replace('\\', '/', rtrim($path, '/')));
		$name = pathinfo($base, PATHINFO_FILENAME);
		return $name !== '' ? $name : $base;
	}

	/**
	 * @return array{lines: list<string>, eol: string, finalEol: bool}
	 */
	private static function lines(string $text): array {
		// Die Zeilenenden der Datei bleiben, wie sie sind: Wer unter Windows
		// schreibt, bekommt keine gemischte Datei zurueck.
		$eol = str_contains($text, "\r\n") ? "\r\n" : "\n";
		if ($text === '') {
			return ['lines' => [], 'eol' => $eol, 'finalEol' => false];
		}
		$lines = preg_split('/\r\n|\n|\r/', $text) ?: [];
		$finalEol = false;
		if (end($lines) === '') {
			array_pop($lines);
			$finalEol = true;
		}
		return ['lines' => $lines, 'eol' => $eol, 'finalEol' => $finalEol];
	}

	/**
	 * Die erste Liste ausserhalb von Codebloecken.
	 *
	 * @param list<string> $lines
	 * @return ?array{start: int, end: int, indent: string, ordered: bool, marker: string, startNumber: int, loose: bool, items: list<array{content: string, tail: list<string>}>}
	 */
	private static function findList(array $lines): ?array {
		$fence = null;
		$count = count($lines);
		for ($i = 0; $i < $count; $i++) {
			$line = $lines[$i];
			if (preg_match('/^ {0,3}(`{3,}|~{3,})/', $line, $m)) {
				if ($fence === null) {
					$fence = $m[1][0];
				} elseif ($m[1][0] === $fence) {
					$fence = null;
				}
				continue;
			}
			if ($fence !== null) {
				continue;
			}
			$item = self::listItem($line);
			if ($item !== null) {
				return self::collectList($lines, $i, $item);
			}
		}
		return null;
	}

	/**
	 * @param list<string> $lines
	 * @param array{indent: string, marker: string, ordered: bool, number: int, content: string} $first
	 */
	private static function collectList(array $lines, int $start, array $first): array {
		$items = [['content' => $first['content'], 'tail' => []]];
		$end = $start + 1;
		$loose = false;
		$pendingBlank = 0;
		$count = count($lines);
		for ($j = $start + 1; $j < $count; $j++) {
			$line = $lines[$j];
			if (trim($line) === '') {
				$pendingBlank++;
				continue;
			}
			$item = self::listItem($line);
			// Geschwister ist, wer (fast) so weit eingerueckt ist wie der erste
			// Eintrag. Tiefer eingerueckt ist eine Unterliste - auch mit zwei
			// Leerzeichen unter „1. ", wo CommonMark streng genommen drei
			// verlangt; so schreiben es die meisten von Hand.
			if ($item !== null && strlen($item['indent']) <= strlen($first['indent']) + 1) {
				if ($item['ordered'] !== $first['ordered'] || $item['marker'] !== $first['marker']) {
					// Anderes Zeichen = eine neue Liste (wie CommonMark).
					break;
				}
				$loose = $loose || $pendingBlank > 0;
				$items[] = ['content' => $item['content'], 'tail' => []];
				$pendingBlank = 0;
				$end = $j + 1;
				continue;
			}
			if (preg_match('/^( {2,}|\t)/', $line)) {
				// Eingerueckt: gehoert zum Eintrag davor - samt der Leerzeilen
				// dazwischen, sonst verloere eine Anmerkung mit Absaetzen ihre
				// Form.
				$last = count($items) - 1;
				for ($b = 0; $b < $pendingBlank; $b++) {
					$items[$last]['tail'][] = '';
				}
				$items[$last]['tail'][] = $line;
				$pendingBlank = 0;
				$end = $j + 1;
				continue;
			}
			break;
		}
		return [
			'start' => $start,
			'end' => $end,
			'indent' => $first['indent'],
			'ordered' => $first['ordered'],
			'marker' => $first['marker'],
			'startNumber' => $first['number'],
			'loose' => $loose,
			'items' => $items,
		];
	}

	/**
	 * Ein Listenelement - `marker` ist das Aufzaehlungszeichen bzw. der
	 * Trenner nach der Zahl.
	 *
	 * @return ?array{indent: string, marker: string, ordered: bool, number: int, content: string}
	 */
	private static function listItem(string $line): ?array {
		// Eine Trennlinie (`---`, `* * *`) ist kein Eintrag, obwohl sie mit
		// einem Aufzaehlungszeichen beginnt - und steht gern als Kopf ganz oben.
		if (preg_match('/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/', $line)) {
			return null;
		}
		if (!preg_match('/^( {0,3})(?:([-*+])|(\d{1,9})([.)]))(?:([ \t]+)(.*))?$/', $line, $m)) {
			return null;
		}
		$ordered = ($m[3] ?? '') !== '';
		return [
			'indent' => $m[1],
			'marker' => $ordered ? $m[4] : $m[2],
			'ordered' => $ordered,
			'number' => $ordered ? (int)$m[3] : 1,
			'content' => trim($m[6] ?? ''),
		];
	}

	/**
	 * Ein Eintrag aus dem Text eines Listenelements - oder null, wenn dort
	 * nichts steht.
	 *
	 * @return ?array{label: string, target: string}
	 */
	private static function entry(string $content): ?array {
		// Eine Aufgabenliste (`- [ ] Kyrie.mscz`) ist ein haeufiger Weg, eine
		// Liste zu schreiben - das Kaestchen gehoert nicht zum Pfad.
		$content = preg_replace('/^\[[ xX]\]\s+/', '', $content) ?? $content;
		if ($content === '') {
			return null;
		}
		$link = '/\[((?:\\\\.|[^\\\\\]])*)\]\(\s*(?:<([^>\n]*)>|((?:[^\s()\\\\]|\\\\.|\((?:[^\s()\\\\]|\\\\.)*\))*))(?:\s+(?:"[^"]*"|\'[^\']*\'|\([^)]*\)))?\s*\)/';
		if (preg_match($link, $content, $m)) {
			$target = ($m[2] ?? '') !== '' ? $m[2] : ($m[3] ?? '');
			$target = rawurldecode(preg_replace('/\\\\(.)/', '$1', $target) ?? $target);
			$label = trim(preg_replace('/\\\\(.)/', '$1', $m[1]) ?? $m[1]);
			return ['label' => $label !== '' ? $label : self::labelFromPath($target), 'target' => $target];
		}
		// Roher Pfad. Steht hinter der Partitur noch ein Vermerk
		// („Kyrie.mscz (Solo: Anna)"), gilt nur der Pfad bis zur Endung.
		$target = preg_match('/^(.+?\.mscz)(?=\s|$)/i', $content, $m) ? $m[1] : $content;
		return ['label' => self::labelFromPath($target), 'target' => $target];
	}

	/**
	 * Die erste Ueberschrift der Ebene 1 ausserhalb von Codebloecken.
	 *
	 * @param list<string> $lines
	 */
	private static function title(array $lines): ?string {
		$fence = null;
		foreach ($lines as $line) {
			if (preg_match('/^ {0,3}(`{3,}|~{3,})/', $line, $m)) {
				$fence = $fence === null ? $m[1][0] : ($m[1][0] === $fence ? null : $fence);
				continue;
			}
			if ($fence === null && preg_match('/^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/', $line, $m)) {
				return $m[1];
			}
		}
		return null;
	}
}
