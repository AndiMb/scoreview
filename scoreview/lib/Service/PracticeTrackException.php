<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

class PracticeTrackException extends \RuntimeException {
	/** Kein Schreibrecht im Zielordner bzw. auf die vorhandene Datei (403). */
	public const FORBIDDEN = 'forbidden';
	/** Eine Datei dieses Namens gibt es schon, und ersetzt werden soll nicht (409). */
	public const EXISTS = 'exists';
	/** Unbrauchbarer Name oder Zielordner (400). */
	public const INVALID = 'invalid';
	/** Kein Platz mehr im Kontingent der Ordnerbesitzerin (507). */
	public const STORAGE_FULL = 'storage_full';

	public function __construct(
		private string $reason,
		private ?string $suggested = null,
	) {
		parent::__construct($reason);
	}

	public function getReason(): string {
		return $this->reason;
	}

	/** Bei EXISTS: ein freier Name, den der Browser anbieten kann. */
	public function getSuggested(): ?string {
		return $this->suggested;
	}
}
