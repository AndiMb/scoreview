<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\WavFormat;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Der Server nimmt genau die WAV an, die der Viewer baut - und rechnet ihre
 * Dauer aus den Bytes, nicht aus einer Angabe des Clients. Sonst liesse sich
 * unter dem Namen einer Aufnahme beliebiger Inhalt ablegen, und die
 * Laengengrenze waere eine Bitte statt einer Grenze.
 */
class WavFormatTest extends TestCase {
	/**
	 * Eine WAV wie aus src/lib/wavCodec.js, mit einstellbarem Format.
	 */
	public static function wav(int $samples, int $rate = 16000, int $channels = 1, int $bits = 16, int $format = 1, ?int $declaredData = null, string $extraChunk = ''): string {
		$data = str_repeat("\x01\x00", $samples * $channels);
		$blockAlign = $channels * intdiv($bits, 8);
		$fmt = 'fmt ' . pack('V', 16) . pack('vvVVvv', $format, $channels, $rate, $rate * $blockAlign, $blockAlign, $bits);
		$body = 'WAVE' . $fmt . $extraChunk . 'data' . pack('V', $declaredData ?? strlen($data)) . $data;
		return 'RIFF' . pack('V', strlen($body)) . $body;
	}

	public function testEineSekundeSindZweiunddreissigtausendBytes(): void {
		$info = WavFormat::inspect(self::wav(16000));

		$this->assertSame(32000, $info['dataBytes']);
		$this->assertSame(1000, $info['durationMs']);
	}

	public function testUeberspringtFremdeBloeckeVorDenDaten(): void {
		// Ein LIST-Block mit ungerader Laenge: RIFF fuellt auf gerade auf.
		$list = 'LIST' . pack('V', 3) . "abc\x00";
		$info = WavFormat::inspect(self::wav(8000, extraChunk: $list));

		$this->assertSame(500, $info['durationMs']);
	}

	/**
	 * @return array<string, array{string}>
	 */
	public static function fremdes(): array {
		return [
			'leer' => [''],
			'Text' => [str_repeat('Hallo Welt ', 10)],
			'Stereo' => [self::wav(100, channels: 2)],
			'44,1 kHz' => [self::wav(100, rate: 44100)],
			'8 bit' => [self::wav(100, bits: 8)],
			'Gleitkomma' => [self::wav(100, format: 3)],
			'abgeschnitten' => [self::wav(100, declaredData: 999999)],
			'ohne Samples' => [self::wav(0)],
			'Bytes nach den Daten' => [self::wav(100) . 'LIST' . pack('V', 4) . 'abcd'],
			'ohne data' => ['RIFF' . pack('V', 28) . 'WAVE' . 'fmt ' . pack('V', 16) . pack('vvVVvv', 1, 1, 16000, 32000, 2, 16) . str_repeat("\x00", 8)],
		];
	}

	#[DataProvider('fremdes')]
	public function testLehntAllesAndereAb(string $bytes): void {
		$this->expectException(\InvalidArgumentException::class);
		WavFormat::inspect($bytes);
	}

	public function testKopfUndLaengeReichen(): void {
		$wav = self::wav(16000 * 60);
		$kopf = substr($wav, 0, WavFormat::HEAD_READ_BYTES);

		$this->assertSame(60000, WavFormat::inspectHead($kopf, strlen($wav))['durationMs']);
	}

	public function testKopfMitFalscherGesamtlaengeWirdAbgelehnt(): void {
		$wav = self::wav(16000);
		$this->expectException(\InvalidArgumentException::class);
		WavFormat::inspectHead(substr($wav, 0, WavFormat::HEAD_READ_BYTES), strlen($wav) + 2);
	}
}
