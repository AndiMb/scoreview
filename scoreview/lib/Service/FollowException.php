<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Eine abgelehnte Aktion an einer „Folgt mir"-Sitzung. Wie LeaderException
 * ein fester Code statt eines Textes: Der Controller bildet ihn auf Status
 * und uebersetzte Meldung ab, der Service kennt weder HTTP noch IL10N.
 */
class FollowException extends \RuntimeException {
	/** Die handelnde Person ist keine Leitung der Partitur (403). */
	public const NOT_LEADER = 'not_leader';
	/** Es laeuft keine Sitzung, an der sich etwas aendern liesse (409). */
	public const NO_SESSION = 'no_session';
	/**
	 * Eine andere Leitung leitet die Sitzung (409). Uebernehmen geht nur
	 * ausdruecklich ueber POST, nicht nebenbei mit einem Sprung.
	 */
	public const OTHER_LEADER = 'other_leader';
	/** Takt, Buchstabe oder Loop-Bereich ergeben keinen Sinn (400). */
	public const INVALID = 'invalid';
	/**
	 * Mehrere Leitungen schrieben so dicht nacheinander, dass auch der
	 * Wiederholungsversuch verlor (409) - der naechste Tipp geht durch.
	 */
	public const CONFLICT = 'conflict';

	public function __construct(
		private string $reason,
	) {
		parent::__construct($reason);
	}

	public function getReason(): string {
		return $this->reason;
	}
}
