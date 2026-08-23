<?php

declare(strict_types=1);

namespace OCA\ScoreView\Settings;

use OCA\ScoreView\AppInfo\Application;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IConfig;
use OCP\Settings\ISettings;
use OCP\Util;

/**
 * Erscheint unter Einstellungen → Verwaltung. Schlichtes Server-Formular
 * (kein Vue) mit einem eigenen kleinen JS-Bundle fürs Speichern per fetch()
 * - ein Inline-<script> im Template würde an Nextclouds
 * Content-Security-Policy scheitern (kein Nonce für handgeschriebene
 * Inline-Scripts), siehe src/settings.js.
 */
class AdminSettings implements ISettings {
	public function __construct(
		private IConfig $config,
	) {
	}

	public function getForm(): TemplateResponse {
		Util::addScript(Application::APP_ID, Application::APP_ID . '-settings');
		return new TemplateResponse(Application::APP_ID, 'settings/admin', [
			'sidecarUrl' => $this->config->getAppValue(Application::APP_ID, 'sidecar_url', ''),
			'sidecarSecretSet' => $this->config->getAppValue(Application::APP_ID, 'sidecar_secret', '') !== '',
			'eagerConversion' => $this->config->getAppValue(Application::APP_ID, 'eager_conversion', '0') === '1',
			'soundFontUrl' => $this->config->getAppValue(Application::APP_ID, 'soundfont_url', ''),
		], TemplateResponse::RENDER_AS_BLANK);
	}

	public function getSection(): string {
		return Application::APP_ID;
	}

	public function getPriority(): int {
		return 50;
	}
}
