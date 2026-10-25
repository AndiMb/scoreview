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
 * hat, bekommt den sonst nur impliziten Wert einmalig ausdruecklich
 * eingetragen.
 */
class ConversionBackend {
	public const SIDECAR = 'sidecar';
	public const LOCAL = 'local';

	public const CONFIG_KEY = 'conversion_backend';

	/**
	 * What the sidecar converts with (E3): the scoreview-engine - the same
	 * converter as the local path, so the same artifacts down to the segment
	 * ids (M10) and the display variants (E19) - or MuseScore itself, which
	 * keeps the original music fonts of old scores and draws SVG images.
	 * Sent with every job; the sidecar does not decide it.
	 */
	public const SIDECAR_RENDERER_KEY = 'sidecar_renderer';
	public const RENDERER_ENGINE = 'engine';
	public const RENDERER_MUSESCORE = 'musescore';

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
	 * The sidecar's renderer. The default is the engine; an installation that
	 * already ran a sidecar before the choice existed has `musescore` written
	 * down explicitly (Migration\Version000100Date20261025200000), so an
	 * update does not change what its image is asked to do.
	 */
	public function sidecarRenderer(): string {
		return self::normalizeRenderer($this->appConfig->getValueString(Application::APP_ID, self::SIDECAR_RENDERER_KEY, self::RENDERER_ENGINE));
	}

	/**
	 * Can the server engrave display variants (E19)? Wherever the engine
	 * converts: on the local path, and on the sidecar when it runs the
	 * engine. Stock MuseScore writes neither the segment ids (M10) nor the
	 * mappings back to the score that a variant needs. A capability, not a
	 * path - the viewer gets this as `variants.supported` and never asks
	 * which path ran (E15).
	 */
	public function supportsVariants(): bool {
		return $this->isLocal() || $this->sidecarRenderer() === self::RENDERER_ENGINE;
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

	/** Anything but 'musescore' is the engine - the default, as above. */
	public static function normalizeRenderer(string $value): string {
		return $value === self::RENDERER_MUSESCORE ? self::RENDERER_MUSESCORE : self::RENDERER_ENGINE;
	}
}
