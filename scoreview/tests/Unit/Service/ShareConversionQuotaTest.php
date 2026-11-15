<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\PublicShareGrant;
use OCA\ScoreView\Service\ShareConversionQuota;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;
use PHPUnit\Framework\TestCase;

class ShareConversionQuotaTest extends TestCase {
	private function grant(): PublicShareGrant {
		return new PublicShareGrant('owner', null, false, 'abc123');
	}

	private function features(): FeatureConfig {
		$features = $this->createMock(FeatureConfig::class);
		$features->method('publicShareConversionsPerHour')->willReturn(7);
		return $features;
	}

	public function testQuotaUsesTokenNotIp(): void {
		$limiter = $this->createMock(ILimiter::class);
		$limiter->expects($this->once())->method('registerAnonRequest')
			->with('scoreview-share-conversion', 7, 3600, 'share:abc123');
		$this->assertTrue((new ShareConversionQuota($limiter, $this->features()))->consume($this->grant()));
	}

	public function testQuotaExceededReturnsFalse(): void {
		$limiter = $this->createMock(ILimiter::class);
		$limiter->method('registerAnonRequest')->willThrowException($this->createMock(IRateLimitExceededException::class));
		$this->assertFalse((new ShareConversionQuota($limiter, $this->features()))->consume($this->grant()));
	}
}
