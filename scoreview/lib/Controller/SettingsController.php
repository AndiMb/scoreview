<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\HealthService;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\SidecarClient;
use OCA\ScoreView\Service\SoundFontService;
use OCA\ScoreView\Settings\AdminSettings;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IAppConfig;
use OCP\IRequest;
use OCP\Settings\Attribute\AuthorizedAdminSetting;

class SettingsController extends Controller {
	public function __construct(
		IRequest $request,
		private IAppConfig $appConfig,
		private HealthService $healthService,
		private ConversionBackend $backend,
		private SidecarClient $sidecarClient,
		private LocalConverter $localConverter,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * Betriebsdiagnose fuer die Admin-Seite: Sidecar erreichbar,
	 * SoundFont vorhanden, Cron am Laufen, Konvertierungsstand. Bewusst
	 * lesend und ohne Seiteneffekt - der eigentliche Selbsttest (der eine
	 * echte Konvertierung startet) sitzt getrennt in selfTest().
	 */
	#[AuthorizedAdminSetting(settings: AdminSettings::class)]
	public function health(): JSONResponse {
		return new JSONResponse($this->healthService->collect());
	}

	/**
	 * Startet den Selbsttest des AKTIVEN Konvertierungswegs
	 * (MuseScore-Versionspflege): eine echte Konvertierung der mitgelieferten
	 * Minipartitur, geprueft auf die Zusagen aus M2/M4/M7. Getrennt von
	 * health(), weil er eine Konvertierung ausloest - das soll nur passieren,
	 * wenn jemand es ausdruecklich anstoesst.
	 *
	 * Beide Wege antworten in derselben Form (`ok`, `problems`, `details`),
	 * die Oberflaeche muss den Unterschied also nicht kennen.
	 */
	#[AuthorizedAdminSetting(settings: AdminSettings::class)]
	public function selfTest(): JSONResponse {
		$result = $this->backend->isLocal()
			? $this->localConverter->runSelfTest()
			: $this->sidecarClient->runSelfTest();
		return new JSONResponse($result + ['backend' => $this->backend->current()]);
	}

	#[AuthorizedAdminSetting(settings: AdminSettings::class)]
	public function update(
		string $sidecarUrl,
		string $sidecarSecret,
		bool $eagerConversion = false,
		string $soundFontUrl = '',
		string $conversionBackend = ConversionBackend::SIDECAR,
		string $nodePath = '',
		string $soundFontFetchUrl = '',
	): JSONResponse {
		// Ueber normalize(), damit ein unbekannter Wert nicht als dritter,
		// nirgends behandelter Zustand in der Konfiguration landet.
		$this->appConfig->setValueString(Application::APP_ID, ConversionBackend::CONFIG_KEY, ConversionBackend::normalize($conversionBackend));
		// Leer = automatisch suchen (siehe Service\LocalConverter), nicht
		// "kein node".
		$this->appConfig->setValueString(Application::APP_ID, 'node_path', trim($nodePath));
		// Serverseitige SoundFont-Quelle - der Weg zu Ton ohne Sidecar
		// (Service\SoundFontService). Nicht zu verwechseln mit
		// `soundfont_url` weiter unten, die den Browser direkt laden laesst.
		$this->appConfig->setValueString(Application::APP_ID, SoundFontService::FETCH_URL_KEY, trim($soundFontFetchUrl));
		$this->appConfig->setValueString(Application::APP_ID, 'sidecar_url', trim($sidecarUrl));
		// Leeres Feld = "unveraendert lassen", nicht "Secret loeschen" - ein
		// bereits gesetztes Secret wird im Formular nie im Klartext angezeigt
		// (siehe src/components/AdminSettings.vue), ein leeres Absenden waere
		// also sonst ein versehentliches Loeschen bei jedem Speichern der URL.
		if (trim($sidecarSecret) !== '') {
			// `sensitive: true` blendet den Wert in `occ config:app:list`, im
			// Support-Bericht und in Systemreports aus - also genau in den
			// Ausgaben, die man beim Fehlersuchen weitergibt. Fuer bereits
			// gesetzte Secrets wirkt das Flag beim Schreiben allein nicht mehr
			// (siehe IAppConfig::setValueString), deshalb zieht die Migration
			// Version000100Date20260824100000 es fuer Bestandsinstallationen
			// einmalig nach.
			$this->appConfig->setValueString(Application::APP_ID, 'sidecar_secret', trim($sidecarSecret), sensitive: true);
		}
		// Default 'aus' (siehe Listener\ScoreFileListener): jeder
		// Upload sofort konvertieren ist die Ausnahme, kein Standardverhalten.
		$this->appConfig->setValueBool(Application::APP_ID, 'eager_conversion', $eagerConversion);
		// Uebersteuerung, nicht Voraussetzung: leer heisst NICHT "kein Ton",
		// sondern "die App liefert das SoundFont selbst aus, das der ohnehin
		// vorausgesetzte Sidecar mitbringt" (Service\SoundFontService,
		// Controller\ConversionController::soundFontUrl()). Gefuellt
		// wird das Feld nur, wer ein anderes/besseres SoundFont selbst hostet;
		// dessen Host muss dann per HTTP(S) erreichbar sein und CORS erlauben
		// (und wird von Listener\AddCspListener in connect-src freigegeben).
		$this->appConfig->setValueString(Application::APP_ID, 'soundfont_url', trim($soundFontUrl));
		return new JSONResponse(['status' => 'ok']);
	}
}
