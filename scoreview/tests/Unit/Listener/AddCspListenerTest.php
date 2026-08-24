<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Listener;

use OCA\ScoreView\Listener\AddCspListener;
use OCP\AppFramework\Http\EmptyContentSecurityPolicy;
use OCP\IAppConfig;
use OCP\IRequest;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;
use PHPUnit\Framework\TestCase;

/**
 * Die CSP-Lockerung ist die Stelle mit der groessten Reichweite im ganzen
 * Backend: was dieser Listener hinzufuegt, landet in der Default-Policy
 * JEDER Response der Instanz (siehe Codereview-Befund A1). Deshalb Tests
 * darauf, bevor Schritt 4 die Reichweite eingrenzt - sie halten fest, was
 * heute gilt, und schlagen an, falls die Eingrenzung dabei zu viel wegnimmt.
 *
 * Geprueft wird die gebaute Policy-Zeichenkette, nicht der interne Zustand:
 * das ist das, was am Ende tatsaechlich als Header rausgeht.
 */
class AddCspListenerTest extends TestCase {
	/** Gebaute Policy fuer einen Files-Seiten-Request (der Normalfall). */
	private function policyFor(string $soundFontUrl): string {
		$captured = $this->runListener($soundFontUrl, '/apps/files/files/42');
		$this->assertInstanceOf(EmptyContentSecurityPolicy::class, $captured);
		return $captured->buildPolicy();
	}

	/**
	 * @param string|\Throwable $pathInfo Pfad des laufenden Requests, oder eine
	 *                                    Ausnahme, die getPathInfo() werfen soll
	 * @return ?EmptyContentSecurityPolicy null, wenn der Listener gar keine
	 *                                     Policy hinzugefuegt hat
	 */
	private function runListener(string $soundFontUrl, string|\Throwable $pathInfo): ?EmptyContentSecurityPolicy {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')
			->with('scoreview', 'soundfont_url')
			->willReturn($soundFontUrl);

		$request = $this->createMock(IRequest::class);
		if ($pathInfo instanceof \Throwable) {
			$request->method('getPathInfo')->willThrowException($pathInfo);
		} else {
			$request->method('getPathInfo')->willReturn($pathInfo);
		}

		$captured = null;
		$event = $this->createMock(AddContentSecurityPolicyEvent::class);
		$event->method('addPolicy')->willReturnCallback(
			function (EmptyContentSecurityPolicy $csp) use (&$captured): void {
				$captured = $csp;
			},
		);

		(new AddCspListener($appConfig, $request))->handle($event);

		return $captured;
	}

	public function testErlaubtWasmAuchOhneKonfiguriertesSoundFont(): void {
		// spessasynth_lib dekodiert Vorbis-Samples per WebAssembly; ohne
		// wasm-unsafe-eval scheitert jede Wiedergabe an Nextclouds
		// Default-CSP (Phase 9, empirisch gefunden).
		$this->assertStringContainsString("'wasm-unsafe-eval'", $this->policyFor(''));
	}

	public function testOhneSoundFontUrlWirdKeineFremdeAdresseFreigegeben(): void {
		// Der Auslieferungszustand: die App liefert das SoundFont selbst aus,
		// 'self' deckt das ab. Es darf nichts Fremdes dazukommen.
		$policy = $this->policyFor('');
		$this->assertStringNotContainsString('connect-src', $policy);
	}

	public function testGibtNurDenUrsprungDerSoundFontUrlFrei(): void {
		// Nur scheme://host[:port] - nicht der Pfad, und nicht der ganze Host
		// ohne Schema.
		$policy = $this->policyFor('https://cdn.example.org/fonts/MuseScore_General.sf3');

		$this->assertStringContainsString('connect-src', $policy);
		$this->assertStringContainsString('https://cdn.example.org', $policy);
		$this->assertStringNotContainsString('/fonts/', $policy);
	}

	public function testNimmtDenPortMit(): void {
		$this->assertStringContainsString(
			'http://sound.example.org:8080',
			$this->policyFor('http://sound.example.org:8080/gm.sf3'),
		);
	}

	public function testIgnoriertUnbrauchbareEingaben(): void {
		// Eine Admin-Einstellung ohne Schema ist keine Adresse, aus der sich
		// ein Ursprung ableiten laesst - dann lieber gar nichts freigeben als
		// etwas Falsches (originOf() liefert null).
		foreach (['nicht-mal-eine-url', '/nur/ein/pfad', 'cdn.example.org/gm.sf3', ' '] as $eingabe) {
			$this->assertStringNotContainsString(
				'connect-src',
				$this->policyFor($eingabe),
				"Eingabe: '{$eingabe}'",
			);
		}
	}

	public function testIgnoriertAndereEreignisse(): void {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects($this->never())->method('getValueString');

		(new AddCspListener($appConfig, $this->createMock(IRequest::class)))
			->handle(new \OCP\EventDispatcher\Event());

		$this->addToAssertionCount(1);
	}

	// --- Reichweite (Befund A1) ----------------------------------------------

	/**
	 * Der Kern der Eingrenzung: ausserhalb der Files-App darf GAR KEINE Policy
	 * dazukommen. Wuerde hier eine gesetzt, traege sie instanzweit - das war
	 * genau der Befund.
	 *
	 * @dataProvider fremdePfade
	 */
	public function testLockertNichtsAusserhalbDerFilesApp(string $pfad): void {
		$this->assertNull(
			$this->runListener('https://cdn.example.org/gm.sf3', $pfad),
			"Pfad '{$pfad}' haette keine CSP-Lockerung bekommen duerfen",
		);
	}

	/** @return array<string, array{string}> */
	public static function fremdePfade(): array {
		return [
			'Login' => ['/login'],
			'Dashboard' => ['/apps/dashboard/'],
			'Einstellungen' => ['/settings/admin/scoreview'],
			'Talk' => ['/apps/spreed/'],
			// Praefix-Falle: diese Apps beginnen mit "/apps/files", laden den
			// Viewer aber nicht.
			'files_sharing' => ['/apps/files_sharing/publicpreview/abc'],
			'files_external' => ['/apps/files_external/globalstorages'],
			'oeffentlicher Share' => ['/s/aBcDeF'],
			'Wurzel' => ['/'],
			'leer' => [''],
		];
	}

	/**
	 * @dataProvider filesPfade
	 */
	public function testLockertAufFilesSeiten(string $pfad): void {
		$policy = $this->runListener('', $pfad);

		$this->assertNotNull($policy, "Pfad '{$pfad}' braucht die Lockerung");
		$this->assertStringContainsString("'wasm-unsafe-eval'", $policy->buildPolicy());
	}

	/** @return array<string, array{string}> */
	public static function filesPfade(): array {
		return [
			'Uebersicht' => ['/apps/files'],
			'mit Schraegstrich' => ['/apps/files/'],
			'Ansicht mit Datei' => ['/apps/files/files/42'],
			'andere Ansicht' => ['/apps/files/favorites'],
		];
	}

	public function testLockertNichtsWennDerPfadNichtLesbarIst(): void {
		// getPathInfo() wirft bei einer nicht dekodierbaren URL - im Zweifel
		// nicht lockern.
		$this->assertNull($this->runListener('', new \Exception('kaputte URL')));
	}
}
