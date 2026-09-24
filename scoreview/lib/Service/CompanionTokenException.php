<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Ein Begleit-Token, das nicht gilt. Der Grund ist ein fester Code, damit
 * die Middleware einen abgelaufenen Token (die Seite holt neue) von einem
 * kaputten oder gefaelschten unterscheiden kann - mehr erfaehrt die Anfrage
 * nicht, schon gar nicht, WAS an der Signatur nicht stimmte.
 */
class CompanionTokenException extends \RuntimeException {
	/** Aufbau, Laenge, Kodierung oder Inhalt unbrauchbar. */
	public const MALFORMED = 'malformed';
	/** Die Signatur passt nicht - gefaelscht, veraendert, oder das Geheimnis wurde gewechselt. */
	public const SIGNATURE = 'signature';
	/** Abgelaufen, oder mit einer Laufzeit, die der Server nie ausstellt. */
	public const EXPIRED = 'expired';

	public function __construct(
		private string $reason,
	) {
		parent::__construct($reason);
	}

	public function getReason(): string {
		return $this->reason;
	}
}
