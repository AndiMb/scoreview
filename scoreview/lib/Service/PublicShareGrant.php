<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCP\Files\Node;

/**
 * What a valid share token allows: read access to one file (or to none yet,
 * when only the share itself was asked about), on behalf of the share owner.
 */
final class PublicShareGrant {
	public function __construct(
		/** Conversions are accounted to the owner - a visitor has no account. */
		public readonly string $ownerUid,
		/** The requested file inside the share; null when no fileId was given. */
		public readonly ?Node $node,
		/** "Hide download" on the link: the source file stays closed. */
		public readonly bool $hideDownload,
		/** sha256 of the token - quota key and log value, so the token itself is never stored. */
		public readonly string $tokenDigest,
	) {
	}
}
