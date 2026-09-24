<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Eine abgelehnte Aufnahme. Wie FollowException ein fester Code statt eines
 * Textes: Der Controller bildet ihn auf Status und uebersetzte Meldung ab,
 * der Service kennt weder HTTP noch IL10N.
 */
class RecordingException extends \RuntimeException {
	/** Keine WAV, wie der Viewer sie baut (400). */
	public const INVALID = 'invalid';
	/** Laenger als `max_recording_seconds` (413). */
	public const TOO_LONG = 'too_long';
	/**
	 * Obergrenze je Partitur erreicht, und das Ersetzen der aeltesten wurde
	 * nicht bestaetigt (409: nichts wird still ueberschrieben).
	 */
	public const LIMIT_REACHED = 'limit_reached';
	/** Der Speicher je Person ist voll (507). */
	public const USER_STORAGE_FULL = 'user_storage_full';
	/** Der Speicher der ganzen Instanz ist voll (507). */
	public const TOTAL_STORAGE_FULL = 'total_storage_full';
	/** Keine eigene Aufnahme mit dieser Kennung (404, S8). */
	public const NOT_FOUND = 'not_found';

	public function __construct(
		private string $reason,
	) {
		parent::__construct($reason);
	}

	public function getReason(): string {
		return $this->reason;
	}
}
