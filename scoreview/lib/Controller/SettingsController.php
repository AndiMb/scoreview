<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Settings\AdminSettings;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IConfig;
use OCP\IRequest;
use OCP\Settings\Attribute\AuthorizedAdminSetting;

class SettingsController extends Controller {
	public function __construct(
		IRequest $request,
		private IConfig $config,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[AuthorizedAdminSetting(settings: AdminSettings::class)]
	public function update(string $sidecarUrl, string $sidecarSecret): JSONResponse {
		$this->config->setAppValue(Application::APP_ID, 'sidecar_url', trim($sidecarUrl));
		// Leeres Feld = "unveraendert lassen", nicht "Secret loeschen" - ein
		// bereits gesetztes Secret wird im Formular nie im Klartext angezeigt
		// (siehe templates/settings/admin.php), ein leeres Absenden waere also
		// sonst ein versehentliches Loeschen bei jedem Speichern der URL.
		if (trim($sidecarSecret) !== '') {
			$this->config->setAppValue(Application::APP_ID, 'sidecar_secret', trim($sidecarSecret));
		}
		return new JSONResponse(['status' => 'ok']);
	}
}
