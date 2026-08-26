<?php

declare(strict_types=1);

namespace OCA\ScoreView\Settings;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\SoundFontService;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IAppConfig;
use OCP\Settings\ISettings;
use OCP\Util;

/**
 * Erscheint unter Einstellungen → Verwaltung. Die Seite selbst ist eine
 * Vue-Komponente auf `@nextcloud/vue` (src/components/AdminSettings.vue);
 * dieses Template liefert nur noch den Mountpunkt und den Startzustand.
 *
 * Startzustand über `IInitialState` statt über Template-Variablen oder eine
 * eigene GET-Route: Nextcloud rendert ihn als `<input type="hidden">` in die
 * Seite, `@nextcloud/initial-state` liest ihn dort ab. Für vier Felder wäre
 * eine zusätzliche HTTP-Runde verschenkt.
 *
 * **Das Secret ist bewusst nicht Teil davon** - ausgeliefert wird nur, OB
 * eines gesetzt ist. Ein Wert, der als sensibel geführt wird (siehe
 * SettingsController und Migration\Version000100Date20260824100000), hat im
 * ausgelieferten HTML nichts verloren.
 */
class AdminSettings implements ISettings {
	public function __construct(
		private IAppConfig $appConfig,
		private IInitialState $initialState,
		private ConversionBackend $backend,
	) {
	}

	public function getForm(): TemplateResponse {
		$this->initialState->provideInitialState('admin-settings', [
			'conversionBackend' => $this->backend->current(),
			'nodePath' => $this->appConfig->getValueString(Application::APP_ID, 'node_path'),
			'soundFontFetchUrl' => $this->appConfig->getValueString(Application::APP_ID, SoundFontService::FETCH_URL_KEY),
			'sidecarUrl' => $this->appConfig->getValueString(Application::APP_ID, 'sidecar_url'),
			'sidecarSecretSet' => $this->appConfig->getValueString(Application::APP_ID, 'sidecar_secret') !== '',
			'eagerConversion' => $this->appConfig->getValueBool(Application::APP_ID, 'eager_conversion'),
			'soundFontUrl' => $this->appConfig->getValueString(Application::APP_ID, 'soundfont_url'),
		]);

		Util::addScript(Application::APP_ID, Application::APP_ID . '-settings');

		return new TemplateResponse(Application::APP_ID, 'settings/admin', [], TemplateResponse::RENDER_AS_BLANK);
	}

	public function getSection(): string {
		return Application::APP_ID;
	}

	public function getPriority(): int {
		return 50;
	}
}
