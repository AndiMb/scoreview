<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\ClientFallback;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\HealthService;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\PushNotifier;
use OCA\ScoreView\Service\SidecarClient;
use OCA\ScoreView\Service\SoundFontService;
use OCA\ScoreView\Settings\AdminSettings;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IAppConfig;
use OCP\IRequest;
use OCP\Settings\Attribute\AuthorizedAdminSetting;

class SettingsController extends Controller {
	/**
	 * Ab so vielen Folgegeraeten raet die Diagnose zu `notify_push`: Bei 20
	 * Geraeten und 800 ms sind es gemessen rund 1,5 Kerne - darueber
	 * wird es auf einem kleinen Server spuerbar.
	 */
	public const RECOMMEND_PUSH_FROM_DEVICES = 20;

	private const MB = 1024 * 1024;

	public function __construct(
		IRequest $request,
		private IAppConfig $appConfig,
		private HealthService $healthService,
		private ConversionBackend $backend,
		private SidecarClient $sidecarClient,
		private LocalConverter $localConverter,
		private ClientFallback $clientFallback,
		private FeatureConfig $features,
		private PushNotifier $push,
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
		return new JSONResponse($this->healthService->collect() + ['follow' => $this->followStatus()]);
	}

	/**
	 * „Folgt mir" ohne Push fragt alle `pollMs` ab - gemessen etwa
	 * 50 ms CPU je Geraet und Abfrage, bei 40 Geraeten rund drei Kerne fuer
	 * die Dauer der Probe. Das soll die Administration sehen, bevor es der
	 * Server spuert: ob `notify_push` greift, und ab wie vielen Geraeten sich
	 * die Installation lohnt (E10). Die Empfehlung selbst formuliert
	 * die Oberflaeche.
	 *
	 * @return array{enabled: bool, pushAvailable: bool, pollMs: int, recommendPushFromDevices: int}
	 */
	private function followStatus(): array {
		return [
			'enabled' => $this->features->isEnabled(FeatureConfig::FOLLOW_SESSION),
			'pushAvailable' => $this->push->isAvailable(),
			'pollMs' => $this->features->followPollMs(),
			'recommendPushFromDevices' => self::RECOMMEND_PUSH_FROM_DEVICES,
		];
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
		// Ein Selbsttest ist die genaueste Auskunft darueber, ob der Server
		// konvertieren kann - also das gespeicherte Urteil verwerfen und beim
		// naechsten Mal frisch fragen, statt bis zu fuenf Minuten auf einer
		// veralteten Antwort sitzen zu bleiben.
		$this->clientFallback->forget();
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
		?bool $featureFollowSession = null,
		?bool $featureRecording = null,
		?bool $featureIntonation = null,
		?bool $featureScoreFollower = null,
		?int $followPollMs = null,
		?int $maxRecordingsPerScore = null,
		?int $maxRecordingSeconds = null,
		?int $maxRecordingMbPerUser = null,
		?int $maxRecordingMbTotal = null,
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
		// Konvertierungsweg, node-Pfad, Sidecar-URL - jede dieser Zeilen kann
		// aus "kann nicht" ein "kann" gemacht haben. Das gespeicherte Urteil
		// waere sonst bis zu fuenf Minuten alt, und der Betreiber saehe seine
		// gerade eingetragene Reparatur nicht wirken (Service\ClientFallback).
		$this->clientFallback->forget();

		// Fehlt ein Feld (ein Formular aus einer aelteren Version), bleibt
		// der Wert, wie er ist - ein Speichern der Sidecar-URL soll nicht
		// nebenbei eine Funktion abschalten.
		foreach ([
			FeatureConfig::FOLLOW_SESSION => $featureFollowSession,
			FeatureConfig::RECORDING => $featureRecording,
			FeatureConfig::INTONATION => $featureIntonation,
			FeatureConfig::SCORE_FOLLOWER => $featureScoreFollower,
		] as $switch => $enabled) {
			if ($enabled !== null) {
				$this->features->setEnabled($switch, $enabled);
			}
		}
		// Begrenzt statt abgelehnt: Die Antwort traegt den gespeicherten
		// Wert, die Oberflaeche zeigt ihn danach an. Eine 400 fuer „200 ms"
		// wuerde nur das ganze Formular scheitern lassen.
		$pollMs = $followPollMs === null
			? $this->features->followPollMs()
			: $this->features->setNumber(FeatureConfig::FOLLOW_POLL_MS, $followPollMs);

		// Die Grenzen der Aufnahmen (S5) nach derselben Regel. Der
		// Speicher kommt als MB aus dem Formular und liegt als Bytes in der
		// Konfiguration - dieselbe Einheit wie size_bytes in der Tabelle und
		// wie ein `occ config:app:set`, das niemand erst umrechnen soll.
		$recordingLimits = [];
		foreach ([
			'maxRecordingsPerScore' => [FeatureConfig::MAX_RECORDINGS_PER_SCORE, $maxRecordingsPerScore, 1],
			'maxRecordingSeconds' => [FeatureConfig::MAX_RECORDING_SECONDS, $maxRecordingSeconds, 1],
			'maxRecordingMbPerUser' => [FeatureConfig::MAX_RECORDING_BYTES_PER_USER, $maxRecordingMbPerUser, self::MB],
			'maxRecordingMbTotal' => [FeatureConfig::MAX_RECORDING_BYTES_TOTAL, $maxRecordingMbTotal, self::MB],
		] as $field => [$key, $value, $unit]) {
			$stored = $value === null
				? $this->features->number($key)
				: $this->features->setNumber($key, $value * $unit);
			$recordingLimits[$field] = intdiv($stored, $unit);
		}

		return new JSONResponse(['status' => 'ok', 'followPollMs' => $pollMs] + $recordingLimits);
	}
}
