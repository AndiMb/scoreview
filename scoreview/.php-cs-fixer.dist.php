<?php

declare(strict_types=1);

/**
 * PHP-Codingstandard nach Nextcloud-Vorgabe. Ergaenzt `php -l` und den
 * echten Durchlauf gegen die Testinstanz um automatisierte Formatpruefung -
 * analog zu ESLint auf der JS-Seite.
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
