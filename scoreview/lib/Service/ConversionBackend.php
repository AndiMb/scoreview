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
 * Voreinstellung ist der lokale Weg, und zwar aus einem einzigen Grund: Er
 * ist der einzige, der nach `app:enable` schon fertig ist. Alles, was er
 * braucht, liegt im App-Paket, und die Node-Laufzeit findet er selbst. Der
 * Sidecar setzt dagegen einen zweiten Container UND eine eingetragene URL
 * voraus - als Voreinstellung hiesse er "nach der Installation passiert
 * erstmal gar nichts", und zwar ohne dass der Oberflaeche anzusehen waere,
 * warum.
 *
 * Dass ein Update trotzdem keine laufende Installation umstellt, sorgt
 * Migration\Version000100Date20260903120000: Wer einen Sidecar eingerichtet
 * hat, bekommt den bisher nur impliziten Wert einmalig ausdruecklich
 * eingetragen.
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
		$value = $this->appConfig->getValueString(Application::APP_ID, self::CONFIG_KEY, self::LOCAL);
		return $value === self::SIDECAR ? self::SIDECAR : self::LOCAL;
	}

	public function isLocal(): bool {
		return $this->current() === self::LOCAL;
	}

	/**
	 * Fuer SettingsController: alles ausser 'sidecar' bedeutet lokal, nie ein
	 * ungueltiger Zustand. Die Richtung folgt der Voreinstellung oben - ein
	 * unbrauchbarer Wert soll auf demselben Weg landen wie ein fehlender,
	 * sonst hinge der Betrieb an einem Tippfehler.
	 */
	public static function normalize(string $value): string {
		return $value === self::SIDECAR ? self::SIDECAR : self::LOCAL;
	}
}
