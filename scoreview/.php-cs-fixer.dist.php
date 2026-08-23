<?php

declare(strict_types=1);

/**
 * PHP-Codingstandard nach Nextcloud-Vorgabe (Codereview Phase 23/Schritt 2,
 * Befund C5). Bis hierher lief die Pruefung nur ueber `php -l` und einen
 * echten Durchlauf gegen die Testinstanz - Formatierung war reine Disziplin,
 * wie auf der JS-Seite vor ESLint.
 *
 * `src` ist ausgenommen: dort liegt ausschliesslich Frontend-Code, dafuer ist
 * ESLint zustaendig (siehe eslint.config.mjs).
 */

require_once __DIR__ . '/vendor/autoload.php';

use Nextcloud\CodingStandard\Config;

$config = new Config();
$config
	->getFinder()
	->ignoreVCSIgnored(true)
	->notPath('build')
	->notPath('js')
	->notPath('l10n')
	->notPath('node_modules')
	->notPath('src')
	->notPath('vendor')
	->in(__DIR__);

return $config;
