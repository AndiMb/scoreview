<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCA\ScoreView\Service\ConversionService;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Zwei Spalten auf `scoreview_conversions`, aus zwei getrennten Anlaessen,
 * aber in einer Migration ("reist in derselben Migration mit").
 *
 * - `error_code`: `error_message` wird einmal beim Konvertieren geschrieben,
 *   aber von beliebigen Nutzerinnen in beliebigen Sprachen gelesen - IL10N
 *   (an die Sprache der GERADE ANFRAGENDEN Person gebunden) waere dafuer die
 *   falsche Stelle. Der Code wird stattdessen erst beim Anzeigen uebersetzt
 *   (siehe ScoreViewer.vue errorCodeText()); `error_message` bleibt
 *   unveraendert als technisches Detail bestehen. Nullable und ohne
 *   Backfill: bestehende Fehlerdatensaetze vor dieser Migration haben
 *   keinen Code, der Client behandelt einen fehlenden Code als 'unknown'.
 * - `format_version`: schliesst die Luecke "Cache-Format-Upgrade nicht
 *   migriert" - ein Formatwechsel liess `status()`/`serveCachedFile()` beim
 *   Lesen einer inzwischen nicht mehr passenden Cache-Datei mit 500 statt
 *   einer Neukonvertierung enden. Default = ConversionService::CURRENT_FORMAT_VERSION:
 *   das baut die Spalte rueckwirkend fuer alle schon vorhandenen Zeilen ein,
 *   die bereits im aktuellen Format vorliegen - kein ungewollter
 *   Massen-Reconvert direkt nach dem Upgrade. Erst ein KUENFTIGER
 *   Formatwechsel erhoeht die Konstante und macht aeltere Zeilen dadurch
 *   erkennbar veraltet.
 */
class Version000100Date20260823140000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		$table = $schema->getTable('scoreview_conversions');
		if (!$table->hasColumn('error_code')) {
			$table->addColumn('error_code', Types::STRING, ['notnull' => false, 'length' => 32]);
		}
		if (!$table->hasColumn('format_version')) {
			$table->addColumn('format_version', Types::INTEGER, [
				'notnull' => true,
				'default' => ConversionService::CURRENT_FORMAT_VERSION,
			]);
		}

		return $schema;
	}
}
