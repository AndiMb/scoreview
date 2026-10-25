<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * The reference pitch a recording was sung against. Without it, a recording
 * made at a' = 442 would be judged 8 cents sharp once the setting goes back
 * to 440 - the evaluation is computed afresh from the WAV each time
 * (src/composables/useIntonation.js). Recordings from before this column
 * were all made at 440, so that is the default.
 */
class Version000100Date20261025120000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->hasTable('scoreview_recordings')) {
			return null;
		}
		$table = $schema->getTable('scoreview_recordings');
		if ($table->hasColumn('reference_hz')) {
			return null;
		}
		$table->addColumn('reference_hz', Types::INTEGER, ['notnull' => true, 'default' => 440]);
		return $schema;
	}
}
