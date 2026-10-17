<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Title and composer in the Nextcloud search (D1, E17): three columns on
 * the conversion table. `title` and `composer` are for showing a hit,
 * `search_text` is what is searched - title, subtitle, composer and lyricist
 * in lower case, so that one LIKE finds them on every database (PostgreSQL
 * compares case-sensitively).
 *
 * No index: `LIKE '%…%'` would not use one, and the table has one row per
 * score. Filled by ConversionService::markReady() from meta.json, for the
 * scores converted before this column by the repair step BackfillSearchText.
 */
class Version000100Date20261017180000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->hasTable('scoreview_conversions')) {
			return null;
		}
		$table = $schema->getTable('scoreview_conversions');
		$changed = false;
		foreach (['title' => 255, 'composer' => 255, 'search_text' => 1024] as $column => $length) {
			if (!$table->hasColumn($column)) {
				$table->addColumn($column, Types::STRING, ['notnull' => false, 'length' => $length]);
				$changed = true;
			}
		}
		return $changed ? $schema : null;
	}
}
