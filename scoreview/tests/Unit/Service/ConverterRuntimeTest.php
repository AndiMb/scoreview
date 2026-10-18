<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ConverterRuntime;
use OCA\ScoreView\Service\LocalConverterException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Every version threshold of the sandbox (S11, E18) in one table. The
 * thresholds are measured, not taken from changelogs: whether they still
 * hold for a real runtime is checked by tests/Sandbox in CI.
 */
class ConverterRuntimeTest extends TestCase {
	/** @return array<string, array{string, string, ?string}> */
	public static function versions(): array {
		return [
			// No permission model at all.
			'Node 18' => ["v18.20.4\n", ConverterRuntime::ISOLATION_NONE, null],
			// Only the last of several --allow-fs-read flags counts.
			'Node 20.5' => ["v20.5.0\n", ConverterRuntime::ISOLATION_NONE, null],
			'Node 20.7' => ["v20.7.0\n", ConverterRuntime::ISOLATION_PARTIAL, '--experimental-permission'],
			'Node 20.19 (Debian 13)' => ["v20.19.2\n", ConverterRuntime::ISOLATION_PARTIAL, '--experimental-permission'],
			'Node 22.12' => ["v22.12.0\n", ConverterRuntime::ISOLATION_PARTIAL, '--experimental-permission'],
			'Node 22.13' => ["v22.13.0\n", ConverterRuntime::ISOLATION_PARTIAL, '--permission'],
			'Node 23.4' => ["v23.4.0\n", ConverterRuntime::ISOLATION_PARTIAL, '--experimental-permission'],
			'Node 23.5' => ["v23.5.0\n", ConverterRuntime::ISOLATION_PARTIAL, '--permission'],
			'Node 24' => ["v24.22.0\n", ConverterRuntime::ISOLATION_PARTIAL, '--permission'],
			// From 25 on --permission also blocks the network.
			'Node 25' => ["v25.9.0\n", ConverterRuntime::ISOLATION_FULL, '--permission'],
			'Node 26' => ["v26.12.0\n", ConverterRuntime::ISOLATION_FULL, '--permission'],
			'Deno 2' => ["deno 2.9.7 (stable, release, x86_64-unknown-linux-gnu)\nv8 14.0\ntypescript 5.9\n", ConverterRuntime::ISOLATION_FULL, 'run'],
		];
	}

	#[DataProvider('versions')]
	public function testStufeUndFlagJeVersion(string $output, string $isolation, ?string $flag): void {
		$runtime = ConverterRuntime::fromVersionOutput('/usr/bin/x', $output);

		$this->assertNotNull($runtime);
		$this->assertTrue($runtime->isSupported());
		$this->assertSame($isolation, $runtime->isolation());

		$argv = $runtime->command('/app/convert.mjs', ['/app', '/tmp/in.mscz'], ['/tmp/out'], ['/tmp/in.mscz', '/tmp/out']);
		$this->assertSame('/usr/bin/x', $argv[0]);
		$this->assertSame(['/app/convert.mjs', '/tmp/in.mscz', '/tmp/out'], array_slice($argv, -3), 'script and arguments come last, unchanged');
		if ($flag === null) {
			$this->assertSame(['/usr/bin/x', '/app/convert.mjs', '/tmp/in.mscz', '/tmp/out'], $argv, 'without a usable permission model the run stays as it was');
		} else {
			$this->assertSame($flag, $argv[1]);
		}
	}

	public function testNodeBekommtEinFlagJePfad(): void {
		$runtime = ConverterRuntime::fromVersionOutput('/usr/bin/node', 'v22.21.1');

		$this->assertSame([
			'/usr/bin/node', '--permission',
			'--allow-fs-read=/app', '--allow-fs-read=/tmp/in.mscz', '--allow-fs-read=/fonts,cjk',
			'--allow-fs-write=/tmp/out',
			'/app/convert.mjs', '--selftest',
		], $runtime->command('/app/convert.mjs', ['/app', '/tmp/in.mscz', '/fonts,cjk'], ['/tmp/out'], ['--selftest']));
	}

	public function testDenoBekommtNurLesenUndSchreiben(): void {
		$runtime = ConverterRuntime::fromVersionOutput('/usr/local/bin/deno', "deno 2.9.7 (stable)\n");

		$argv = $runtime->command('/app/convert.mjs', ['/app'], ['/tmp/out'], ['--selftest']);

		$this->assertSame([
			'/usr/local/bin/deno', 'run', '--no-prompt', '--no-remote', '--cached-only', '--no-lock',
			'--allow-read=/app', '--allow-write=/tmp/out',
			'/app/convert.mjs', '--selftest',
		], $argv);
		$this->assertNotContains('--no-config', $argv, 'would ignore package.json and break the engine import');
		$this->assertEmpty(preg_grep('/^--allow-(env|net|run|sys|ffi|all)|^-A$/', $argv));
	}

	public function testDenoVerweigertEinenPfadMitKomma(): void {
		// Deno splits grants at commas and has no escape; widening the grant
		// or dropping the sandbox would both break S11.
		$runtime = ConverterRuntime::fromVersionOutput('/usr/bin/deno', 'deno 2.9.7');

		try {
			$runtime->command('/app/convert.mjs', ['/app', '/srv/a,b/in.mscz'], [], []);
			$this->fail('LocalConverterException expected');
		} catch (LocalConverterException $e) {
			$this->assertSame(ScoreConversion::ERROR_LOCAL_UNAVAILABLE, $e->getErrorCode());
			$this->assertStringContainsString('/srv/a,b/in.mscz', $e->getMessage());
		}
	}

	public function testDenoEinsWirdNichtUnterstuetzt(): void {
		$runtime = ConverterRuntime::fromVersionOutput('/usr/bin/deno', "deno 1.46.3 (release)\n");

		$this->assertNotNull($runtime);
		$this->assertFalse($runtime->isSupported());
		$this->assertSame('1.46.3', $runtime->version);
	}

	public function testErkenntDieLaufzeitAnDerAusgabeNichtAmNamen(): void {
		// A `node` that is a symlink to deno must get deno's flags - Node's
		// would be unknown options to deno, and the run would fail.
		$runtime = ConverterRuntime::fromVersionOutput('/usr/bin/node', 'deno 2.9.7');

		$this->assertSame(ConverterRuntime::DENO, $runtime->kind);
	}

	/** @return array<string, array{string}> */
	public static function fremdeAusgaben(): array {
		return [
			'Bun' => ["1.4.3\n"],
			'leer' => [''],
			'Unsinn' => ["command not found\n"],
			'Version ohne v' => ['22.21.1'],
		];
	}

	#[DataProvider('fremdeAusgaben')]
	public function testFremdeAusgabeIstKeineLaufzeit(string $output): void {
		$this->assertNull(ConverterRuntime::fromVersionOutput('/usr/bin/x', $output));
	}

	public function testVersionsangabeFuerDieDiagnose(): void {
		$this->assertSame('v22.21.1', ConverterRuntime::fromVersionOutput('/n', "v22.21.1\n")->version);
		$this->assertSame('2.9.7', ConverterRuntime::fromVersionOutput('/d', "deno 2.9.7 (stable)\n")->version);
	}
}
