<?php

declare(strict_types=1);

namespace OCA\ScoreView\Settings;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Controller\SettingsController;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\ConversionConfig;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\SoundFontService;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IAppConfig;
use OCP\IGroupManager;
use OCP\IUserSession;
use OCP\Settings\IDelegatedSettings;
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
class AdminSettings implements IDelegatedSettings {
	private const MB = 1024 * 1024;

	public function __construct(
		private IAppConfig $appConfig,
		private IInitialState $initialState,
		private ConversionBackend $backend,
		private FeatureConfig $features,
		private IUserSession $userSession,
		private IGroupManager $groupManager,
	) {
	}

	public function getForm(): TemplateResponse {
		$this->initialState->provideInitialState('admin-settings', [
			'conversionBackend' => $this->backend->current(),
			'sidecarRenderer' => $this->backend->sidecarRenderer(),
			// Delegierte Admins sehen diese Seite auch, duerfen aber node-Pfad,
			// Sidecar (URL, Secret) und SoundFont-Quelle nicht aendern - das
			// startet Programme bzw. laesst den Server Adressen abrufen (siehe
			// SettingsController::update). Das Formular sperrt die Felder
			// danach, statt erst beim Speichern ein 403 zu zeigen.
			'fullAdmin' => SettingsController::isFullAdmin($this->userSession, $this->groupManager),
			'nodePath' => $this->appConfig->getValueString(Application::APP_ID, ConversionConfig::NODE_PATH),
			'soundFontFetchUrl' => $this->appConfig->getValueString(Application::APP_ID, SoundFontService::FETCH_URL_KEY),
			// Roh aus der Konfiguration oben, die Vorbelegung getrennt daneben:
			// Als Platzhalter zeigt sie, was ein leeres Feld bedeutet, ohne
			// sich beim Speichern als eingetragener Wert auszugeben.
			'soundFontFetchUrlDefault' => SoundFontService::DEFAULT_FETCH_URL,
			'sidecarUrl' => $this->appConfig->getValueString(Application::APP_ID, ConversionConfig::SIDECAR_URL),
			'sidecarSecretSet' => $this->appConfig->getValueString(Application::APP_ID, ConversionConfig::SIDECAR_SECRET) !== '',
			'eagerConversion' => $this->appConfig->getValueBool(Application::APP_ID, 'eager_conversion'),
			'soundFontUrl' => $this->appConfig->getValueString(Application::APP_ID, ConversionConfig::SOUNDFONT_URL),
			'featureFollowSession' => $this->features->isEnabled(FeatureConfig::FOLLOW_SESSION),
			'featureRecording' => $this->features->isEnabled(FeatureConfig::RECORDING),
			'featureIntonation' => $this->features->isEnabled(FeatureConfig::INTONATION),
			'featureScoreFollower' => $this->features->isEnabled(FeatureConfig::SCORE_FOLLOWER),
			'featurePracticeExport' => $this->features->isEnabled(FeatureConfig::PRACTICE_EXPORT),
			'featureOffline' => $this->features->isEnabled(FeatureConfig::OFFLINE),
			'featurePracticeLog' => $this->features->isEnabled(FeatureConfig::PRACTICE_LOG),
			'featureSingScore' => $this->features->isEnabled(FeatureConfig::SING_SCORE),
			'practiceTrackMaxMb' => self::limit(FeatureConfig::PRACTICE_TRACK_MAX_MB, intdiv($this->features->practiceTrackMaxBytes(), self::MB), 1),
			'pdfMaxMb' => self::limit(FeatureConfig::PDF_MAX_MB, intdiv($this->features->pdfMaxBytes(), self::MB), 1),
			'followPollMs' => $this->features->followPollMs(),
			// Grenzen aus derselben Quelle wie die Pruefung beim Speichern -
			// das Zahlenfeld soll nicht anbieten, was der Server danach klemmt.
			'followPollMsMin' => FeatureConfig::NUMBERS[FeatureConfig::FOLLOW_POLL_MS][1],
			'followPollMsMax' => FeatureConfig::NUMBERS[FeatureConfig::FOLLOW_POLL_MS][2],
			'followPollMsDefault' => FeatureConfig::NUMBERS[FeatureConfig::FOLLOW_POLL_MS][0],
			// Die Grenzen der Aufnahmen (S5), der Speicher in MB statt
			// in Bytes - die Einheit, in der ein Mensch darueber nachdenkt.
			'recordingLimits' => [
				'maxRecordingsPerScore' => self::limit(FeatureConfig::MAX_RECORDINGS_PER_SCORE, $this->features->maxRecordingsPerScore(), 1),
				'maxRecordingSeconds' => self::limit(FeatureConfig::MAX_RECORDING_SECONDS, $this->features->maxRecordingSeconds(), 1),
				'maxRecordingMbPerUser' => self::limit(FeatureConfig::MAX_RECORDING_BYTES_PER_USER, $this->features->maxRecordingBytesPerUser(), self::MB),
				'maxRecordingMbTotal' => self::limit(FeatureConfig::MAX_RECORDING_BYTES_TOTAL, $this->features->maxRecordingBytesTotal(), self::MB),
			],
		]);

		Util::addScript(Application::APP_ID, Application::APP_ID . '-settings');

		return new TemplateResponse(Application::APP_ID, 'settings/admin', [], TemplateResponse::RENDER_AS_BLANK);
	}

	/**
	 * Wert und Grenzen eines Zahlenwerts in der Einheit des Formulars.
	 *
	 * @return array{value: int, min: int, max: int, default: int}
	 */
	private static function limit(string $key, int $value, int $unit): array {
		[$default, $min, $max] = FeatureConfig::NUMBERS[$key];
		return [
			'value' => intdiv($value, $unit),
			'min' => intdiv($min, $unit),
			'max' => intdiv($max, $unit),
			'default' => intdiv($default, $unit),
		];
	}

	public function getSection(): string {
		return Application::APP_ID;
	}

	public function getPriority(): int {
		return 50;
	}

	/**
	 * IDelegatedSettings is what makes this form selectable under
	 * Administration privileges - without it #[AuthorizedAdminSetting] on
	 * SettingsController only ever admits full admins and the S9 handling
	 * for delegated admins can never take effect.
	 */
	public function getName(): ?string {
		// One form per section: the section name says it all.
		return null;
	}

	/**
	 * No app config keys through core's provisioning API: every write goes
	 * through SettingsController, which validates the values and keeps the
	 * privileged keys (node path, sidecar, SoundFont source) for full admins
	 * (S9). Opening core's generic setter would bypass both.
	 *
	 * @return array<string, list<string>>
	 */
	public function getAuthorizedAppConfig(): array {
		return [];
	}
}
