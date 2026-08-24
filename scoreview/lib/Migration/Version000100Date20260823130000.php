<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Private Notizen pro Nutzer, verankert an musikalischen statt an
 * Renderer-/Pixel-Koordinaten ("die zentrale Entscheidung ist der Anker,
 * nicht die UI").
 *
 * Anker-Design, warum diese Spalten:
 * - `measure_number` + `fraction` (0-1 innerhalb des Taktes): aus timeMs
 *   errechnet (siehe scoreLayout.js resolveMeasurePosition), nicht aus
 *   MuseScores internem Beat/Fraction-Modell - das exportiert
 *   `--score-media` nicht pro Note (nur x/y/Zeit, siehe M2/M4). Eine
 *   Position relativ zum Taktanfang ist trotzdem eine musikalische, keine
 *   Pixel-Koordinate, und übersteht ein Neurendern (Zoom, Seitenumbruch),
 *   solange sich Taktzahl/Metrum nicht ändern.
 * - `elid` + `anchor_etag`: exakter Sekundär-Anker, aber nur innerhalb
 *   desselben etags gültig - `elid`-Nummerierung ist nicht über etags
 *   hinweg stabil.
 * - Bewusst NICHT an `etag` gebunden (anders als `scoreview_conversions`):
 *   Notizen müssen einen Re-Upload überleben, der Cache-Eintrag nicht.
 * - `visibility`: 'private' | 'shared' - 'shared' heißt für jede Person mit
 *   Dateizugriff sichtbar, Schreibrecht daran hängt an `PERMISSION_UPDATE`
 *   der Datei (siehe AnnotationController::canWriteShared()).
 */
class Version000100Date20260823130000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('scoreview_annotations')) {
			$table = $schema->createTable('scoreview_annotations');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'length' => 20]);
			$table->addColumn('file_id', Types::BIGINT, ['notnull' => true, 'length' => 20]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('measure_number', Types::INTEGER, ['notnull' => true]);
			// 0.0-1.0, als Ganzzahl*10000 wäre praezisier plattformuebergreifend,
			// aber FLOAT reicht fuer eine UI-Anker-Naeherung.
			$table->addColumn('fraction', Types::FLOAT, ['notnull' => true, 'default' => 0]);
			$table->addColumn('elid', Types::INTEGER, ['notnull' => false]);
			$table->addColumn('anchor_etag', Types::STRING, ['notnull' => false, 'length' => 64]);
			// 'private' | 'shared' (letzteres erst spaeter genutzt, siehe oben).
			$table->addColumn('visibility', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'private']);
			$table->addColumn('content', Types::TEXT, ['notnull' => true]);
			$table->addColumn('created_at', Types::DATETIME, ['notnull' => true]);
			$table->addColumn('updated_at', Types::DATETIME, ['notnull' => true]);
			$table->setPrimaryKey(['id']);
			// Haeufigste Abfrage: alle eigenen Notizen zu einer Datei.
			$table->addIndex(['file_id', 'user_id'], 'sv_annot_file_user');
		}

		return $schema;
	}
}
