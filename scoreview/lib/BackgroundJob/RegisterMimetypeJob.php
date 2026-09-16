<?php

declare(strict_types=1);

namespace OCA\ScoreView\BackgroundJob;

use OCA\ScoreView\Service\MimetypeRegistration;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\QueuedJob;

/**
 * Zieht den Mimetype frisch hochgeladener Partituren nach.
 *
 * **Warum ein Job und nicht gleich im Listener.** `updateFilecache()` ist ein
 * UPDATE mit `LOWER(name) LIKE '%.mscz'` - ein voller Durchlauf der
 * Filecache-Tabelle, die auf grossen Instanzen Millionen Zeilen hat. Im
 * Upload-Pfad haetten das alle zu bezahlen, auch wer nie eine Partitur
 * anfasst.
 *
 * **Warum ohne Argument.** `IJobList::add()` reiht denselben Job mit
 * demselben Argument kein zweites Mal ein. Ohne Argument fallen damit
 * beliebig viele Uploads auf genau einen wartenden Job zusammen - und weil
 * das UPDATE ohnehin alle `.mscz` auf einmal berichtigt, ist das nicht nur
 * billiger, sondern auch vollstaendig.
 */
class RegisterMimetypeJob extends QueuedJob {
	public function __construct(
		ITimeFactory $time,
		private MimetypeRegistration $registration,
	) {
		parent::__construct($time);
	}

	protected function run($argument): void {
		$this->registration->apply();
	}
}
