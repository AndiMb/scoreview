<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\ConversionBackend;
use OCP\IAppConfig;
use PHPUnit\Framework\TestCase;

/**
 * Eine Einstellung mit genau zwei gueltigen Werten - und der wichtigere Teil
 * ist, was mit einem dritten passiert. Ein unbekannter Wert darf nirgends als
 * eigener Zustand durchschlagen, sonst konvertiert eine Instanz nach einem
 * Tippfehler in `occ config:app:set` gar nicht mehr, ohne dass irgendwo ein
 * Fehler steht.
 */
class ConversionBackendTest extends TestCase {
	private function backendMitWert(string $wert): ConversionBackend {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')->willReturn($wert);
		return new ConversionBackend($appConfig);
	}

	private function backendOhneEinstellung(): ConversionBackend {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')
			->willReturnCallback(static fn (string $app, string $key, string $default = '') => $default);
		return new ConversionBackend($appConfig);
	}

	public function testIstOhneEinstellungDerLokaleWeg(): void {
		// Voreinstellung: der einzige Weg, der nach `app:enable` schon
		// fertig ist. Bestandsinstallationen mit Sidecar schuetzt
		// Migration\Version000100Date20260903120000, nicht diese Zeile.
		$this->assertSame(ConversionBackend::LOCAL, $this->backendOhneEinstellung()->current());
		$this->assertTrue($this->backendOhneEinstellung()->isLocal());
	}

	public function testErkenntDenSidecar(): void {
		$this->assertSame(ConversionBackend::SIDECAR, $this->backendMitWert('sidecar')->current());
		$this->assertFalse($this->backendMitWert('sidecar')->isLocal());
	}

	public function testFaelltBeiUnbekanntemWertAufDenLokalenWegZurueck(): void {
		$this->assertSame(ConversionBackend::LOCAL, $this->backendMitWert('irgendwas')->current());
		$this->assertSame(ConversionBackend::LOCAL, ConversionBackend::normalize('Sidecar'));
		$this->assertSame(ConversionBackend::SIDECAR, ConversionBackend::normalize('sidecar'));
		$this->assertSame(ConversionBackend::LOCAL, ConversionBackend::normalize('local'));
	}
}
