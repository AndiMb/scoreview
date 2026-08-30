<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Haelt fest, welcher Konvertierungsweg eine Darstellung erzeugt hat.
 *
 * Nur so ist die Frage "womit ist das gesetzt worden?" spaeter noch
 * beantwortbar: Die Admin-Einstellung `conversion_backend` sagt, was JETZT
 * gilt, nicht, was beim Konvertieren dieser Datei galt - nach einem Wechsel
 * waere jede Anzeige daraus schlicht falsch. Die MuseScore-Version steht
 * ohnehin schon in `meta.json` (`mscoreVersion`), sie braucht keine Spalte.
 *
 * Nullable und ohne Vorbelegung: Bestandsdatensaetze wurden vor dieser
 * Spalte geschrieben, und ein nachtraeglich eingetragener Weg waere eine
 * Vermutung im Gewand einer Tatsache. Der Viewer zeigt fuer sie "unbekannt"
 * an; mit der naechsten Konvertierung fuellt sich die Spalte von selbst.
 * Bewusst KEINE Erhoehung der `format_version` - die wuerde jede
 * vorhandene Partitur neu konvertieren lassen, und das waere fuer eine
 * Herkunftsangabe unverhaeltnismaessig.
 */
class Version000100Date20260830120000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('scoreview_conversions')) {
			return null;
		}
		$table = $schema->getTable('scoreview_conversions');
		if (!$table->hasColumn('backend')) {
			// sidecar | local | NULL (vor dieser Migration konvertiert)
			$table->addColumn('backend', Types::STRING, ['notnull' => false, 'length' => 16]);
		}

		return $schema;
	}
}
