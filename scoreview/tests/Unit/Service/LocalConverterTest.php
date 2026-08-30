<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\LocalConverterException;
use OCP\IAppConfig;
use OCP\ITempManager;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Der lokale Weg scheitert auf einer fremden Instanz an drei Dingen, die
 * alle nichts mit Partituren zu tun haben: kein node, kein proc_open, keine
 * mitgelieferte Engine. Von aussen sieht jedes davon gleich aus - "die
 * Konvertierung geht nicht" -, weshalb sie hier getrennt beantwortet werden
 * muessen und nicht als ein gemeinsames "fehlgeschlagen".
 *
 * Bewusst OHNE echte Konvertierung: die braeuchte das Engine-Wasm und
 * liefe Sekunden. Der Durchstich mit echter Engine ist der Selbsttest
 * der Admin-Seite (LocalConverter::runSelfTest()) und
 * converter/lib/artifacts.test.mjs.
 */
class LocalConverterTest extends TestCase {
	private IAppConfig&MockObject $appConfig;
	private ITempManager&MockObject $tempManager;

	protected function setUp(): void {
		$this->appConfig = $this->createMock(IAppConfig::class);
		$this->tempManager = $this->createMock(ITempManager::class);
	}

	private function converter(): LocalConverter {
		return new LocalConverter($this->appConfig, $this->tempManager, $this->createMock(LoggerInterface::class));
	}

	/** @param array<string, string> $values */
	private function withConfig(array $values): void {
		$this->appConfig->method('getValueString')
			->willReturnCallback(static fn (string $app, string $key, string $default = '') => $values[$key] ?? $default);
	}

	public function testSuchtDenKonverterImAppPaket(): void {
		// Nicht konfigurierbar: der Konverter gehoert zum App-Paket, ein
		// abweichender Pfad waere eine Fehlerquelle ohne Nutzen.
		$this->withConfig([]);
		$this->assertStringEndsWith('/converter', str_replace('\\', '/', $this->converter()->getConverterDir()));
	}

	public function testMeldetEinenUnbrauchbarenNodePfadAlsSolchen(): void {
		// Ein eingetragener Pfad wird NICHT geglaubt, sondern mit
		// `node --version` geprueft - ein Tippfehler soll hier auffallen und
		// nicht erst bei der ersten Partitur.
		$this->withConfig(['node_path' => '/pfad/den/es/nicht/gibt/node']);

		$beschreibung = $this->converter()->describe();

		$this->assertFalse($beschreibung['available']);
		$this->assertNull($beschreibung['nodePath']);
		$this->assertStringContainsString('Node.js', (string)$beschreibung['error']);
	}

	public function testWirftMitEigenemFehlercodeWennNodeFehlt(): void {
		// ERROR_LOCAL_UNAVAILABLE statt eines allgemeinen Konvertierungsfehlers:
		// die Ursache liegt in der Einrichtung, nicht in der Partitur, und die
		// Oberflaeche uebersetzt den Code entsprechend.
		$this->withConfig(['node_path' => '/pfad/den/es/nicht/gibt/node']);
		$this->tempManager->method('getTemporaryFolder')->willReturn(sys_get_temp_dir());

		try {
			$this->converter()->convert(__DIR__ . '/egal.mscz');
			$this->fail('LocalConverterException erwartet');
		} catch (LocalConverterException $e) {
			$this->assertSame(ScoreConversion::ERROR_LOCAL_UNAVAILABLE, $e->getErrorCode());
		}
	}

	public function testNimmtDieMeldungAusDemStacktraceStattEinesFrames(): void {
		// Ueber Reflection, weil die Methode privat ist und der einzige Weg
		// dorthin ein echter Konverterlauf mit Wasm waere. Der Fall ist
		// wortwoertlich der gemessene: Qt-Meldung, dann die Ursache, dann die
		// Frames. Frueher stand die letzte Zeile in der Oberflaeche.
		$stderr = "12:00:00 | ERROR | main_thread | DefaultStyle::doLoadStyle | failed load style\n"
			. "RuntimeError: null function or function signature mismatch\n"
			. "    at wasm://wasm/02366562:wasm-function[5328]:0x479d80\n"
			. "    at async file:///app/converter/convert.mjs:240:2\n";

		$methode = new \ReflectionMethod(LocalConverter::class, 'lastLine');
		$methode->setAccessible(true);

		$this->assertSame(
			'RuntimeError: null function or function signature mismatch',
			$methode->invoke($this->converter(), $stderr),
		);
	}

	public function testSelbsttestScheitertLesbarStattZuWerfen(): void {
		// Der Selbsttest ist eine Diagnose - er muss auch dann antworten,
		// wenn der Weg gar nicht lauffaehig ist, sonst steht in der
		// Oberflaeche ein 500 statt der Ursache.
		$this->withConfig(['node_path' => '/pfad/den/es/nicht/gibt/node']);

		$ergebnis = $this->converter()->runSelfTest();

		$this->assertFalse($ergebnis['ok']);
		$this->assertStringContainsString('Node.js', $ergebnis['error']);
	}
}
