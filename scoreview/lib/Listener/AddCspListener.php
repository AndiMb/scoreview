<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\ScoreView\AppInfo\Application;
use OCP\AppFramework\Http\EmptyContentSecurityPolicy;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IConfig;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;

/**
 * @template-implements IEventListener<AddContentSecurityPolicyEvent>
 *
 * Ohne diese beiden Lockerungen scheitert die Phase-9-Wiedergabe an
 * Nextclouds strikter Default-CSP (empirisch am 2026-08-23 gegen einen
 * echten Playwright-Lauf gefunden, nicht vermutet):
 *
 * - `wasm-unsafe-eval`: spessasynth_lib/spessasynth_core dekodiert Vorbis-
 *   Samples per WebAssembly (stb-vorbis) - `WebAssembly.instantiate()`
 *   scheitert an script-src ohne dieses Token, mit derselben Fehlermeldung
 *   wie bei `eval()` (Nextclouds nonce-basierte script-src erlaubt kein
 *   `unsafe-eval`; `wasm-unsafe-eval` ist die dafür vorgesehene, auf
 *   WebAssembly beschränkte Freigabe - kein generelles eval()).
 * - Der SoundFont-Host aus der Admin-Einstellung `soundfont_url` (Phase 9,
 *   siehe Settings\AdminSettings): Nextclouds Default-`connect-src 'self'`
 *   blockt sonst jeden fetch() zu einer extern konfigurierten URL. Ohne
 *   gesetzte Einstellung wird nichts gelockert - dann liefert die App das
 *   SoundFont selbst aus (Controller\SoundFontController), und `'self'`
 *   deckt das bereits ab.
 *
 * Der Viewer wird per Util::addScript in die Files-Seite eingehängt
 * (Listener\FilesLoadAdditionalScriptsListener) - er hat also keine eigene
 * Controller-Response, an der er seine CSP direkt setzen könnte. Genau für
 * diesen Fall ist AddContentSecurityPolicyEvent gedacht.
 */
class AddCspListener implements IEventListener {
	public function __construct(
		private IConfig $config,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof AddContentSecurityPolicyEvent) {
			return;
		}

		$policy = new EmptyContentSecurityPolicy();
		$policy->allowEvalWasm(true);

		$soundFontUrl = $this->config->getAppValue(Application::APP_ID, 'soundfont_url', '');
		$origin = $this->originOf($soundFontUrl);
		if ($origin !== null) {
			$policy->addAllowedConnectDomain($origin);
		}

		$event->addPolicy($policy);
	}

	private function originOf(string $url): ?string {
		$parts = parse_url($url);
		if (!isset($parts['scheme'], $parts['host'])) {
			return null;
		}
		$port = isset($parts['port']) ? ':' . $parts['port'] : '';
		return "{$parts['scheme']}://{$parts['host']}{$port}";
	}
}
