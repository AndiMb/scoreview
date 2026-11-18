<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\Annotation;

/**
 * What a note, a stamp, a saved loop or a drawing must look like before it is
 * stored - one place for the rules of creating and of changing, so that what
 * may be created may also be changed into (and the other way round). Pure:
 * no database, no HTTP, no IL10N; it throws AnnotationException with a code
 * and the controller words it.
 *
 * Who may write is not decided here: that is AnnotationService's (by
 * visibility, write permission and leader role).
 */
final class AnnotationValidator {
	/**
	 * Obergrenze fuer den Text einer Notiz. Die Spalte ist TEXT und haette
	 * selbst keine, aber `content` ist das einzige frei formulierte Feld der
	 * App: ohne Grenze traegt eine einzelne Notiz so viel, wie die
	 * Anfragegroesse der Instanz durchlaesst, und wird danach bei JEDEM
	 * Oeffnen der Partitur mit ausgeliefert (listForFile laedt alle Notizen
	 * einer Datei auf einmal). 10000 Zeichen sind weit jenseits einer
	 * Probennotiz und decken auch einen langen Absatz ab.
	 */
	public const MAX_CONTENT_LENGTH = 10000;

	/**
	 * Bounds of a drawing (E22), the same as src/lib/drawingLayout.js: a few
	 * marks, not a picture.
	 */
	public const MAX_DRAWING_STROKES = 40;
	public const MAX_DRAWING_POINTS = 800;
	public const MAX_DRAWING_OFFSET = 400;

	/**
	 * Die Spalte ist VARCHAR(64) (Migration\Version000100Date20260823130000);
	 * ohne diese Pruefung endete ein laengerer Wert unter MySQL/PostgreSQL im
	 * Strict-Mode als 500er - fuer eine Eingabe, die der Client vollstaendig
	 * bestimmt. Geprueft wird nur die LAENGE, nicht der Inhalt: Ein etag ist
	 * fuer diese App undurchsichtig, und ob er noch zu einer Konvertierung
	 * passt, entscheidet erst die Anzeige (AnnotationService::serialize
	 * markiert eine nicht mehr aufloesbare Notiz als `orphaned`).
	 */
	public const MAX_ANCHOR_ETAG_LENGTH = 64;

	private function __construct() {
	}

	/**
	 * Ein unbekannter Typ wird zur Textnotiz - der engere Fall: Sie braucht
	 * Text, ein Tippfehler endet also als 400 statt als Stempel ohne Bild.
	 */
	public static function kind(string $kind): string {
		return in_array($kind, [Annotation::KIND_STAMP, Annotation::KIND_LOOP, Annotation::KIND_DRAWING], true) ? $kind : Annotation::KIND_TEXT;
	}

	/**
	 * Everything a new annotation of this kind must satisfy.
	 *
	 * @param string $kind already passed through kind()
	 * @throws AnnotationException
	 */
	public static function forCreate(string $kind, int $measureNumber, ?int $endMeasure, string $content, ?string $stamp, ?string $anchorEtag): void {
		if ($kind === Annotation::KIND_STAMP) {
			self::stamp($stamp, $content);
		} elseif ($kind === Annotation::KIND_LOOP) {
			self::loop($measureNumber, $endMeasure, $content);
		} elseif ($kind === Annotation::KIND_DRAWING) {
			self::drawing($content);
		} else {
			self::text($content);
		}
		self::anchorEtag($anchorEtag);
	}

	/**
	 * The text of a text note: not empty, not too long.
	 *
	 * @throws AnnotationException
	 */
	public static function text(string $content): void {
		if (trim($content) === '') {
			throw new AnnotationException(AnnotationException::EMPTY);
		}
		self::length($content);
	}

	/**
	 * Only the length - whether the text may be empty depends on the kind of
	 * the note (a stamp may), which an update learns only from the stored row.
	 * mb_strlen, not strlen: characters count, or a note with umlauts would
	 * have less room than one without.
	 *
	 * @throws AnnotationException
	 */
	public static function length(string $content): void {
		if (mb_strlen($content) > self::MAX_CONTENT_LENGTH) {
			throw new AnnotationException(AnnotationException::TOO_LONG);
		}
	}

