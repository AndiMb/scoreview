<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Saved loops (B5) as a third kind of annotation: a loop is a note with an
 * end measure. One more nullable column on the note table instead of a
 * table of its own, because a loop wants exactly what a note has - the
 * musical anchor that survives a re-upload, the three visibilities with
 * part-addressed ones for leaders, the per-person limit, the one place to
 * delete. `end_measure` is null for text notes and stamps.
 */
class Version000100Date20261017120000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->hasTable('scoreview_annotations')) {
			return null;
		}
		$table = $schema->getTable('scoreview_annotations');
		if ($table->hasColumn('end_measure')) {
			return null;
		}
		$table->addColumn('end_measure', Types::INTEGER, ['notnull' => false]);
		return $schema;
	}
}
