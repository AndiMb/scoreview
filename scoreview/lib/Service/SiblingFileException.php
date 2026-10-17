<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Why a file next to the score could not be written (SiblingFileService).
 * The reasons are those of PracticeTrackException, which predates this
 * class and keeps its own name for the practice-track API.
 */
class SiblingFileException extends \RuntimeException {
	public const FORBIDDEN = PracticeTrackException::FORBIDDEN;
	public const EXISTS = PracticeTrackException::EXISTS;
	public const INVALID = PracticeTrackException::INVALID;
	public const STORAGE_FULL = PracticeTrackException::STORAGE_FULL;
	public const BUSY = PracticeTrackException::BUSY;

	public function __construct(
		private string $reason,
		private ?string $suggested = null,
	) {
		parent::__construct($reason);
	}

	public function getReason(): string {
		return $this->reason;
	}

	/** With EXISTS: a free name the browser can offer. */
	public function getSuggested(): ?string {
		return $this->suggested;
	}
}
