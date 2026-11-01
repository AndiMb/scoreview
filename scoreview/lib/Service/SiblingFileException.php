<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Why a file next to the score could not be written - by SiblingFileService
 * and the services saving through it (practice tracks, PDF export). The
 * reason maps to one HTTP status in Controller\JsonErrors::refusedToSave().
 */
class SiblingFileException extends \RuntimeException {
	/** No write permission on the target folder or the existing file (403). */
	public const FORBIDDEN = 'forbidden';
	/** A file of this name exists and is not to be replaced (409). */
	public const EXISTS = 'exists';
	/** Unusable name or target folder (400). */
	public const INVALID = 'invalid';
	/** The folder owner's quota is used up (507). */
	public const STORAGE_FULL = 'storage_full';
	/** The file is locked (sync client) or its storage is offline (503). */
	public const BUSY = 'busy';

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
