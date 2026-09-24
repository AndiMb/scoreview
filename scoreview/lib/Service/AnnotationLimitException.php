<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Die Nutzerin hat zu dieser Datei schon so viele Notizen, wie eine Person
 * haben darf (AnnotationService::MAX_PER_USER_AND_FILE).
 *
 * Eine eigene Klasse und bewusst KEIN \RuntimeException: Der Controller
 * liest \RuntimeException aus dem Service als "kein Schreibrecht" (403) -
 * eine erreichte Obergrenze ist etwas anderes und bekommt ihre eigene
 * Antwort.
 */
class AnnotationLimitException extends \Exception {
}
