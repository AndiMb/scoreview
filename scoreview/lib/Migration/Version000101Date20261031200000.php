<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Records which engine release rendered a conversion on the local path
 * (LocalConverter::engineVersion()), so that a newer engine reaches every
 * score by itself, the next time it is opened - see
 * ConversionService::isCurrent() and docs/architecture.md
 * "Konvertierung und Cache".
 *
 * Nullable and not backfilled: which engine rendered an existing row is not
 * known. A local row without it counts as rendered by an older engine and is
 * converted again once - which is what an update to this version should do
 * anyway, since nothing older carried the stamp.
 */
class Version000101Date20261031200000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('scoreview_conversions')) {
			return null;
		}
		$table = $schema->getTable('scoreview_conversions');
		if (!$table->hasColumn('engine_version')) {
			$table->addColumn('engine_version', Types::STRING, ['notnull' => false, 'length' => 64]);
		}

		return $schema;
	}
}
