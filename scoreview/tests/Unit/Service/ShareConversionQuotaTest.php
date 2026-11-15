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
			->with('scoreview-share-conversion', 7, 3600, ShareConversionQuota::bucketAddress('abc123'));
		$this->assertTrue((new ShareConversionQuota($limiter, $this->features()))->consume($this->grant()));
	}

	/**
	 * NC 31's IpAddress::getSubnet() throws a TypeError on anything inet_pton()
	 * rejects, so the bucket key must be a real IPv4 address (kept whole as
	 * /32 on every version), stable per link and different between links.
	 */
	public function testBucketKeyIsAValidIpv4StablePerToken(): void {
		$seen = [];
		$limiter = $this->createMock(ILimiter::class);
		$limiter->method('registerAnonRequest')->willReturnCallback(
			function (string $id, int $limit, int $period, string $ip) use (&$seen): void {
				$seen[] = $ip;
			},
		);
		$quota = new ShareConversionQuota($limiter, $this->features());
		$quota->consume(new PublicShareGrant('owner', null, false, hash('sha256', 'tokenA')));
		$quota->consume(new PublicShareGrant('owner', null, false, hash('sha256', 'tokenA')));
		$quota->consume(new PublicShareGrant('owner', null, false, hash('sha256', 'tokenB')));

		$this->assertCount(3, $seen);
		foreach ($seen as $ip) {
			$this->assertNotFalse(filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4), $ip);
			$this->assertNotFalse(inet_pton($ip));
		}
		$this->assertSame($seen[0], $seen[1]);
		$this->assertNotSame($seen[0], $seen[2]);

		$buckets = [];
		for ($i = 0; $i < 2000; $i++) {
			$buckets[ShareConversionQuota::bucketAddress(hash('sha256', 'token' . $i))] = true;
		}
		$this->assertCount(2000, $buckets);
	}

	public function testQuotaExceededReturnsFalse(): void {
		$limiter = $this->createMock(ILimiter::class);
		$limiter->method('registerAnonRequest')->willThrowException($this->createMock(IRateLimitExceededException::class));
		$this->assertFalse((new ShareConversionQuota($limiter, $this->features()))->consume($this->grant()));
	}
}
