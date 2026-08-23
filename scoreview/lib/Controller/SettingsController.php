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
	public function update(string $sidecarUrl, string $sidecarSecret, bool $eagerConversion = false, string $soundFontUrl = ''): JSONResponse {
		$this->config->setAppValue(Application::APP_ID, 'sidecar_url', trim($sidecarUrl));
		// Leeres Feld = "unveraendert lassen", nicht "Secret loeschen" - ein
		// bereits gesetztes Secret wird im Formular nie im Klartext angezeigt
		// (siehe templates/settings/admin.php), ein leeres Absenden waere also
		// sonst ein versehentliches Loeschen bei jedem Speichern der URL.
		if (trim($sidecarSecret) !== '') {
			$this->config->setAppValue(Application::APP_ID, 'sidecar_secret', trim($sidecarSecret));
		}
		// Default 'aus' (siehe Listener\ScoreFileListener - Phase 7): jeder
		// Upload sofort konvertieren ist die Ausnahme, kein Standardverhalten.
		$this->config->setAppValue(Application::APP_ID, 'eager_conversion', $eagerConversion ? '1' : '0');
		// Bewusst eine externe URL statt eines mitgelieferten Binaries (E1,
		// Phase 9): welches SoundFont ausgeliefert wird und wie es gehostet
		// wird, ist eine Lizenz-/Betriebsentscheidung des Betreibers, keine
		// Entscheidung, die im App-Code vorweggenommen werden sollte. Leer =
		// keine echte Wiedergabe, ScoreViewer.vue faellt sichtbar auf den
		// stummen Phase-8-Cursor-Modus zurueck (siehe ScoreViewer.vue).
		$this->config->setAppValue(Application::APP_ID, 'soundfont_url', trim($soundFontUrl));
		return new JSONResponse(['status' => 'ok']);
	}
}
