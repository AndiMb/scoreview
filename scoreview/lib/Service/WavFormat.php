<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Prueft, ob ein hochgeladener Rumpf genau die WAV ist, die der Viewer baut
 * (PCM, mono, 16 kHz, 16 bit - src/lib/wavCodec.js), und liest ihre
 * Dauer ab.
 *
 * **Warum der Server das selbst nachsieht.** Die Datei landet in IAppData
 * und wird spaeter mit `Content-Type: audio/wav` an denselben Browser
 * zurueckgegeben. Ohne Pruefung liesse sich unter dem Namen einer Aufnahme
 * beliebiger Inhalt ablegen - und die Grenze `max_recording_seconds` liesse
 * sich nicht durchsetzen, wenn die Dauer eine Angabe des Clients waere statt
 * eine Rechnung aus den Bytes.
 *
 * Bewusst eng: Eine Stereo- oder 44,1-kHz-Datei ist kein Angriff, aber auch
 * nichts, was die App je erzeugt. Wer sie schickt, hat einen anderen Client
 * gebaut; der Zeitabgleich und die Intonationsauswertung rechnen fest mit
 * 16 kHz mono.
 *
 * Rein, ohne Nextcloud - getestet in WavFormatTest.
 */
class WavFormat {
	public const SAMPLE_RATE = 16000;
	public const CHANNELS = 1;
	public const BITS = 16;
	/** Bytes je Sekunde Audio: 16000 Samples zu 2 Byte. */
	public const BYTES_PER_SECOND = self::SAMPLE_RATE * self::CHANNELS * (self::BITS / 8);
	/** Mehr als RIFF-, fmt- und data-Kopf braucht die eigene Datei nicht. */
	public const MAX_HEADER_BYTES = 1024;
	/** So viel liest inspectHead() hoechstens: der Kopf samt dem Kopf des data-Blocks. */
	public const HEAD_READ_BYTES = self::MAX_HEADER_BYTES + 8;

	/**
	 * @return array{dataBytes: int, durationMs: int}
	 * @throws \InvalidArgumentException mit einer Begruendung fuer das
	 *                                   Protokoll, nie fuer die Oberflaeche
	 */
	public static function inspect(string $bytes): array {
		return self::inspectHead($bytes, strlen($bytes));
	}

	/**
	 * Wie inspect(), aber nur mit dem Anfang der Datei und ihrer Gesamtlaenge -
	 * so muss ein Upload von bis zu hundert Megabyte fuer die Pruefung nicht
	 * im Speicher liegen. `$head` sollte HEAD_READ_BYTES lang sein (oder die
	 * ganze Datei, wenn sie kuerzer ist).
	 *
	 * Die Laenge muss genau aufgehen: Der data-Block endet mit der Datei.
	 * Weder ein abgeschnittener Upload (er gaebe eine Laenge an, die er nicht
	 * mitbringt) noch angehaengte Bytes (RIFF erlaubte etwa einen LIST-Block
	 * nach den Daten) werden angenommen. Der Viewer haengt nie etwas an, und
	 * gespeichert wuerde sonst Inhalt, den keine Pruefung angesehen hat, der
	 * aber gegen das Speicherkontingent zaehlt.
	 *
	 * @return array{dataBytes: int, durationMs: int}
	 * @throws \InvalidArgumentException
	 */
	public static function inspectHead(string $head, int $totalLength): array {
		$headLength = strlen($head);
		if ($totalLength < 44 || $headLength < 44 || substr($head, 0, 4) !== 'RIFF' || substr($head, 8, 4) !== 'WAVE') {
			throw new \InvalidArgumentException('Kein RIFF/WAVE-Kopf');
		}

		$offset = 12;
		$format = null;
		while ($offset + 8 <= $headLength) {
			$id = substr($head, $offset, 4);
			$size = self::u32($head, $offset + 4);
			$body = $offset + 8;
			if ($id === 'fmt ') {
				if ($size < 16 || $body + 16 > $headLength) {
					throw new \InvalidArgumentException('fmt-Block zu kurz');
				}
				$format = [
					'audioFormat' => self::u16($head, $body),
					'channels' => self::u16($head, $body + 2),
					'sampleRate' => self::u32($head, $body + 4),
					'blockAlign' => self::u16($head, $body + 12),
					'bits' => self::u16($head, $body + 14),
				];
			} elseif ($id === 'data') {
				if ($format === null) {
					throw new \InvalidArgumentException('data vor fmt');
				}
				self::assertFormat($format);
				if ($size === 0) {
					// Eine Aufnahme ohne ein einziges Sample ist kein Ton, belegte
					// aber einen der Plaetze je Partitur.
					throw new \InvalidArgumentException('data-Block leer');
				}
				if ($body + $size > $totalLength) {
					throw new \InvalidArgumentException('data-Block laenger als die Datei');
				}
				if ($body + $size < $totalLength) {
					throw new \InvalidArgumentException('Bytes nach dem data-Block');
				}
				if ($size % 2 !== 0) {
					throw new \InvalidArgumentException('Ungerade Zahl von Datenbytes bei 16 bit');
				}
				return [
					'dataBytes' => $size,
					'durationMs' => intdiv($size * 1000, self::BYTES_PER_SECOND),
				];
			}
			if ($body > self::MAX_HEADER_BYTES) {
				break;
			}
			// RIFF-Bloecke sind auf gerade Laengen aufgefuellt.
			$offset = $body + $size + ($size % 2);
		}
		throw new \InvalidArgumentException('Kein data-Block im Kopf');
	}

	/**
	 * @param array{audioFormat: int, channels: int, sampleRate: int, blockAlign: int, bits: int} $format
	 */
	private static function assertFormat(array $format): void {
		if ($format['audioFormat'] !== 1) {
			throw new \InvalidArgumentException('Kein PCM');
		}
		if ($format['channels'] !== self::CHANNELS || $format['sampleRate'] !== self::SAMPLE_RATE
			|| $format['bits'] !== self::BITS || $format['blockAlign'] !== 2) {
			throw new \InvalidArgumentException('Nicht 16 kHz mono 16 bit');
		}
	}

	private static function u16(string $bytes, int $offset): int {
		return unpack('v', substr($bytes, $offset, 2))[1];
	}

	private static function u32(string $bytes, int $offset): int {
		return unpack('V', substr($bytes, $offset, 4))[1];
	}
}
