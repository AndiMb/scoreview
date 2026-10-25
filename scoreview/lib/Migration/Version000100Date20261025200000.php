<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use Closure;
use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\ConversionBackend;
use OCP\IAppConfig;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Keeps MuseScore as the sidecar's renderer where a sidecar is already set
 * up, before the default becomes the engine (Service\ConversionBackend::
 * sidecarRenderer()).
 *
 * The same reasoning as Version000100Date20260903120000: a default applies
 * only to a missing key, and an installation that has run a sidecar so far
 * never had a choice to write down. Its image predates the engine renderer -
 * asked for the engine, it would go on converting with MuseScore while the
 * viewer offered display variants that then fail. The admin switches to the
 * engine once the image is rebuilt; the self-test says whether it has been.
 *
 * Recognised by a configured `sidecar_url`. A fresh installation has none and
 * gets the engine.
 *
 * No schema change, hence only `postSchemaChange`.
 */
class Version000100Date20261025200000 extends SimpleMigrationStep {
	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		if ($this->appConfig->hasKey(Application::APP_ID, ConversionBackend::SIDECAR_RENDERER_KEY)) {
			return;
		}
		if (trim($this->appConfig->getValueString(Application::APP_ID, 'sidecar_url')) === '') {
			return;
		}
		$this->appConfig->setValueString(Application::APP_ID, ConversionBackend::SIDECAR_RENDERER_KEY, ConversionBackend::RENDERER_MUSESCORE);
		$output->info('ScoreView: the sidecar keeps converting with MuseScore. Rebuild its image and choose the engine in the admin settings for display variants.');
	}
}
