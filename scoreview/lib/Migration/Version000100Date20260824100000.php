<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCA\ScoreView\AppInfo\Application;
use OCP\IAppConfig;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Phase 23/Schritt 3 (Codereview-Befund C2): markiert `sidecar_secret`
 * nachträglich als sensibel.
 *
 * Warum überhaupt: `IAppConfig` kann einen Wert als sensibel führen und
 * blendet ihn dann in `occ config:app:list`, im Support-Bericht und in
 * Systemreports aus - also genau in den Ausgaben, die man beim Fehlersuchen
 * weitergibt. Bis hierher stand das gemeinsame Geheimnis zwischen App und
 * Sidecar dort im Klartext.
 *
 * Warum als Migration und nicht nur beim Speichern: Das `sensitive`-Flag von
 * `setValueString()` greift nur, wenn der Schlüssel noch nicht existiert -
 * `IAppConfig` ändert den Status eines vorhandenen Wertes ausdrücklich nicht
 * über den Setter (siehe dortige Doku). Bestandsinstallationen behielten
 * ihren Klartext-Eintrag also, bis jemand zufällig ein neues Secret einträgt.
 * `updateSensitive()` ist der dafür vorgesehene Weg und wird hier einmalig
 * ausgeführt.
 *
 * Kein Schemaänderung, deshalb nur `postSchemaChange`.
 */
class Version000100Date20260824100000 extends SimpleMigrationStep {
	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		if (!$this->appConfig->hasKey(Application::APP_ID, 'sidecar_secret')) {
			// Frische Installation - der Setter im SettingsController legt den
			// Schlüssel gleich sensibel an, hier gibt es nichts zu tun.
			return;
		}
		if ($this->appConfig->isSensitive(Application::APP_ID, 'sidecar_secret')) {
			return;
		}
		$this->appConfig->updateSensitive(Application::APP_ID, 'sidecar_secret', true);
		$output->info('ScoreView: sidecar_secret ist jetzt als sensibel markiert und wird in Systemberichten ausgeblendet.');
	}
}
