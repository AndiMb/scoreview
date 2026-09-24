<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\RequestBodyReader;
use PHPUnit\Framework\TestCase;

/**
 * Der Rumpf eines Uploads landet in einer Zwischendatei statt in einem
 * String, und mehr als die Grenze wird gar nicht erst angenommen.
 */
class RequestBodyReaderTest extends TestCase {
	public function testInnerhalbDerGrenzeKommtDerRumpfAlsStromVomAnfang(): void {
		$strom = RequestBodyReader::copyBounded(RecordingServiceTest::strom('abcdef'), 6);

		$this->assertIsResource($strom);
		$this->assertSame('abcdef', stream_get_contents($strom));
		$this->assertSame(6, fstat($strom)['size']);
	}

	public function testUeberDerGrenzeNichts(): void {
		$this->assertNull(RequestBodyReader::copyBounded(RecordingServiceTest::strom('abcdefg'), 6));
	}

	public function testUnlesbarerRumpfIstLeer(): void {
		$strom = RequestBodyReader::copyBounded(false, 6);

		$this->assertSame('', stream_get_contents($strom));
	}

	public function testGrosseRumpfeLiegenNichtImSpeicher(): void {
		// Ueber IN_MEMORY_BYTES schreibt php://temp in eine Datei; der
		// Speicherzuwachs bleibt deutlich unter der Groesse des Rumpfs.
		$gross = str_repeat("\x00", 3 * RequestBodyReader::IN_MEMORY_BYTES);
		$quelle = RecordingServiceTest::strom($gross);
		unset($gross);
		$vorher = memory_get_usage();

		$strom = RequestBodyReader::copyBounded($quelle, 4 * RequestBodyReader::IN_MEMORY_BYTES);

		$this->assertLessThan(RequestBodyReader::IN_MEMORY_BYTES * 2, memory_get_usage() - $vorher);
		$this->assertSame(3 * RequestBodyReader::IN_MEMORY_BYTES, fstat($strom)['size']);
	}
}
