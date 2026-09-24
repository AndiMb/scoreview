<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Eine abgelehnte Setlisten-Aktion. Der Grund ist ein fester Code statt eines
 * Textes: Der Controller bildet ihn auf Status und uebersetzte Meldung ab, der
 * Service kennt weder HTTP noch IL10N.
 */
class SetlistException extends \RuntimeException {
	/** Keine Setlisten-Datei, oder sie ist nicht sichtbar (404). */
	public const NOT_FOUND = 'not_found';
	/** Kein Schreibrecht auf die Liste bzw. im Ordner (403). */
	public const FORBIDDEN = 'forbidden';
	/** Die Datei hat sich seit dem Lesen geaendert (409). */
	public const CONFLICT = 'conflict';
	/** Eine Datei dieses Namens gibt es schon (409). */
	public const EXISTS = 'exists';
	/** Unbrauchbare Angaben: Name, Eintraege, Anzahl (400). */
	public const INVALID = 'invalid';
	/** Die Datei ist zu gross fuer eine Setliste (413). */
	public const TOO_LARGE = 'too_large';

	public function __construct(
		private string $reason,
	) {
		parent::__construct($reason);
	}

	public function getReason(): string {
		return $this->reason;
	}
}
