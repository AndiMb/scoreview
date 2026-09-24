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
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IAppConfig;
use OCP\IGroupManager;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IUserSession;
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
		private IUserSession $userSession,
		private IGroupManager $groupManager,
		private IL10N $l,
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

	/**
	 * Speichert das Admin-Formular.
	 *
	 * **Nicht jedes Feld darf jede Person aendern, die hierher kommt.**
	 * `#[AuthorizedAdminSetting]` laesst auch delegierte Admins zu - eine
	 * Rolle fuer "darf die ScoreView-Einstellungen pflegen". Drei Felder
	 * reichen aber weiter als ScoreView: `node_path` wird per proc_open
	 * ausgefuehrt (Service\LocalConverter), Sidecar-URL und SoundFont-Quelle
	 * sind Adressen, die der SERVER abruft - der Sidecar sogar mit dem Secret
	 * im Header. Wer sie setzt, startet Programme als Webserver-Nutzer bzw.
	 * laesst den Server beliebige Adressen abfragen (SSRF). Das bleibt den
	 * vollen Admins vorbehalten, wie jede andere Aenderung, die Code
	 * ausfuehrt (siehe refusePrivileged()).
	 *
	 * Alles wird VOR dem ersten Schreiben geprueft: Eine abgelehnte Anfrage
	 * aendert nichts, statt die Haelfte des Formulars zu speichern.
	 */
	#[AuthorizedAdminSetting(settings: AdminSettings::class)]
	public function update(
		?string $sidecarUrl = null,
		?string $sidecarSecret = null,
		?bool $eagerConversion = null,
		?string $soundFontUrl = null,
		?string $conversionBackend = null,
		?string $nodePath = null,
		?string $soundFontFetchUrl = null,
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
		// Leer = automatisch suchen (siehe Service\LocalConverter), nicht
		// "kein node".
		$nodePath = $nodePath === null ? null : trim($nodePath);
		$sidecarUrl = $sidecarUrl === null ? null : trim($sidecarUrl);
		$soundFontFetchUrl = $soundFontFetchUrl === null ? null : trim($soundFontFetchUrl);
		// Leeres Feld = "unveraendert lassen", nicht "Secret loeschen" - ein
		// bereits gesetztes Secret wird im Formular nie im Klartext angezeigt
		// (siehe src/components/AdminSettings.vue), ein leeres Absenden waere
		// also sonst ein versehentliches Loeschen bei jedem Speichern der URL.
		$sidecarSecret = $sidecarSecret === null || trim($sidecarSecret) === '' ? null : trim($sidecarSecret);

		$refused = $this->refusePrivileged($nodePath, $sidecarUrl, $soundFontFetchUrl, $sidecarSecret)
			?? $this->refuseInvalid($nodePath, $sidecarUrl, $soundFontFetchUrl);
		if ($refused !== null) {
			return $refused;
		}

		// Fehlt das Feld, bleibt der Weg, wie er ist: Jede Vorgabe an dieser
		// Stelle schaltete bei einem POST ohne das Feld still auf einen Weg
		// um, den niemand gewaehlt hat - und wiche womoeglich noch von der
		// Voreinstellung in ConversionBackend ab. Ueber normalize(), damit ein unbekannter
		// Wert nicht als dritter, nirgends behandelter Zustand in der
		// Konfiguration landet.
		if ($conversionBackend !== null) {
			$this->appConfig->setValueString(Application::APP_ID, ConversionBackend::CONFIG_KEY, ConversionBackend::normalize($conversionBackend));
		}
		if ($nodePath !== null) {
			$this->appConfig->setValueString(Application::APP_ID, 'node_path', $nodePath);
		}
		// Serverseitige SoundFont-Quelle - der Weg zu Ton ohne Sidecar
		// (Service\SoundFontService). Nicht zu verwechseln mit
		// `soundfont_url` weiter unten, die den Browser direkt laden laesst.
		if ($soundFontFetchUrl !== null) {
			$this->appConfig->setValueString(Application::APP_ID, SoundFontService::FETCH_URL_KEY, $soundFontFetchUrl);
		}
		if ($sidecarUrl !== null) {
			$this->appConfig->setValueString(Application::APP_ID, 'sidecar_url', $sidecarUrl);
		}
		if ($sidecarSecret !== null) {
			// `sensitive: true` blendet den Wert in `occ config:app:list`, im
			// Support-Bericht und in Systemreports aus - also genau in den
			// Ausgaben, die man beim Fehlersuchen weitergibt. Fuer bereits
			// gesetzte Secrets wirkt das Flag beim Schreiben allein nicht mehr
			// (siehe IAppConfig::setValueString), deshalb zieht die Migration
			// Version000100Date20260824100000 es fuer Bestandsinstallationen
			// einmalig nach.
			$this->appConfig->setValueString(Application::APP_ID, 'sidecar_secret', $sidecarSecret, sensitive: true);
		}
		// Default 'aus' (siehe Listener\ScoreFileListener): jeder
		// Upload sofort konvertieren ist die Ausnahme, kein Standardverhalten.
		// Die Vorgabe gilt beim Lesen; ein POST ohne das Feld laesst den
		// gespeicherten Wert stehen, statt ihn still auf "aus" zu setzen.
		if ($eagerConversion !== null) {
			$this->appConfig->setValueBool(Application::APP_ID, 'eager_conversion', $eagerConversion);
		}
		// Uebersteuerung, nicht Voraussetzung: leer heisst NICHT "kein Ton",
		// sondern "die App liefert das SoundFont selbst aus, das der ohnehin
		// vorausgesetzte Sidecar mitbringt" (Service\SoundFontService,
		// Controller\ConversionController::soundFontUrl()). Gefuellt
		// wird das Feld nur, wer ein anderes/besseres SoundFont selbst hostet;
		// dessen Host muss dann per HTTP(S) erreichbar sein und CORS erlauben
		// (und wird von Listener\AddCspListener in connect-src freigegeben).
		// Fehlt das Feld, bleibt die Uebersteuerung - wie bei den Feldern oben.
		if ($soundFontUrl !== null) {
			$this->appConfig->setValueString(Application::APP_ID, 'soundfont_url', trim($soundFontUrl));
		}
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

	/**
	 * Ob die anfragende Person volle Admin ist, nicht nur fuer diese Seite
	 * delegiert. Auch fuer den Startzustand der Seite (Settings\AdminSettings),
	 * damit das Formular sperren kann, was der Server ohnehin ablehnt.
	 */
	public static function isFullAdmin(IUserSession $userSession, IGroupManager $groupManager): bool {
		$user = $userSession->getUser();
		return $user !== null && $groupManager->isAdmin($user->getUID());
	}

	/**
	 * Lehnt eine Aenderung der Felder ab, die Programme starten oder den
	 * Server Adressen abrufen lassen - es sei denn, eine volle Admin fragt.
	 *
	 * **Abgelehnt wird nur eine AENDERUNG**, nicht das Mitsenden: Das Formular
	 * schickt immer alle Felder, auch die, die eine delegierte Admin gar nicht
	 * anfassen will. Ein 403 fuer jedes Speichern der Aufnahmegrenzen machte
	 * die Delegation wertlos; ein stilles Ignorieren liesse eine gewollte
	 * Aenderung als "gespeichert" erscheinen, die nie ankam. Also: gleich wie
	 * gespeichert - durch; anders - 403 mit Nennung der Felder, und nichts
	 * wird geschrieben.
	 */
	private function refusePrivileged(?string $nodePath, ?string $sidecarUrl, ?string $soundFontFetchUrl, ?string $sidecarSecret): ?JSONResponse {
		if (self::isFullAdmin($this->userSession, $this->groupManager)) {
			return null;
		}
		$fields = [];
		foreach ([
			'nodePath' => [$nodePath, 'node_path'],
			'sidecarUrl' => [$sidecarUrl, 'sidecar_url'],
			'soundFontFetchUrl' => [$soundFontFetchUrl, SoundFontService::FETCH_URL_KEY],
		] as $field => [$value, $key]) {
			if ($value !== null && $value !== $this->stored($key)) {
				$fields[] = $field;
			}
		}
		// Ein Secret wird nie zurueckgeliefert, ein Vergleich waere also nur
		// ein Orakel dafuer, ob man es erraten hat - jedes Setzen zaehlt.
		if ($sidecarSecret !== null) {
			$fields[] = 'sidecarSecret';
		}
		if ($fields === []) {
			return null;
		}
		return new JSONResponse([
			'error' => $this->l->t('Only administrators can change the Node.js path, the conversion service and the SoundFont source.'),
			'reason' => 'admin_only',
			'fields' => $fields,
		], Http::STATUS_FORBIDDEN);
	}

	/**
	 * Prueft die Werte, die ausgefuehrt bzw. abgerufen werden - auch fuer
	 * volle Admins: Ein Tippfehler soll hier auffallen, nicht erst als
	 * "kein node gefunden" in der Diagnose.
	 *
	 * Geprueft wird nur, was sich AENDERT. Ein Wert, der per `occ` gesetzt
	 * wurde und diesen Regeln nicht folgt, soll nicht jedes Speichern des
	 * Formulars scheitern lassen.
	 */
	private function refuseInvalid(?string $nodePath, ?string $sidecarUrl, ?string $soundFontFetchUrl): ?JSONResponse {
		if ($nodePath !== null && $nodePath !== $this->stored('node_path') && !self::isValidNodePath($nodePath)) {
			return new JSONResponse([
				'error' => $this->l->t('The Node.js path must be empty or an absolute path to a program named node or nodejs.'),
				'reason' => 'invalid_node_path',
				'fields' => ['nodePath'],
			], Http::STATUS_BAD_REQUEST);
		}
		$fields = [];
		foreach ([
			'sidecarUrl' => [$sidecarUrl, 'sidecar_url'],
			'soundFontFetchUrl' => [$soundFontFetchUrl, SoundFontService::FETCH_URL_KEY],
		] as $field => [$value, $key]) {
			if ($value !== null && $value !== $this->stored($key) && !self::isValidServerUrl($value)) {
				$fields[] = $field;
			}
		}
		if ($fields !== []) {
			return new JSONResponse([
				'error' => $this->l->t('Addresses for the conversion service and the SoundFont source must start with http:// or https://.'),
				'reason' => 'invalid_url',
				'fields' => $fields,
			], Http::STATUS_BAD_REQUEST);
		}
		return null;
	}

	private function stored(string $key): string {
		return $this->appConfig->getValueString(Application::APP_ID, $key);
	}

	/**
	 * Leer (automatisch suchen) oder ein absoluter Pfad zu einem Programm, das
	 * nach node heisst.
	 *
	 * Der Basisname ist die eigentliche Grenze: Er macht aus "beliebiges
	 * Programm starten" ein "ein node starten" - `/bin/sh` oder ein Skript im
	 * Datenverzeichnis fallen heraus. Zugelassen sind die Namen, unter denen
	 * Distributionen node ausliefern (`nodejs` bei aelteren Debian-Staenden,
	 * `node20`/`node-20` bei parallel installierten Versionen). Absolut, weil
	 * ein relativer Pfad vom Arbeitsverzeichnis des Kindprozesses abhinge -
	 * dem Konverterordner -, und der nackte Name `node` ohnehin die
	 * automatische Suche ist. Steuerzeichen haben in einem Pfad nichts
	 * verloren und landeten sonst im Log und in der Diagnose.
	 */
	public static function isValidNodePath(string $path): bool {
		if ($path === '') {
			return true;
		}
		if (preg_match('/[\x00-\x1f\x7f]/', $path) === 1) {
			return false;
		}
		$absolute = str_starts_with($path, '/') || preg_match('#^[A-Za-z]:[\\\\/]#', $path) === 1;
		$base = basename(str_replace('\\', '/', $path));
		return $absolute && preg_match('/^(node|nodejs)(-?\d+)?(\.exe)?$/iD', $base) === 1;
	}

	/**
	 * Leer oder eine http(s)-Adresse mit Host. Andere Schemata (`file://`,
	 * `gopher://`, `php://`) oeffnen Wege, die ein Konvertierungsdienst nie
	 * braucht.
	 */
	public static function isValidServerUrl(string $url): bool {
		if ($url === '') {
			return true;
		}
		if (preg_match('/[\x00-\x20\x7f]/', $url) === 1) {
			return false;
		}
		$parts = parse_url($url);
		return is_array($parts)
			&& in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true)
			&& ($parts['host'] ?? '') !== '';
	}
}
