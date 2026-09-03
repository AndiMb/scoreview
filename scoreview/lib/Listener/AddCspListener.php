<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\ClientFallback;
use OCP\AppFramework\Http\EmptyContentSecurityPolicy;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IAppConfig;
use OCP\IRequest;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;

/**
 * @template-implements IEventListener<AddContentSecurityPolicyEvent>
 *
 * Ohne diese Lockerungen scheitert die Wiedergabe an Nextclouds strikter
 * Default-CSP (empirisch gegen echte Playwright-Laeufe gefunden, nicht
 * vermutet - 2026-08-23 fuer die Wiedergabe, 2026-09-03 fuer den Rueckfall
 * im Browser):
 *
 * - `wasm-unsafe-eval`: spessasynth_lib/spessasynth_core dekodiert Vorbis-
 *   Samples per WebAssembly (stb-vorbis) - `WebAssembly.instantiate()`
 *   scheitert an script-src ohne dieses Token, mit derselben Fehlermeldung
 *   wie bei `eval()` (Nextclouds nonce-basierte script-src erlaubt kein
 *   `unsafe-eval`; `wasm-unsafe-eval` ist die dafür vorgesehene, auf
 *   WebAssembly beschränkte Freigabe - kein generelles eval()).
 * - Der SoundFont-Host aus der Admin-Einstellung `soundfont_url` (siehe
 *   Settings\AdminSettings): Nextclouds Default-`connect-src 'self'`
 *   blockt sonst jeden fetch() zu einer extern konfigurierten URL. Ohne
 *   gesetzte Einstellung wird nichts gelockert - dann liefert die App das
 *   SoundFont selbst aus (Controller\SoundFontController), und `'self'`
 *   deckt das bereits ab.
 * - `blob:` in `worker-src` und `connect-src`, nur fuer den
 *   Konvertierungsweg im Browser (siehe unten). Beide Direktiven stehen auf
 *   der Files-Seite ohnehin schon mit `'self'` - hinzu kommt allein `blob:`.
 *
 * Der Viewer wird per Util::addScript in die Files-Seite eingehängt
 * (Listener\FilesLoadAdditionalScriptsListener) - er hat also keine eigene
 * Controller-Response, an der er seine CSP direkt setzen könnte. Genau für
 * diesen Fall ist AddContentSecurityPolicyEvent gedacht.
 *
 * **Reichweite, und warum hier ein Pfadvergleich steht.**
 * `AddContentSecurityPolicyEvent` ist kein Werkzeug für „diese eine
 * Seite": `OC\Security\CSP\ContentSecurityPolicyManager::getDefaultPolicy()`
 * dispatcht das Ereignis und merged jede registrierte Policy in die
 * Default-Policy **jeder** Response der Instanz. Ohne Eingrenzung trüge also
 * auch Talk, die Einstellungsseite und das Login-Formular
 * `wasm-unsafe-eval` in `script-src` - für eine Fähigkeit, die nur der
 * Notenviewer braucht.
 *
 * Eingrenzen lässt sich das nur am laufenden Request, denn die Policy wird
 * pro Request gebaut. Der Viewer wird ausschließlich über
 * `OCA\Files\Event\LoadAdditionalScriptsEvent` geladen, und dieses Ereignis
 * dispatcht in der Testinstanz (NC 34) einzig
 * `OCA\Files\Controller\ViewController` - nachgesehen, nicht angenommen -,
 * also genau auf `/apps/files/…`. Kommt der Request nicht von dort, kann auf
 * der Seite auch kein Notenbild stehen; die Lockerung wäre folgenlos, aber
 * wirksam.
 *
 * Ehrlich bleibt: das lockert weiterhin die **ganze Files-Seite**, nicht nur
 * den Viewer darin. Feiner geht es mit diesem Ereignis nicht - eine echte
 * Begrenzung auf den Viewer bräuchte eine eigene Controller-Response, also
 * einen anderen Einbindungsweg. Der Schritt von „die gesamte Instanz" auf
 * „eine App" ist trotzdem der weitaus größere Teil des Weges.
 */
