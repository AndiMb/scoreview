<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use OCA\ScoreView\Service\MimetypeRegistration;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;

/**
 * Registriert den Mimetype bei Installation und bei jedem Update.
 *
 * Kein Migrationsschritt (`Version…Date…`): Der Bestand, den dieser Schritt
 * berichtigt, gehoert nicht dieser App - er steht in Nextclouds `filecache`.
 * Migrationen sind fuer das eigene Schema da, Repair-Steps fuer genau solche
 * Eingriffe daneben.
 *
 * Eingehaengt unter **beiden** Schluesseln in `appinfo/info.xml`:
 * `OC\Installer` fuehrt `install` nur bei der Erstinstallation aus und
 * `post-migration` nur, wenn schon eine Version dastand (nachgesehen in
 * lib/private/Installer.php). Nur einer von beiden liesse den jeweils anderen
 * Fall aus.
 *
 * Der Schritt ist **wiederholbar**: `updateFilecache()` fasst nur Zeilen an,
 * die noch nicht auf dem Zielwert stehen. Ein zweiter Lauf meldet null Zeilen.
 */
class RegisterScoreMimetype implements IRepairStep {
	public function __construct(
		private MimetypeRegistration $registration,
	) {
	}

	public function getName(): string {
		return 'Register the MuseScore mimetype and fix existing .mscz files';
	}

	public function run(IOutput $output): void {
		$rows = $this->registration->apply();

		if ($rows === null) {
			// Entweder bietet dieser Server updateFilecache() nicht an, oder
			// das UPDATE ist gescheitert - kein Grund, das Update der App
			// abzubrechen (siehe Service\MimetypeRegistration). Der Hinweis
			// gehoert trotzdem in die Ausgabe, sonst sucht ihn spaeter jemand
			// im Log.
			$output->info('ScoreView: mimetype registration skipped, see the log for details.');
			return;
		}

		$output->info(sprintf(
			'ScoreView: mimetype application/x-musescore registered, %d file(s) corrected.',
			$rows,
		));
	}
}
