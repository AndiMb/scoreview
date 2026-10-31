<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Sung runs (docs/architecture.md E24): one row per scored run of one's own
 * part - only the summary, no frames and no audio. The unit of a run is a
 * range of measures, not a saved loop: a loop is a note that can be renamed
 * or deleted, and the best score of measures 5-12 should outlive it.
 * `from_measure` and `to_measure` both null mean the whole piece.
 */
class Version000100Date20261031120000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if ($schema->hasTable('scoreview_sing_runs')) {
			return null;
		}
		$table = $schema->createTable('scoreview_sing_runs');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
		$table->addColumn('file_id', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('from_measure', Types::INTEGER, ['notnull' => false]);
		$table->addColumn('to_measure', Types::INTEGER, ['notnull' => false]);
		$table->addColumn('level', Types::STRING, ['notnull' => true, 'length' => 8]);
		$table->addColumn('tempo_pct', Types::INTEGER, ['notnull' => true]);
		$table->addColumn('total_pct', Types::INTEGER, ['notnull' => true]);
		$table->addColumn('pitch_pct', Types::INTEGER, ['notnull' => false]);
		$table->addColumn('onset_pct', Types::INTEGER, ['notnull' => false]);
		$table->addColumn('release_pct', Types::INTEGER, ['notnull' => false]);
		$table->addColumn('notes_scored', Types::INTEGER, ['notnull' => true]);
		$table->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
		$table->setPrimaryKey(['id']);
		$table->addIndex(['user_id', 'file_id', 'level'], 'scoreview_sing_unit');
		$table->addIndex(['file_id'], 'scoreview_sing_file');
		return $schema;
	}
}
