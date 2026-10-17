<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\ViewerPolicy;
use OCP\AppFramework\Http\EmptyContentSecurityPolicy;
use OCP\IAppConfig;
use PHPUnit\Framework\TestCase;

/**
 * The one list of directives the viewer needs - shared by the Files page and
 * the app's own pages. What the policy string carries is what reaches the
 * browser, so that is what is checked.
 */
class ViewerPolicyTest extends TestCase {
	private function policy(string $soundFontUrl): ViewerPolicy {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')
			->with('scoreview', 'soundfont_url')
			->willReturn($soundFontUrl);
		return new ViewerPolicy($appConfig);
	}

	public function testAllowsWasmAlways(): void {
		$csp = new EmptyContentSecurityPolicy();
		$this->policy('')->apply($csp, false);
		$this->assertStringContainsString("'wasm-unsafe-eval'", $csp->buildPolicy());
	}

	public function testAddsBlobWorkersOnlyWhenAsked(): void {
		$without = new EmptyContentSecurityPolicy();
		$this->policy('')->apply($without, false);
		$this->assertStringNotContainsString('blob:', $without->buildPolicy());
		$this->assertStringNotContainsString('worker-src', $without->buildPolicy());

		$with = new EmptyContentSecurityPolicy();
		$this->policy('')->apply($with, true);
		$this->assertStringContainsString("worker-src 'self' blob:", $with->buildPolicy());
		$this->assertMatchesRegularExpression('/connect-src [^;]*blob:/', $with->buildPolicy());
	}

	public function testFullPageCarriesTheSameDirectives(): void {
		$csp = $this->policy('https://cdn.example.org:8443/gm.sf3')->forPage(true)->buildPolicy();
		$this->assertStringContainsString("'wasm-unsafe-eval'", $csp);
		$this->assertMatchesRegularExpression("/worker-src [^;]*'self'[^;]*blob:/", $csp);
		$this->assertMatchesRegularExpression('#connect-src [^;]*https://cdn\.example\.org:8443#', $csp);
	}

	public function testSoundFontOriginIsSchemeAndHostOnly(): void {
		$this->assertSame('https://a.example', $this->policy('https://a.example/x.sf2')->soundFontOrigin());
		$this->assertSame('http://a.example:8080', $this->policy('http://a.example:8080/x.sf2')->soundFontOrigin());
		$this->assertNull($this->policy('')->soundFontOrigin());
		$this->assertNull($this->policy('/apps/scoreview/api/soundfont')->soundFontOrigin());
		$this->assertNull($this->policy('javascript:alert(1)')->soundFontOrigin());
		$this->assertNull($this->policy('cdn.example.org/gm.sf3')->soundFontOrigin());
	}
}
