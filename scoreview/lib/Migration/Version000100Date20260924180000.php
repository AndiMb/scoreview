<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Index auf `user_id` der Notiztabelle.
 *
 * Beim Loeschen eines Kontos (Listener\UserDeletedListener) gehen alle
 * Notizen dieser Person weg - ohne Index ein Scan ueber die Notizen der
 * ganzen Instanz. Der vorhandene Index `sv_annot_file_user` beginnt mit
 * `file_id` und hilft bei einer Abfrage nur nach der Person nicht; Leitungen
 * und Aufnahmen haben ihren `user_id`-Index aus demselben Grund schon
 * (Version000100Date20260924100000).
 */
class Version000100Date20260924180000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->hasTable('scoreview_annotations')) {
			return null;
		}
		$table = $schema->getTable('scoreview_annotations');
		if ($table->hasIndex('sv_annot_user')) {
			return null;
		}
		$table->addIndex(['user_id'], 'sv_annot_user');
		return $schema;
	}
}
