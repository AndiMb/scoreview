<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\LocalConverterException;
use OCP\IAppConfig;
use OCP\ITempManager;
use PHPUnit\Framework\Attributes\DataProvider;
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
		// Frames. Die letzte Zeile waere nur ein Frame, nicht die Ursache.
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

	/**
	 * Ein ECHTER Kindprozess ueber den Ausfuehrungspfad, den auch
	 * `node --version` und jede Konvertierung nehmen. Gestartet wird PHP
	 * selbst (PHP_BINARY) - das gibt es auf jeder Maschine, auf der dieser
	 * Test laeuft, node dagegen nicht.
	 *
	 * Der Fall, um den es geht: Vor PHP 8.3 liefert proc_close() nach einem
	 * proc_get_status(), das das Ende schon gemeldet hat, -1 statt des
	 * Exitcodes. Mit -1 galt jedes node als kaputt, und der lokale Weg war
	 * unter 8.1/8.2 nie verfuegbar. Aussagekraeftig ist der Test deshalb in
	 * der 8.1-Achse der CI; unter 8.3 waere er auch mit dem Fehler gruen.
	 *
	 * @return array<string, array{int}>
	 */
	public static function exitcodes(): array {
		return ['Erfolg' => [0], 'Fehler' => [3]];
	}

	#[DataProvider('exitcodes')]
	public function testLiefertDenExitcodeEinesEchtenProzesses(int $code): void {
		$ergebnis = $this->ausfuehren([PHP_BINARY, '-r', 'echo "v99.0.0"; exit(' . $code . ');']);

		$this->assertFalse($ergebnis['timedOut']);
		$this->assertSame($code, $ergebnis['exitCode']);
		$this->assertSame('v99.0.0', $ergebnis['stdout']);
		$this->assertFalse($ergebnis['stdoutOverflow']);
	}

	public function testZuVielAufStdoutIstEinFehlerStattGekappt(): void {
		// Ueber stdout kommt nur eine Zeile JSON. Mehr als die Grenze heisst:
		// nicht der erwartete Prozess - und ein abgeschnittenes JSON waere
		// eine falsche Antwort, keine kuerzere.
		if (PHP_OS_FAMILY === 'Windows') {
			// Nextcloud laeuft nicht auf Windows-Servern, und dort blockiert
			// das Lesen aus proc_open-Pipes trotz stream_set_blocking(false) -
			// ein Megabyte-Strom haengt den Test auf. Die CI (Linux) prueft ihn.
			$this->markTestSkipped('Nicht-blockierende Pipes gibt es unter Windows nicht.');
		}
		$ergebnis = $this->ausfuehren([PHP_BINARY, '-r', 'echo str_repeat("x", 2 * 1024 * 1024);']);

		$this->assertTrue($ergebnis['stdoutOverflow']);
		$this->assertSame('', $ergebnis['stdout']);
		$this->assertSame(0, $ergebnis['exitCode'], 'der Prozess lief trotzdem zu Ende, statt an der vollen Pipe zu haengen');
	}

	/**
	 * @param string[] $kommando
	 * @return array{stdout: string, stderr: string, exitCode: int, timedOut: bool, stdoutOverflow: bool}
	 */
	private function ausfuehren(array $kommando): array {
		// Ueber Reflection wie lastLine(): execute() ist bewusst privat, und
		// der oeffentliche Weg dorthin verlangt node samt Engine.
		$methode = new \ReflectionMethod(LocalConverter::class, 'execute');
		$methode->setAccessible(true);
		return $methode->invoke($this->converter(), $kommando, sys_get_temp_dir(), 30);
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
