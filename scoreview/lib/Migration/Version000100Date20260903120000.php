<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\ConversionBackend;
use OCP\IAppConfig;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Haelt den Sidecar fest, wo einer laeuft - vor dem Wechsel der
 * Voreinstellung auf den lokalen Weg (Service\ConversionBackend).
 *
 * Die Voreinstellung greift nur bei fehlendem Schluessel. Eine Instanz, die
 * seit jeher ueber den Sidecar konvertiert, hat ihn aber gerade DESHALB nie
 * gesetzt: Der Sidecar war die Voreinstellung, es gab nichts zu waehlen.
 * Ohne diesen Schritt wuerde ausgerechnet die eingerichtete Installation
 * beim Update stillschweigend auf den anderen Weg springen - und das faellt
 * erst an der naechsten Konvertierung auf, die dann eine Node-Laufzeit
 * sucht, die es dort nie gebraucht hat.
 *
 * Woran "laeuft einer" erkannt wird: an einer eingetragenen `sidecar_url`.
 * Ohne sie kann der Sidecar-Weg gar nicht funktioniert haben, dort ist die
 * neue Voreinstellung also keine Aenderung, sondern die erste, die etwas
 * tut. Eine frische Installation hat den Schluessel ebenfalls nicht und
 * bleibt unberuehrt.
 *
 * Keine Schemaaenderung, deshalb nur `postSchemaChange`.
 */
class Version000100Date20260903120000 extends SimpleMigrationStep {
	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		if ($this->appConfig->hasKey(Application::APP_ID, ConversionBackend::CONFIG_KEY)) {
			// Ausdruecklich gewaehlt - daran ruehrt eine Migration nicht.
			return;
		}
		if (trim($this->appConfig->getValueString(Application::APP_ID, 'sidecar_url')) === '') {
			return;
		}
		$this->appConfig->setValueString(Application::APP_ID, ConversionBackend::CONFIG_KEY, ConversionBackend::SIDECAR);
		$output->info('ScoreView: Der Sidecar bleibt der Konvertierungsweg dieser Instanz (neue Voreinstellung waere sonst der lokale Weg).');
	}
}
