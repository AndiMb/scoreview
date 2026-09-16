<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\MimetypeRegistration;
use OCP\Files\IMimeTypeLoader;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use RuntimeException;

/**
 * Der Dienst traegt den Mimetype ein, den sonst nur `occ` eintragen koennte.
 *
 * Der eigentliche Testgegenstand ist nicht das Durchreichen der beiden
 * Aufrufe, sondern dass ein Fehlschlag **still** bleibt: Beide Aufrufer duerfen
 * daran nicht scheitern - der eine ist ein Repair-Step mitten in
 * `occ upgrade`, der andere haengt hinter einem Upload.
 */
class MimetypeRegistrationTest extends TestCase {
	private function dienst(IMimeTypeLoader $loader, ?LoggerInterface $logger = null): MimetypeRegistration {
		return new MimetypeRegistration($loader, $logger ?? $this->createMock(LoggerInterface::class));
	}

	public function testBerichtigtDenFilecacheUeberDieEndung(): void {
		$loader = $this->createMock(IMimeTypeLoader::class);
		$loader->expects($this->once())
			->method('getId')
			->with('application/x-musescore')
			->willReturn(181);
		// Die Endung steht ohne Punkt in der Abfrage - so erwartet es
		// Loader::updateFilecache(), das daraus selbst "%.mscz" baut.
		$loader->expects($this->once())
			->method('updateFilecache')
			->with('mscz', 181)
			->willReturn(7);

		$this->assertSame(7, $this->dienst($loader)->apply());
	}

	public function testMeldetNullZeilenOhneAufhebens(): void {
		$loader = $this->createMock(IMimeTypeLoader::class);
		$loader->method('getId')->willReturn(181);
		$loader->method('updateFilecache')->willReturn(0);

		$logger = $this->createMock(LoggerInterface::class);
		// Ein zweiter Lauf des Repair-Steps ist der Normalfall und keine
		// Nachricht wert.
		$logger->expects($this->never())->method('info');

		$this->assertSame(0, $this->dienst($loader, $logger)->apply());
	}

	public function testEinFehlschlagBleibtEineWarnungUndKeineAusnahme(): void {
		$loader = $this->createMock(IMimeTypeLoader::class);
		$loader->method('getId')->willReturn(181);
		$loader->method('updateFilecache')->willThrowException(new RuntimeException('Tabelle gesperrt'));

		$logger = $this->createMock(LoggerInterface::class);
		$logger->expects($this->once())->method('warning');

		$this->assertNull($this->dienst($loader, $logger)->apply());
	}

	/**
	 * `updateFilecache()` ist in `IMimeTypeLoader` erst seit Nextcloud 32
	 * zugesagt. Faende ein Server sie nicht, waere das ein `Error` - und der
	 * darf einen Upload nicht mitreissen.
	 */
	public function testAuchEinErrorReisstNichtsMit(): void {
		$loader = $this->createMock(IMimeTypeLoader::class);
		$loader->method('getId')->willThrowException(new \Error('Call to undefined method'));

		$this->assertNull($this->dienst($loader)->apply());
	}
}
