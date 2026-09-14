<?php

declare(strict_types=1);

namespace OCA\ScoreView\Middleware;

use Exception;

/**
 * Der einzige Grund, aus dem DirectAccessMiddleware eine Anfrage abweist.
 *
 * Traegt den HTTP-Status und einen Code, keinen Satz: Uebersetzt wird im
 * Browser (E4), wie bei den Konvertierungsfehlern auch. `Exception::getCode()`
 * bleibt unangetastet - die Signatur dort ist int, der Code hier eine
 * Zeichenkette.
 */
class DirectAccessException extends Exception {
	public function __construct(
		private int $status,
		private string $errorCode,
	) {
		parent::__construct($errorCode);
	}

	public function getStatus(): int {
		return $this->status;
	}

	public function getErrorCode(): string {
		return $this->errorCode;
	}
}
