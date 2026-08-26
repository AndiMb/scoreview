<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Fehler auf dem Sidecar-Weg. Die Trennung nach Weg dient der Diagnose -
 * behandelt werden beide Wege gleich, deshalb fangen die Jobs
 * ConverterException und nicht diese Klasse.
 */
class SidecarException extends ConverterException {
}
