<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\HealthService;
use OCA\ScoreView\Service\SidecarClient;
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
		private HealthService $healthService,
		private SidecarClient $sidecarClient,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * Betriebsdiagnose fuer die Admin-Seite (Phase 21): Sidecar erreichbar,
	 * SoundFont vorhanden, Cron am Laufen, Konvertierungsstand. Bewusst
	 * lesend und ohne Seiteneffekt - der eigentliche Selbsttest (der eine
	 * echte Konvertierung startet) sitzt getrennt in selfTest().
	 */
	#[AuthorizedAdminSetting(settings: AdminSettings::class)]
	public function health(): JSONResponse {
		return new JSONResponse($this->healthService->collect());
	}

	/**
	 * Startet den Sidecar-Selbsttest (Phase 21, MuseScore-Versionspflege):
	 * eine echte Konvertierung der mitgelieferten Minipartitur, geprueft auf
	 * die Zusagen aus M2/M4/M7. Getrennt von health(), weil er ~8s dauert
	 * und eine Konvertierung ausloest - das soll nur passieren, wenn jemand
	 * es ausdruecklich anstoesst.
	 */
	#[AuthorizedAdminSetting(settings: AdminSettings::class)]
	public function selfTest(): JSONResponse {
		return new JSONResponse($this->sidecarClient->runSelfTest());
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
