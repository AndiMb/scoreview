<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Page and measure count of a conversion as columns. The status endpoint
 * answers every poll of a ready score with the page URLs, and the notes
 * mark measures beyond the end as orphaned; both decoded the whole
 * meta.json (up to 250 KB) for one number each time.
 *
 * Nullable: the repair step BackfillScoreCounts fills the existing rows from
 * their meta.json, and ConversionService still reads it for a row it has not
 * reached yet.
 */
class Version000102Date20261101120000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('scoreview_conversions')) {
			return null;
		}
		$table = $schema->getTable('scoreview_conversions');
		$changed = false;
		foreach (['page_count', 'measure_count'] as $column) {
			if (!$table->hasColumn($column)) {
				$table->addColumn($column, Types::INTEGER, ['notnull' => false]);
				$changed = true;
			}
		}

		return $changed ? $schema : null;
	}
}
