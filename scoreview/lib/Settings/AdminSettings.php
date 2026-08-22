<?php

declare(strict_types=1);

namespace OCA\ScoreView\Settings;

use OCA\ScoreView\AppInfo\Application;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IConfig;
use OCP\Settings\ISettings;

/**
 * Erscheint unter Einstellungen → Verwaltung. Reine Server-Formular-Seite
 * ohne eigenes Vue-Bundle - für zwei Textfelder (Sidecar-URL, Secret) lohnt
 * sich im Prototyp kein zweiter Webpack-Entry.
 */
class AdminSettings implements ISettings {
	public function __construct(
		private IConfig $config,
	) {
	}

	public function getForm(): TemplateResponse {
		return new TemplateResponse(Application::APP_ID, 'settings/admin', [
			'sidecarUrl' => $this->config->getAppValue(Application::APP_ID, 'sidecar_url', ''),
			'sidecarSecretSet' => $this->config->getAppValue(Application::APP_ID, 'sidecar_secret', '') !== '',
		], TemplateResponse::RENDER_AS_BLANK);
	}

	public function getSection(): string {
		return Application::APP_ID;
	}

	public function getPriority(): int {
		return 50;
	}
}
