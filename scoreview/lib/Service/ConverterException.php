<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\ScoreConversion;

/**
 * Fehler eines Konvertierungswegs - egal welchen. Traegt zusaetzlich zur
 * Nachricht einen `error_code` aus ScoreConversion::ERROR_*, damit
 * BackgroundJob\ConvertScoreJob beim Aufruf von
 * ConversionService::markError() nicht aus der frei formulierten Nachricht
 * auf einen Code zurueckschliessen muss.
 *
 * Die beiden Wege werfen die Unterklassen SidecarException und
 * LocalConverterException; gefangen wird in den Jobs bewusst diese
 * Basisklasse, weil die Behandlung dort fuer beide identisch ist.
 * Default ERROR_UNKNOWN, weil die meisten Wurfstellen keinen
 * spezifischeren Code kennen (z.B. eine unerwartete Antwortform).
 */
class ConverterException extends \RuntimeException {
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
