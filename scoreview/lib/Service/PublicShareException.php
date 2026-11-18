<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * A share token that does not open the requested score. The code is fixed
 * and goes to the client verbatim, so the viewer can tell "ask for the
 * password again" from "this link is gone" - and nothing more: which check
 * failed inside the share manager stays on the server.
 */
class PublicShareException extends \RuntimeException {
	/** The administration has not enabled scores on public links. */
	public const PUBLIC_DISABLED = 'public_disabled';
	/** Unknown, expired or deleted token, or a share type that is no public link. */
	public const SHARE_INVALID = 'share_invalid';
	/** Password-protected link that this session has not unlocked (or not since the password changed). */
	public const SHARE_AUTH = 'share_auth';
	/** A link without read permission, i.e. a file drop. */
	public const SHARE_NO_READ = 'share_no_read';
	/** The file is not part of the share, or is no score. */
	public const NOT_FOUND = 'not_found';

	private const STATUS = [
		self::PUBLIC_DISABLED => 401,
		self::SHARE_INVALID => 401,
		self::SHARE_AUTH => 401,
		self::SHARE_NO_READ => 403,
		self::NOT_FOUND => 404,
	];

	public function __construct(
		private string $errorCode,
	) {
		parent::__construct($errorCode);
	}

	public function getErrorCode(): string {
		return $this->errorCode;
	}

	public function getStatus(): int {
		return self::STATUS[$this->errorCode] ?? 401;
	}
}