class AddCspListener implements IEventListener {
	/**
	 * Pfadpraefix der Files-App. `getPathInfo()` liefert den Pfad hinter
	 * `index.php` bzw. hinter dem Webroot, also z.B. `/apps/files/files/42`.
	 */
	private const FILES_PATH_PREFIX = '/apps/files';

	public function __construct(
		private IAppConfig $appConfig,
		private ClientFallback $clientFallback,
		private IRequest $request,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof AddContentSecurityPolicyEvent) {
			return;
		}
		if (!$this->isFilesPageRequest()) {
			return;
		}

		$policy = new EmptyContentSecurityPolicy();
		$policy->allowEvalWasm(true);

		// Fuer den Konvertierungsweg im Browser - den Rueckfall, wo der Server
		// nicht konvertieren kann. Zwei Lockerungen, beide durch die Engine
		// erzwungen und keine davon frei gewaehlt:
		//
		// - `worker-src blob:`: Die scoreview-engine startet ihren Web Worker aus
		//   einer Blob-URL. Ohne die Freigabe scheitert das STILL - gemessen am
		//   2026-09-03: `new Worker(blob:…)` wirft nicht, es kommt allein eine
		//   securitypolicyviolation, waehrend die Konvertierung fuer immer auf
		//   die Antwort des nie gestarteten Workers wartet.
		// - `connect-src blob:`: Die fertigen Artefakte reicht der Viewer als
		//   Blob-URLs an dieselben axios-Aufrufe weiter, die sonst Serverrouten
		//   holen (ScorePage.vue, usePlayback.js). Genau dadurch braucht der
		//   Rueckfall keine Zeile im Viewer.
		//
		// Nur wo der Rueckfall ueberhaupt greifen kann: Auf einer Instanz mit
		// funktionierendem Serverweg bleibt die CSP unveraendert. Das Urteil
		// ist gespeichert und kostet hier nur einen Konfigurationszugriff
		// (Service\ClientFallback) - dieser Listener laeuft bei JEDEM Aufruf
		// der Files-Seite.
		//
		// Der Preis dieser Reihenfolge: Faellt der Sidecar aus, waehrend die
		// Seite schon offen ist, traegt DIESES Dokument die enge CSP noch -
		// der Rueckfall greift erst beim naechsten Laden. Das ist der Grund,
		// warum die Konvertierung im Browser eine eigene Zeitgrenze braucht:
		// Ein blockierter Worker meldet sich nicht, er schweigt.
		if ($this->clientFallback->applies()) {
			// 'self' steht auf der Files-Seite schon in der Default-Policy
			// (nachgemessen); es steht hier trotzdem, damit diese Policy fuer sich
			// vollstaendig ist: Waere `worker-src` je NUR das hier Gesetzte, faellt
			// ohne 'self' der Rueckfall auf `script-src` weg, und mit ihm jeder
			// gleichherkuenftige Worker der Seite. Zusammengefuehrt werden die
			// Policies als Vereinigung, doppelt schadet also nicht.
			$policy->addAllowedWorkerSrcDomain("'self'");
			$policy->addAllowedWorkerSrcDomain('blob:');
			$policy->addAllowedConnectDomain('blob:');
		}

		$soundFontUrl = $this->appConfig->getValueString(Application::APP_ID, 'soundfont_url');
		$origin = $this->originOf($soundFontUrl);
		if ($origin !== null) {
			$policy->addAllowedConnectDomain($origin);
		}

		$event->addPolicy($policy);
	}

	private function isFilesPageRequest(): bool {
		try {
			$path = $this->request->getPathInfo();
		} catch (\Throwable) {
			// getPathInfo() wirft bei einer nicht dekodierbaren URL. Dann ist
			// dies sicher keine regulaere Files-Seite - im Zweifel NICHT
			// lockern.
			return false;
		}
		if (!is_string($path)) {
			return false;
		}
		// Exakt `/apps/files` oder alles darunter - aber nicht
		// `/apps/files_sharing` oder `/apps/files_external`, die den Viewer
		// nicht laden.
		return $path === self::FILES_PATH_PREFIX
			|| str_starts_with($path, self::FILES_PATH_PREFIX . '/');
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
