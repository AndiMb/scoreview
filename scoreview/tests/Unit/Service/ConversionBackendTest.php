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

	public function testIstOhneEinstellungDerSidecar(): void {
		// Voreinstellung: eine Bestandsinstallation darf sich durch ein
		// Update nicht umstellen.
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')
			->willReturnCallback(static fn (string $app, string $key, string $default = '') => $default);

		$this->assertSame(ConversionBackend::SIDECAR, (new ConversionBackend($appConfig))->current());
		$this->assertFalse((new ConversionBackend($appConfig))->isLocal());
	}

	public function testErkenntDenLokalenWeg(): void {
		$this->assertTrue($this->backendMitWert('local')->isLocal());
	}

	public function testFaelltBeiUnbekanntemWertAufDenSidecarZurueck(): void {
		$this->assertSame(ConversionBackend::SIDECAR, $this->backendMitWert('webmscore')->current());
		$this->assertSame(ConversionBackend::SIDECAR, ConversionBackend::normalize('Local'));
		$this->assertSame(ConversionBackend::LOCAL, ConversionBackend::normalize('local'));
	}
}
