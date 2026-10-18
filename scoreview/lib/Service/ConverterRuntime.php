<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\ScoreConversion;

/**
 * The JavaScript runtime that runs converter/convert.mjs, and what it can
 * lock down (docs/architecture.md S11, E18).
 *
 * A plain value without I/O: LocalConverter asks the binary for its version,
 * this class turns the answer into "which runtime, how far isolated, which
 * argv". Keeping every version threshold here is what makes them testable
 * without installing five Node versions.
 *
 * The runtime is recognised by what `--version` prints, not by the file
 * name: a `node` that is really a symlink to deno gets deno's flags, which is
 * the only way the grants below are actually understood.
 */
final class ConverterRuntime {
	public const NODE = 'node';
	public const DENO = 'deno';

	/** File system, processes and network are locked. */
	public const ISOLATION_FULL = 'full';
	/** File system and processes are locked; the network is not. */
	public const ISOLATION_PARTIAL = 'partial';
	/** Nothing is locked - the runtime has no usable permission model. */
	public const ISOLATION_NONE = 'none';

	private function __construct(
		public readonly string $kind,
		public readonly string $path,
		public readonly string $version,
		private readonly int $major,
		private readonly int $minor,
	) {
	}

	/**
	 * Reads the first line of `<path> --version`: `v22.21.1` from Node,
	 * `deno 2.9.7 (stable, ...)` from Deno. Anything else - Bun prints a bare
	 * `1.4.3` - is not a runtime ScoreView runs (E18).
	 */
	public static function fromVersionOutput(string $path, string $stdout): ?self {
		$line = trim(strtok($stdout, "\n") ?: '');
		if (preg_match('/^v(\d+)\.(\d+)\.\d+/', $line, $m) === 1) {
			return new self(self::NODE, $path, $m[0], (int)$m[1], (int)$m[2]);
		}
		if (preg_match('/^deno (\d+)\.(\d+)\.\d+/', $line, $m) === 1) {
			return new self(self::DENO, $path, substr($m[0], 5), (int)$m[1], (int)$m[2]);
		}
		return null;
	}

	/**
	 * Deno 1.x has a weaker Node compatibility layer and is not measured;
	 * every Node version the engine starts on is fine (the lower bound is
	 * the converter's `engines` field, checked by CI).
	 */
	public function isSupported(): bool {
		return $this->kind === self::NODE || $this->major >= 2;
	}

	public function isolation(): string {
		if ($this->kind === self::DENO || $this->major >= 25) {
			return self::ISOLATION_FULL;
		}
		// Measured: before 20.7 only the LAST of several --allow-fs-read
		// flags counts, so the converter could not read its own directory
		// and its input at once. Comma lists are no way out - from Node 22
		// on a comma is part of the path. Below 20.7 the run stays as it
		// was, and the diagnostics say so.
		if ($this->major > 20 || ($this->major === 20 && $this->minor >= 7)) {
			return self::ISOLATION_PARTIAL;
		}
		return self::ISOLATION_NONE;
	}

	/**
	 * The argv for running $script with read access to $read and write
	 * access to $write - and nothing else the runtime can withhold.
	 *
	 * Deliberately absent: worker, child process, WASI, addon and network
	 * grants (Node), env, net, run, sys and ffi (Deno). The engine needs
	 * none of them, measured with large scores as well.
	 *
	 * @param string[] $read
	 * @param string[] $write
	 * @param string[] $args
	 * @return string[]
	 * @throws LocalConverterException if a path cannot be granted
	 */
	public function command(string $script, array $read, array $write, array $args): array {
		$read = self::distinctPaths($read);
		$write = self::distinctPaths($write);
		if ($this->kind === self::DENO) {
			return array_merge(
				// No --no-config: it also ignores package.json, and the bare
				// import of scoreview-engine then no longer resolves.
				// --no-lock because the app directory is signed - a lock file
				// written there would trip Nextcloud's integrity check.
				[$this->path, 'run', '--no-prompt', '--no-remote', '--cached-only', '--no-lock'],
				array_map(fn (string $p) => '--allow-read=' . $this->denoPath($p), $read),
				array_map(fn (string $p) => '--allow-write=' . $this->denoPath($p), $write),
				[$script],
				$args,
			);
		}
		if ($this->isolation() === self::ISOLATION_NONE) {
			return array_merge([$this->path, $script], $args);
		}
		// Renamed when it became stable in 22.13 and 23.5; the old name is
		// what 20.x and the early 22/23 releases know.
		$stable = $this->major >= 24
			|| ($this->major === 23 && $this->minor >= 5)
			|| ($this->major === 22 && $this->minor >= 13);
		return array_merge(
			[$this->path, $stable ? '--permission' : '--experimental-permission'],
			// One flag per path, never a comma list (see isolation()).
			array_map(static fn (string $p) => '--allow-fs-read=' . $p, $read),
			array_map(static fn (string $p) => '--allow-fs-write=' . $p, $write),
			[$script],
			$args,
		);
	}

	/**
	 * Each directory once, without a trailing slash. Measured on Node 20.19:
	 * granting the same directory as `/tmp/out/` and `/tmp/out` aborts the
	 * runtime before the script starts (assertion `!path_prefix.empty()` in
	 * its permission tree; 22 and 24 accept it) - and that pair is exactly
	 * what an output directory plus its realpath() produces.
	 *
	 * @param string[] $paths
	 * @return string[]
	 */
	private static function distinctPaths(array $paths): array {
		$result = [];
		foreach ($paths as $path) {
			$trimmed = rtrim($path, '/');
			$result[] = $trimmed === '' ? '/' : $trimmed;
		}
		return array_values(array_unique($result));
	}

	/**
	 * Deno splits every grant at commas and has no escape for them (`,,` is
	 * rejected as an empty path). Granting the parent directory instead
	 * would widen the sandbox, and running without it would break the
	 * promise of S11 - so such a path is refused, with the path named.
	 *
	 * @throws LocalConverterException
	 */
	private function denoPath(string $path): string {
		if (str_contains($path, ',')) {
			throw new LocalConverterException(
				'Deno cannot grant access to a path containing a comma: ' . $path,
				errorCode: ScoreConversion::ERROR_LOCAL_UNAVAILABLE,
			);
		}
		return $path;
	}
}
