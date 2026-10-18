<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Sandbox;

use OCA\ScoreView\Service\ConverterRuntime;
use OCA\ScoreView\Service\LocalConverter;
use OCP\IAppConfig;
use OCP\ITempManager;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * The sandbox of S11 against a REAL runtime: what the flags promise is
 * checked by trying, not inferred from the flags.
 *
 * Needs SCOREVIEW_RUNTIME (absolute path to node or deno) and an installed
 * converter (converter/node_modules); without the variable everything is
 * skipped, so `composer run test:unit` stays free of runtimes. CI runs this
 * suite once per runtime (`composer run test:sandbox`).
 *
 * The probe goes through ConverterRuntime::command() and the converter's
 * own environment - the same building blocks LocalConverter::run() uses -
 * and the self-test and a conversion go through LocalConverter itself.
 */
class SandboxTest extends TestCase {
	private string $runtimePath;
	/** @var string[] */
	private array $cleanup = [];

	protected function setUp(): void {
		$path = getenv('SCOREVIEW_RUNTIME');
		if (!is_string($path) || $path === '') {
			$this->markTestSkipped('SCOREVIEW_RUNTIME is not set.');
		}
		$this->runtimePath = $path;
	}

	protected function tearDown(): void {
		foreach (array_reverse($this->cleanup) as $path) {
			is_dir($path) ? $this->removeDir($path) : @unlink($path);
		}
	}

	public function testDieSperrenHaltenWasDieStufeVerspricht(): void {
		$converter = $this->converter([]);
		$runtime = $this->invoke($converter, 'probeRuntime', $this->runtimePath);
		$this->assertInstanceOf(ConverterRuntime::class, $runtime, 'SCOREVIEW_RUNTIME is not a runtime ScoreView accepts');

		$granted = $this->tempDir();
		$forbiddenDir = $this->tempDir();
		$forbiddenFile = $forbiddenDir . DIRECTORY_SEPARATOR . 'secret.txt';
		file_put_contents($forbiddenFile, 'secret');
		// A listening socket on loopback: a connect succeeds from the
		// kernel's backlog without accept(), so "allowed" does not depend on
		// any network outside this machine.
		$server = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
		$this->assertNotFalse($server, $errstr);
		$port = (int)substr(strrchr((string)stream_socket_get_name($server, false), ':'), 1);

		$fixtures = (string)realpath(__DIR__ . '/../fixtures');
		$result = $this->invoke(
			$converter,
			'execute',
			$runtime->command(
				$fixtures . DIRECTORY_SEPARATOR . 'sandbox-probe.mjs',
				[$fixtures],
				[$granted],
				[$granted, $forbiddenFile, $forbiddenDir, (string)$port],
			),
			$fixtures,
			60,
			$this->invoke($converter, 'converterEnvironment'),
		);
		fclose($server);

		$this->assertSame(0, $result['exitCode'], $result['stderr']);
		$seen = json_decode(trim($result['stdout']), true);
		$this->assertIsArray($seen, $result['stdout'] . $result['stderr']);

		$expected = match ($runtime->isolation()) {
			ConverterRuntime::ISOLATION_FULL => ['readOutside' => 'denied', 'writeOutside' => 'denied', 'childProcess' => 'denied', 'network' => 'denied'],
			ConverterRuntime::ISOLATION_PARTIAL => ['readOutside' => 'denied', 'writeOutside' => 'denied', 'childProcess' => 'denied', 'network' => 'allowed'],
			// Checked as well: the diagnostics must not promise more than
			// the runtime holds - and "none" must really mean the run is
			// as it always was.
			default => ['readOutside' => 'allowed', 'writeOutside' => 'allowed', 'childProcess' => 'allowed', 'network' => 'allowed'],
		};
		$this->assertSame(
			['readGranted' => 'allowed', 'writeGranted' => 'allowed'] + $expected,
			$seen,
			sprintf('%s %s, isolation %s', $runtime->kind, $runtime->version, $runtime->isolation()),
		);
		if ($runtime->isolation() !== ConverterRuntime::ISOLATION_NONE) {
			// The file system as witness, not only the probe's own report.
			$this->assertFileDoesNotExist($forbiddenDir . DIRECTORY_SEPARATOR . 'escape.txt', 'the sandbox let a write through');
		}
	}

	public function testSelbsttestLaeuftAbgeschottet(): void {
		$result = $this->converter([])->runSelfTest();

		$this->assertTrue($result['ok'], json_encode($result));
	}

	public function testKonvertierungSchreibtNurInsAusgabeverzeichnis(): void {
		$out = $this->tempDir();
		$tempManager = $this->createMock(ITempManager::class);
		$tempManager->method('getTemporaryFolder')->willReturn($out);
		$converter = $this->converter([], $tempManager);

		$artifacts = $converter->convert($converter->getConverterDir() . '/lyrics-test.mscz');

		$this->assertNotEmpty($artifacts['pages']);
		$this->assertStringStartsWith('MThd', $artifacts['midi']);
	}

	/** @param array<string, string> $values */
	private function converter(array $values, ?ITempManager $tempManager = null): LocalConverter {
		$values += ['node_path' => $this->runtimePath];
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')
			->willReturnCallback(static fn (string $app, string $key, string $default = '') => $values[$key] ?? $default);
		$appConfig->method('getValueInt')
			->willReturnCallback(static fn (string $app, string $key, int $default = 0) => $default);
		return new LocalConverter($appConfig, $tempManager ?? $this->createMock(ITempManager::class), $this->createMock(LoggerInterface::class));
	}

	private function invoke(object $object, string $method, mixed ...$args): mixed {
		return (new \ReflectionMethod($object, $method))->invoke($object, ...$args);
	}

	private function tempDir(): string {
		$dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'scoreview-sandbox-' . bin2hex(random_bytes(6));
		mkdir($dir);
		$this->cleanup[] = $dir;
		return (string)realpath($dir);
	}

	private function removeDir(string $dir): void {
		foreach (scandir($dir) ?: [] as $entry) {
			if ($entry !== '.' && $entry !== '..') {
				$path = $dir . DIRECTORY_SEPARATOR . $entry;
				is_dir($path) ? $this->removeDir($path) : @unlink($path);
			}
		}
		@rmdir($dir);
	}
}
