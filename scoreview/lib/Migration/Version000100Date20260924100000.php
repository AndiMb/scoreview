<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Das Schema fuer Probe und Konzert in EINEM Schritt: Leitungsrolle,
 * "Folgt mir", eigene Aufnahmen und die Erweiterung der Notizen um Stempel
 * und Stimmnotizen.
 *
 * Eine Migration statt einer je Funktion, weil die Funktionen gemeinsam
 * ausgeliefert werden: Getrennte Schritte haetten nur Zeitstempel, die sich
 * zwischen parallel entwickelten Zweigen ueberholen koennen.
 *
 * Alle Tabellen haengen an der fileId, nicht am etag - wie die Notizen
 * muessen Leitung und Aufnahmen einen Re-Upload ueberleben. Aufgeraeumt wird
 * erst, wenn die Datei auch aus dem Papierkorb verschwunden ist
 * (BackgroundJob\CleanupOrphansJob), und beim Loeschen eines Kontos
 * (Listener\UserDeletedListener).
 *
 * BOOLEAN-Spalten sind nullable: Nextcloud verlangt das, weil Oracle ein
 * NOT NULL auf Booleans nicht mit dem Wert false vertraegt.
 */
class Version000100Date20260924100000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		// Leitungen je Partitur. Die Eigentuemerin steht bewusst NICHT hier -
		// sie wird bei jeder Pruefung aus dem Dateibaum bestimmt und laesst sich
		// so gar nicht abberufen.
		if (!$schema->hasTable('scoreview_leaders')) {
			$table = $schema->createTable('scoreview_leaders');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'length' => 20]);
			$table->addColumn('file_id', Types::BIGINT, ['notnull' => true, 'length' => 20]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('appointed_by', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('created_at', Types::DATETIME, ['notnull' => true]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['file_id', 'user_id'], 'sv_lead_file_user');
			// Fuer das Loeschen eines Kontos - der eindeutige Index oben beginnt
			// mit file_id und hilft dort nicht.
			$table->addIndex(['user_id'], 'sv_lead_user');
		}

		// Eine Zeile je Datei = hoechstens eine laufende Sitzung. Ein
		// Zustand mit Zaehlern statt eines Ereignisstroms: Nachzuegler bekommen
		// den letzten Stand, nichts wird nachgespielt.
		if (!$schema->hasTable('scoreview_follow')) {
			$table = $schema->createTable('scoreview_follow');
			$table->addColumn('file_id', Types::BIGINT, ['notnull' => true, 'length' => 20]);
			$table->addColumn('leader_uid', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('started_at', Types::DATETIME, ['notnull' => true]);
			$table->addColumn('heartbeat_at', Types::DATETIME, ['notnull' => true]);
			$table->addColumn('version', Types::INTEGER, ['notnull' => true, 'default' => 0]);
			$table->addColumn('state', Types::TEXT, ['notnull' => false]);
			$table->setPrimaryKey(['file_id']);
			$table->addIndex(['leader_uid'], 'sv_follow_leader');
		}

		// Nur die Metadaten - die WAV selbst liegt in IAppData unter
		// recordings/<uid>/<fileId>/<id>.wav, nicht in Files (nur die
		// Aufnehmende hoert sie).
		if (!$schema->hasTable('scoreview_recordings')) {
			$table = $schema->createTable('scoreview_recordings');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'length' => 20]);
			$table->addColumn('file_id', Types::BIGINT, ['notnull' => true, 'length' => 20]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('created_at', Types::DATETIME, ['notnull' => true]);
			$table->addColumn('duration_ms', Types::INTEGER, ['notnull' => true, 'default' => 0]);
			$table->addColumn('size_bytes', Types::INTEGER, ['notnull' => true, 'default' => 0]);
			// Partiturzeit des ersten Samples, schon um Aus- und Eingangslatenz
			// korrigiert.
			$table->addColumn('score_start_ms', Types::INTEGER, ['notnull' => true, 'default' => 0]);
			$table->addColumn('tempo_factor', Types::FLOAT, ['notnull' => true, 'default' => 1]);
			$table->addColumn('with_accompaniment', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
			$table->setPrimaryKey(['id']);
			$table->addIndex(['file_id', 'user_id'], 'sv_rec_file_user');
			$table->addIndex(['user_id'], 'sv_rec_user');
		}

		// Stempel und Stimmnotizen. Die Vorgaben halten jede bestehende Notiz
		// unveraendert: eine Textnotiz ohne Zielstimme, nicht von einer
		// Leitung - genau das, was sie vor dieser Migration war.
		if ($schema->hasTable('scoreview_annotations')) {
			$table = $schema->getTable('scoreview_annotations');
			if (!$table->hasColumn('kind')) {
				// 'text' | 'stamp'
				$table->addColumn('kind', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'text']);
			}
			if (!$table->hasColumn('stamp')) {
				// Code aus einer festen Liste (breath, caesura, pp … ff, …)
				$table->addColumn('stamp', Types::STRING, ['notnull' => false, 'length' => 32]);
			}
			if (!$table->hasColumn('target_parts')) {
				// JSON [{id, name}] - die Stimme doppelt, weil nicht belegt ist,
				// dass MuseScores Part-ID einen Re-Upload uebersteht.
				$table->addColumn('target_parts', Types::TEXT, ['notnull' => false]);
			}
			if (!$table->hasColumn('by_leader')) {
				// Beim Anlegen festgehalten, nicht nachtraeglich ausgewertet: Eine
				// abberufene Leitung behaelt ihre Hinweise.
				$table->addColumn('by_leader', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
			}
		}

		return $schema;
	}
}
