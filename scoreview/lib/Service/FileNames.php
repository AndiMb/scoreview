<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Dateinamen, die die App selbst in Files anlegt (Setlisten E11,
 * Uebe-Tracks E13): ohne Pfadtrenner und Steuerzeichen, Leerraum
 * zusammengezogen, gekuerzt, mit genau der eigenen Endung.
 *
 * Eine Stelle fuer beide, damit ein Name, der als Setliste angenommen wird,
 * auch als Uebe-Track angenommen wird - und der Browser
 * (src/lib/practiceTrackName.js) dieselben Regeln nachbauen kann.
 */
class FileNames {
	/** Ohne Endung, in Zeichen - lang genug fuer „Titel – Stimme (Coach, 80 %)". */
	public const MAX_NAME_LENGTH = 120;
	/**
	 * Und in Bytes: Dateisysteme zaehlen 255 Bytes je Name, und 120 Zeichen
	 * mit Schriftzeichen koennen bis zu 480 Bytes sein. 240 laesst Platz fuer
	 * die laengste eigene Endung (`.setlist.md`) und haelt 120 Umlaute ganz.
	 */
	public const MAX_NAME_BYTES = 240;

	/**
	 * @param list<string> $stripSuffixes Endungen, die weg muessen, bevor die
	 *                                    eigene drankommt (klein geschrieben)
	 * @return ?string der Name ohne Endung, oder null, wenn nichts Brauchbares
	 *                 bleibt (nur Punkte waeren versteckt oder ein Pfadsegment)
	 */
	public static function clean(string $name, array $stripSuffixes): ?string {
		$name = preg_replace('/[\x00-\x1F\x7F\/\\\\]+/u', ' ', $name) ?? '';
		// Richtungszeichen weg: Mit U+202E liesse sich „Bass.mp3" als
		// „Bass3pm." anzeigen - ein Name, der anders aussieht, als er ist.
		$name = preg_replace('/[\x{200E}\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}]+/u', '', $name) ?? '';
		$name = trim(preg_replace('/\s+/u', ' ', $name) ?? '');
		foreach ($stripSuffixes as $suffix) {
			if (str_ends_with(mb_strtolower($name), $suffix)) {
				$name = rtrim(mb_substr($name, 0, mb_strlen($name) - mb_strlen($suffix)));
			}
		}
		$name = trim(mb_strcut(mb_substr($name, 0, self::MAX_NAME_LENGTH), 0, self::MAX_NAME_BYTES, 'UTF-8'));
		if (trim($name, '. ') === '') {
			return null;
		}
		return $name;
	}

	/**
	 * Der erste freie Name nach dem Muster „Name (2).mp3" - als Vorschlag bei
	 * einem Namenskonflikt, nicht als stilles Ausweichen: Wer einen Track
	 * neu erzeugt, will meist den alten ersetzen, und das soll er sagen.
	 *
	 * @param callable(string): bool $exists
	 */
	public static function firstFree(string $base, string $extension, callable $exists): string {
		for ($n = 2; $n < 1000; $n++) {
			$candidate = "{$base} ({$n}){$extension}";
			if (!$exists($candidate)) {
				return $candidate;
			}
		}
		return $base . ' (' . bin2hex(random_bytes(3)) . ')' . $extension;
	}
}
