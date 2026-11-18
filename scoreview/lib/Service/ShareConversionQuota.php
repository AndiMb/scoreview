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
	/** What the status endpoints answer (429) once the link's allowance is spent. */
	public const ERROR_CODE = 'share_quota';

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
	 * Its "ip" slot carries a key derived from the token on purpose: a whole
	 * choir sits behind one address, and the limit belongs to the link, not
	 * the visitor.
	 */
	public function consume(PublicShareGrant $grant): bool {
		try {
			$this->limiter->registerAnonRequest(
				'scoreview-share-conversion',
				$this->features->publicShareConversionsPerHour(),
				3600,
				self::bucketAddress($grant->tokenDigest),
			);
		} catch (IRateLimitExceededException) {
			return false;
		}
		return true;
	}

	/**
	 * The limiter normalises its "ip" argument to a subnet before hashing it,
	 * and on NC 31 that normaliser has no guard for a string that is not an
	 * address (inet_pton() false -> TypeError, every request a 500). So the
	 * digest is folded into a syntactically valid IPv4 address: IPv4 is kept
	 * as a full /32 on every version, whereas an IPv6 address would be cut to
	 * the admin-configurable security.ipv6_normalized_subnet_size (down to
	 * 32 bits). 32 bits of SHA-256 keep distinct links in distinct buckets
	 * unless an instance has tens of thousands of active links; a collision
	 * would only make two links share one hourly allowance. The address is
	 * never contacted, and the identifier above keeps it apart from every
	 * other limiter that sees real addresses.
	 */
	public static function bucketAddress(string $tokenDigest): string {
		$bytes = substr(hash('sha256', 'scoreview-share:' . $tokenDigest, true), 0, 4);
		return implode('.', array_map('ord', str_split($bytes)));
	}
}
