<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use OCA\ScoreView\Service\CompanionTokenService;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;

/**
 * Legt das Geheimnis fuer die Begleit-Token bei Installation und Update an.
 *
 * Erzeugte es erst die erste Anfrage, die einen Token braucht, koennten zwei
 * gleichzeitige Anfragen je ein eigenes schreiben - und die Token der
 * unterlegenen waeren ungueltig, bevor sie jemand benutzt. `occ upgrade`
 * laeuft dagegen allein. Der verzoegerte Weg in CompanionTokenService bleibt
 * als Rueckfall (etwa nach einem Widerruf per `occ config:app:delete`).
 *
 * Wie RegisterScoreMimetype unter `install` UND `post-migration`
 * eingehaengt; wiederholbar, ein vorhandenes Geheimnis bleibt unberuehrt -
 * ein Update darf keine laufenden Token widerrufen.
 */
class GenerateCompanionSecret implements IRepairStep {
	public function __construct(
		private CompanionTokenService $tokens,
	) {
	}

	public function getName(): string {
		return 'Create the signing secret for companion tokens';
	}

	public function run(IOutput $output): void {
		if ($this->tokens->ensureSecret()) {
			$output->info('ScoreView: companion token secret created.');
		}
	}
}
