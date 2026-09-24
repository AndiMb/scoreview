<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Eine abgelehnte Aenderung an den Leitungen einer Partitur. Der Grund ist
 * ein fester Code statt eines Textes: Der Controller bildet ihn auf Status
 * und uebersetzte Meldung ab, der Service kennt weder HTTP noch IL10N.
 */
class LeaderException extends \RuntimeException {
	/** Die handelnde Person ist selbst keine Leitung (403). */
	public const NOT_LEADER = 'not_leader';
	/** Die Zielperson gibt es nicht oder sie sieht die Datei nicht. */
	public const NOT_APPOINTABLE = 'not_appointable';
	/** Die Eigentuemerin ist Leitung kraft Dateibaum (E9). */
	public const OWNER = 'owner';
	/** Die Zielperson ist gar nicht ernannt. */
	public const NOT_APPOINTED = 'not_appointed';

	public function __construct(
		private string $reason,
	) {
		parent::__construct($reason);
	}

	public function getReason(): string {
		return $this->reason;
	}
}
