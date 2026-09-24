<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Liest den rohen Rumpf einer Anfrage - mit Obergrenze, in eine
 * Zwischendatei statt in den Speicher.
 *
 * Eine Aufnahme kommt als `audio/wav` am Stueck, nicht als Formular:
 * `IRequest` bietet dafuer keinen Zugriff, und ein Multipart-Upload braeuchte
 * `upload_max_filesize`/`post_max_size`, die viele Instanzen klein halten.
 * `php://input` kennt diese Grenzen nicht - deshalb zieht dieser Leser die
 * eigene: Mehr als erlaubt wird gar nicht erst angenommen.
 *
 * **Warum eine Zwischendatei.** Die Obergrenze liegt bei einer Stunde
 * Aufnahme bei rund 115 MB - als String laege das mehrfach im Speicher
 * (Einlesen, Pruefen, Schreiben) und risse das uebliche `memory_limit` von
 * 512 MB mit wenigen gleichzeitigen Uploads, schon 128 MB mit einem einzigen.
 * `php://temp` haelt kleine Rumpfe im Speicher und schreibt alles ueber
 * IN_MEMORY_BYTES ins temporaere Verzeichnis; geprueft wird danach nur der
 * Kopf, und IAppData schreibt aus dem Strom.
 *
 * Als eigene Klasse, damit der Controller ohne echten Eingabestrom testbar
 * bleibt.
 */
class RequestBodyReader {
	/** Bis zu dieser Groesse bleibt der Rumpf im Speicher. */
	public const IN_MEMORY_BYTES = 2 * 1024 * 1024;

	/**
	 * @return resource|null der Rumpf als lesbarer Strom am Anfang, oder
	 *                       null, wenn er laenger als `$maxBytes` ist
	 */
	public function readToStream(int $maxBytes) {
		return self::copyBounded(fopen('php://input', 'rb'), $maxBytes);
	}

	/**
	 * @param resource|false $input
	 * @return resource|null
	 */
	public static function copyBounded($input, int $maxBytes) {
		$spool = fopen('php://temp/maxmemory:' . self::IN_MEMORY_BYTES, 'w+b');
		if ($spool === false) {
			throw new \RuntimeException('Keine Zwischendatei fuer den Upload');
		}
		if ($input === false) {
			return $spool;
		}
		try {
			$copied = stream_copy_to_stream($input, $spool, $maxBytes + 1);
		} finally {
			fclose($input);
		}
		if ($copied !== false && $copied > $maxBytes) {
			fclose($spool);
			return null;
		}
		if ($copied === false) {
			// Ein Rumpf, der sich nicht lesen laesst, gilt als leer - die
			// Formatpruefung lehnt ihn dann mit 400 ab statt mit einem 500.
			ftruncate($spool, 0);
		}
		rewind($spool);
		return $spool;
	}
}
