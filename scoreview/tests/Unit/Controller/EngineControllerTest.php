<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\EngineController;
use OCA\ScoreView\Service\LocalConverter;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\StreamResponse;
use OCP\IL10N;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;

/**
 * The public route that hands the engine to the browser fallback (E7).
 * Public, so its promise is narrow: three named files of the installed
 * engine, under the installed version only - never a path from the URL.
 */
class EngineControllerTest extends TestCase {
	private string $dir;

	protected function setUp(): void {
		$this->dir = sys_get_temp_dir() . '/sv-engine-' . bin2hex(random_bytes(4));
		mkdir($this->dir . '/node_modules/scoreview-engine', 0777, true);
		file_put_contents($this->dir . '/node_modules/scoreview-engine/scoreview.mjs', 'export {};');
	}

	protected function tearDown(): void {
		@unlink($this->dir . '/node_modules/scoreview-engine/scoreview.mjs');
		@rmdir($this->dir . '/node_modules/scoreview-engine');
		@rmdir($this->dir . '/node_modules');
		@rmdir($this->dir);
	}

	private function controller(): EngineController {
		$converter = $this->createMock(LocalConverter::class);
		$converter->method('engineVersion')->willReturn('4.7.6-engine.3');
		$converter->method('getConverterDir')->willReturn($this->dir);
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		return new EngineController($this->createMock(IRequest::class), $converter, $l);
	}

	private function header(Http\Response $response, string $name): ?string {
		return (new \ReflectionProperty(Http\Response::class, 'headers'))->getValue($response)[$name] ?? null;
	}

	public function testServesANamedFileOfTheInstalledVersionImmutably(): void {
		$response = $this->controller()->get('4.7.6-engine.3', 'scoreview.mjs');

		$this->assertInstanceOf(StreamResponse::class, $response);
		$this->assertSame('text/javascript', $this->header($response, 'Content-Type'));
		$this->assertSame('10', $this->header($response, 'Content-Length'));
		$this->assertStringContainsString('immutable', (string)$this->header($response, 'Cache-Control'));
	}

	/**
	 * @return array<string, array{string, string}>
	 */
	public static function refused(): array {
		return [
			// An old URL must not be served the new engine as `immutable`.
			'other version' => ['4.7.6-engine.2', 'scoreview.mjs'],
			'name outside the list' => ['4.7.6-engine.3', 'package.json'],
			'path' => ['4.7.6-engine.3', '../../convert.mjs'],
			// Listed, but not installed: an installation state, not a 500.
			'listed but missing' => ['4.7.6-engine.3', 'scoreview.lib.wasm'],
		];
	}

	#[\PHPUnit\Framework\Attributes\DataProvider('refused')]
	public function testAnythingElseIs404(string $version, string $name): void {
		$response = $this->controller()->get($version, $name);

		$this->assertInstanceOf(JSONResponse::class, $response);
		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
	}
}
