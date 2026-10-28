<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Practice log (docs/architecture.md E20) and parts for leader recordings
 * (E21).
 *
 * - `scoreview_practice_log`: one row per person, score and day with the
 *   seconds practised. A day, not a session: what the viewer shows is "this
 *   week" and "days in a row", and a row per playback would grow with every
 *   press of play. The day is the singer's local calendar day as the browser
 *   sends it - "today" at 23:30 is a matter of the clock on the wall, not of
 *   the server's time zone. The unique index makes adding to a day an
 *   upsert (Service\PracticeLogService::add()).
 * - `scoreview_practice_goals`: one weekly goal per score, set by a leader.
 * - `scoreview_recordings.shared_parts`: a leader's recording released to
 *   parts, JSON `[{id, name}]` like an annotation's target parts; null keeps
 *   it private (S8).
 */
class Version000100Date20261027120000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$changed = false;

		if (!$schema->hasTable('scoreview_practice_log')) {
			$table = $schema->createTable('scoreview_practice_log');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('file_id', Types::BIGINT, ['notnull' => true]);
			$table->addColumn('day', Types::STRING, ['notnull' => true, 'length' => 10]);
			$table->addColumn('seconds', Types::INTEGER, ['notnull' => true, 'default' => 0]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['user_id', 'file_id', 'day'], 'scoreview_plog_uniq');
			$table->addIndex(['file_id'], 'scoreview_plog_file');
			$changed = true;
		}

		if (!$schema->hasTable('scoreview_practice_goals')) {
			$table = $schema->createTable('scoreview_practice_goals');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$table->addColumn('file_id', Types::BIGINT, ['notnull' => true]);
			$table->addColumn('minutes_per_week', Types::INTEGER, ['notnull' => true]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('updated_at', Types::DATETIME, ['notnull' => true]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['file_id'], 'scoreview_pgoal_file');
			$changed = true;
		}

		if ($schema->hasTable('scoreview_recordings')) {
			$table = $schema->getTable('scoreview_recordings');
			if (!$table->hasColumn('shared_parts')) {
				$table->addColumn('shared_parts', Types::TEXT, ['notnull' => false]);
				$changed = true;
			}
		}

		return $changed ? $schema : null;
	}
}
