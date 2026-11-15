<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;

/**
 * Caps how many conversions the visitors of ONE public link may start per
 * hour (S4). A visitor has no account, so the per-user limit does not apply,
 * and every run is a process of 130-250 MB paid for by the share owner.
 *
 * Only newly queued work is counted, never reading a cached result, so a
 * choir opening an already converted score never meets the limit.
 */
class ShareConversionQuota {
	public function __construct(
		private ILimiter $limiter,
		private FeatureConfig $features,
	) {
	}

	/**
	 * Registers one new conversion for the link; false when the hourly limit
	 * is used up.
	 *
	 * The limiter's anonymous variant stores its counters in the database
	 * when no memory cache is configured, so this works on every instance.
	 * Its "ip" slot carries the token digest on purpose: a whole choir sits
	 * behind one address, and the limit belongs to the link, not the visitor.
	 */
	public function consume(PublicShareGrant $grant): bool {
		try {
			$this->limiter->registerAnonRequest(
				'scoreview-share-conversion',
				$this->features->publicShareConversionsPerHour(),
				3600,
				'share:' . $grant->tokenDigest,
			);
		} catch (IRateLimitExceededException) {
			return false;
		}
		return true;
	}
}
