<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Migration;

use OCA\ScoreView\Migration\Version000100Date20261025200000;
use OCA\ScoreView\Service\ConversionBackend;
use OCP\IAppConfig;
use OCP\Migration\IOutput;
use PHPUnit\Framework\TestCase;

/**
 * The update must not ask an existing sidecar for a renderer its image does
 * not have yet - and must leave alone what an admin chose and what a fresh
 * installation has never set.
 */
class SidecarRendererMigrationTest extends TestCase {
	/** @var array<string, string> */
	private array $strings = [];

	private function migrieren(): void {
		$config = $this->createMock(IAppConfig::class);
		$config->method('hasKey')->willReturnCallback(fn (string $app, string $key) => isset($this->strings[$key]));
		$config->method('getValueString')->willReturnCallback(fn (string $app, string $key, string $default = '') => $this->strings[$key] ?? $default);
		$config->method('setValueString')->willReturnCallback(function (string $app, string $key, string $value): bool {
			$this->strings[$key] = $value;
			return true;
		});
		(new Version000100Date20261025200000($config))
			->postSchemaChange($this->createMock(IOutput::class), static fn () => null, []);
	}

	public function testEinEingerichteterSidecarBleibtBeiMuseScore(): void {
		$this->strings = ['sidecar_url' => 'http://scoreview-sidecar:8765'];
		$this->migrieren();
		$this->assertSame(ConversionBackend::RENDERER_MUSESCORE, $this->strings[ConversionBackend::SIDECAR_RENDERER_KEY]);
	}

	public function testEineFrischeInstallationBekommtDieEngine(): void {
		$this->migrieren();
		$this->assertArrayNotHasKey(ConversionBackend::SIDECAR_RENDERER_KEY, $this->strings);
	}

	public function testEineGetroffeneWahlBleibt(): void {
		$this->strings = ['sidecar_url' => 'http://scoreview-sidecar:8765', 'sidecar_renderer' => 'engine'];
		$this->migrieren();
		$this->assertSame('engine', $this->strings[ConversionBackend::SIDECAR_RENDERER_KEY]);
	}
}