	/**
	 * Ein Stempel braucht einen Code aus der festen Liste; sein Text ist ein
	 * freiwilliger Zusatz und nur in der Laenge begrenzt.
	 *
	 * @throws AnnotationException
	 */
	public static function stamp(?string $stamp, string $content): void {
		if ($stamp === null || !in_array($stamp, Annotation::STAMPS, true)) {
			throw new AnnotationException(AnnotationException::UNKNOWN_STAMP);
		}
		self::length($content);
	}

	/**
	 * A saved loop needs an end measure at or after its start; its name is
	 * optional and only bounded in length. No upper bound against the score:
	 * like a note's measure, a range beyond the current score shows as
	 * orphaned (AnnotationService::serialize) rather than being refused.
	 *
	 * @throws AnnotationException
	 */
	public static function loop(int $measureNumber, ?int $endMeasure, string $content): void {
		if ($endMeasure === null || $endMeasure < max(1, $measureNumber)) {
			throw new AnnotationException(AnnotationException::INVALID_LOOP);
		}
		self::length($content);
	}

	/**
	 * A drawing (E22) is JSON `{v: 1, part: ?{id, name}, s: [[x, y, ...], ...]}`
	 * with coordinates in staff spaces. Checked in full: the content goes to
	 * every reader of the score and is turned into SVG paths there, so it has
	 * to be numbers - and few of them. The bounds are the client's
	 * (src/lib/drawingLayout.js); the overall length is that of every note.
	 *
	 * @throws AnnotationException
	 */
	public static function drawing(string $content): void {
		self::length($content);
		try {
			$data = json_decode($content, true, 8, JSON_THROW_ON_ERROR);
		} catch (\JsonException) {
			throw new AnnotationException(AnnotationException::INVALID_DRAWING);
		}
		if (!is_array($data) || ($data['v'] ?? null) !== 1 || !is_array($data['s'] ?? null)) {
			throw new AnnotationException(AnnotationException::INVALID_DRAWING);
		}
		$strokes = $data['s'];
		if (count($strokes) === 0 || count($strokes) > self::MAX_DRAWING_STROKES) {
			throw new AnnotationException(AnnotationException::INVALID_DRAWING);
		}
		$numbers = 0;
		foreach ($strokes as $stroke) {
			if (!is_array($stroke) || count($stroke) < 4 || count($stroke) % 2 !== 0 || !array_is_list($stroke)) {
				throw new AnnotationException(AnnotationException::INVALID_DRAWING);
			}
			foreach ($stroke as $value) {
				if (!(is_int($value) || is_float($value)) || abs($value) > self::MAX_DRAWING_OFFSET) {
					throw new AnnotationException(AnnotationException::INVALID_DRAWING);
				}
			}
			$numbers += count($stroke);
		}
		// Two numbers a point, plus the doubled point of a single dot.
		if ($numbers > 2 * self::MAX_DRAWING_POINTS + 2 * self::MAX_DRAWING_STROKES) {
			throw new AnnotationException(AnnotationException::INVALID_DRAWING);
		}
		$part = $data['part'] ?? null;
		if ($part !== null && TargetParts::normalize([$part]) === null) {
			throw new AnnotationException(AnnotationException::INVALID_DRAWING);
		}
	}

	/** @throws AnnotationException */
	public static function anchorEtag(?string $anchorEtag): void {
		if ($anchorEtag !== null && mb_strlen($anchorEtag) > self::MAX_ANCHOR_ETAG_LENGTH) {
			throw new AnnotationException(AnnotationException::INVALID_ANCHOR);
		}
	}

	/**
	 * Die Zielstimmen als geprueftes JSON `[{id, name}]` - dieselbe Regel wie
	 * fuer die Aufnahmen der Leitung (Service\TargetParts).
	 *
	 * @throws AnnotationException when no valid voice is left or the list
	 *                             breaks the bounds
	 */
	public static function targetParts(mixed $targetParts): string {
		$json = TargetParts::normalize($targetParts);
		if ($json === null) {
			throw new AnnotationException(AnnotationException::NO_TARGET_PARTS);
		}
		return $json;
	}
}
