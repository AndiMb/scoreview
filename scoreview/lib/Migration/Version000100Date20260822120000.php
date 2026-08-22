<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Initiales Schema: ein Konvertierungsstatus je (file_id, etag).
 */
class Version000100Date20260822120000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('scoreview_conversions')) {
			$table = $schema->createTable('scoreview_conversions');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'length' => 20]);
			$table->addColumn('file_id', Types::BIGINT, ['notnull' => true, 'length' => 20]);
			$table->addColumn('etag', Types::STRING, ['notnull' => true, 'length' => 64]);
			// pending | processing | ready | error
			$table->addColumn('status', Types::STRING, ['notnull' => true, 'length' => 16]);
			$table->addColumn('error_message', Types::TEXT, ['notnull' => false]);
			$table->addColumn('created_at', Types::DATETIME, ['notnull' => true]);
			$table->addColumn('updated_at', Types::DATETIME, ['notnull' => true]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['file_id', 'etag'], 'sv_conv_file_etag');
		}

		return $schema;
	}
}
