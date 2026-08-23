<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\ScoreConversion;

/**
 * Traegt zusaetzlich zur Nachricht einen `error_code` aus
 * ScoreConversion::ERROR_* (Phase 14) - so muessen ConvertScoreJob/
 * PollConversionJob beim Aufrufen von ConversionService::markError() nicht
 * selbst aus der (frei formulierten) Nachricht auf einen Code zurueckschliessen.
 * Default ERROR_UNKNOWN, weil die meisten bestehenden Wurfstellen keinen
 * spezifischeren Code kennen (z.B. eine unerwartete Antwortform) - nur die
 * Netzwerk-/HTTP-Aufrufstellen in SidecarClient setzen ihn gezielt.
 */
class SidecarException extends \RuntimeException {
	public function __construct(
		string $message,
		int $code = 0,
		?\Throwable $previous = null,
		private string $errorCode = ScoreConversion::ERROR_UNKNOWN,
	) {
		parent::__construct($message, $code, $previous);
	}

	public function getErrorCode(): string {
		return $this->errorCode;
	}
}
