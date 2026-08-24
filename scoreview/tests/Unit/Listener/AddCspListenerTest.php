<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Listener;

use OCA\ScoreView\Listener\AddCspListener;
use OCP\AppFramework\Http\EmptyContentSecurityPolicy;
use OCP\IAppConfig;
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
	private function policyFor(string $soundFontUrl): string {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')
			->with('scoreview', 'soundfont_url')
			->willReturn($soundFontUrl);

		$captured = null;
		$event = $this->createMock(AddContentSecurityPolicyEvent::class);
		$event->method('addPolicy')->willReturnCallback(
			function (EmptyContentSecurityPolicy $csp) use (&$captured): void {
				$captured = $csp;
			},
		);

		(new AddCspListener($appConfig))->handle($event);

		$this->assertInstanceOf(EmptyContentSecurityPolicy::class, $captured);
		return $captured->buildPolicy();
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

		(new AddCspListener($appConfig))->handle(new \OCP\EventDispatcher\Event());

		$this->addToAssertionCount(1);
	}
}
