<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\ScoreConversion;

/**
 * Der Sidecar ist erreichbar, nimmt aber gerade nichts an: Seine
 * Warteschlange ist voll (HTTP 503 mit Retry-After, siehe
 * sidecar/scoreview_sidecar/app.py).
 *
 * Eine eigene Klasse, weil das kein Fehler der Partitur und auch keiner der
 * Instanz ist: BackgroundJob\ConvertScoreJob reicht die Konvertierung
 * spaeter erneut ein, statt sie scheitern zu lassen. Als
 * ERROR_SIDECAR_UNREACHABLE durchgereicht, schaltete Service\ClientFallback
 * fuer alle auf den Browser um - ein Stapel-Upload von mehr Partituren, als
 * die Warteschlange fasst, loeste so den Rueckfall aus, obwohl der Sidecar
 * nur ausgelastet ist.
 */
class SidecarBusyException extends SidecarException {
	public function __construct(
		string $message,
		private int $retryAfterSeconds,
		?\Throwable $previous = null,
	) {
		parent::__construct($message, 0, $previous, ScoreConversion::ERROR_SIDECAR_BUSY);
	}

	/** Die Wartezeit, die der Sidecar selbst nennt (ungedeckelt). */
	public function getRetryAfterSeconds(): int {
		return $this->retryAfterSeconds;
	}
}
