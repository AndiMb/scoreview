<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Display variants (docs/architecture.md E19): one row per engraved variant
 * of a score version. The unique index is also the lock of a run - two
 * requests for the same variant at once give one insert and one conflict,
 * and the second waits for the first (Service\VariantService::claim()).
 */
class Version000100Date20261025180000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if ($schema->hasTable('scoreview_variants')) {
			return null;
		}
		$table = $schema->createTable('scoreview_variants');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('file_id', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('etag', Types::STRING, ['notnull' => true, 'length' => 40]);
		$table->addColumn('variant', Types::STRING, ['notnull' => true, 'length' => 64]);
		$table->addColumn('status', Types::STRING, ['notnull' => true, 'length' => 16]);
		$table->addColumn('error_code', Types::STRING, ['notnull' => false, 'length' => 32]);
		$table->addColumn('error_message', Types::STRING, ['notnull' => false, 'length' => 1024]);
		$table->addColumn('format_version', Types::INTEGER, ['notnull' => false]);
		$table->addColumn('engine', Types::STRING, ['notnull' => false, 'length' => 64]);
		$table->addColumn('page_count', Types::INTEGER, ['notnull' => false]);
		$table->addColumn('created_at', Types::DATETIME, ['notnull' => true]);
		$table->addColumn('updated_at', Types::DATETIME, ['notnull' => true]);
		$table->addColumn('accessed_at', Types::DATETIME, ['notnull' => false]);
		$table->setPrimaryKey(['id']);
		$table->addUniqueIndex(['file_id', 'etag', 'variant'], 'scoreview_var_uniq');
		$table->addIndex(['file_id'], 'scoreview_var_file');
		return $schema;
	}
}
