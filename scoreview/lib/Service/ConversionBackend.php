<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCP\IAppConfig;

/**
 * Welcher der beiden Konvertierungswege gilt - siehe docs/architecture.md E3.
 *
 * Beide liefern dieselben Artefakte in denselben IAppData-Cache und stehen
 * hinter derselben HTTP-API der App; das Frontend erfaehrt nie, welcher
 * gelaufen ist. Genau deshalb ist die Wahl eine einzelne
 * Admin-Einstellung und keine Verzweigung, die sich durch die App zieht.
 *
 * Voreinstellung ist der Sidecar: Er kommt ohne Voraussetzungen auf dem
 * Nextcloud-Server aus, und ein Update darf eine laufende Installation nicht
 * stillschweigend auf den anderen Weg umstellen.
 */
class ConversionBackend {
	public const SIDECAR = 'sidecar';
	public const LOCAL = 'local';

	public const CONFIG_KEY = 'conversion_backend';

	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	public function current(): string {
		$value = $this->appConfig->getValueString(Application::APP_ID, self::CONFIG_KEY, self::SIDECAR);
		return $value === self::LOCAL ? self::LOCAL : self::SIDECAR;
	}

	public function isLocal(): bool {
		return $this->current() === self::LOCAL;
	}

	/** Fuer SettingsController: alles ausser 'local' bedeutet Sidecar, nie ein ungueltiger Zustand. */
	public static function normalize(string $value): string {
		return $value === self::LOCAL ? self::LOCAL : self::SIDECAR;
	}
}
