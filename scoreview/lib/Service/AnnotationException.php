<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * A refused note or stamp. Like FollowException and LeaderException a fixed
 * code instead of a text: Controller\AnnotationController maps it to a
 * status and a translated message, the service and the validator know
 * neither HTTP nor IL10N.
 *
 * Its own class so that the controller catches exactly this: an unrelated
 * RuntimeException from below (the database, a storage) must surface as the
 * error it is, not read as "forbidden".
 */
class AnnotationException extends \RuntimeException {
	/** Visible, but not to be changed by this person (403). */
	public const FORBIDDEN = 'forbidden';
	/** The person has MAX_PER_USER_AND_FILE notes on this score already (409). */
	public const LIMIT = 'limit';
	/** A text note without text (400). */
	public const EMPTY = 'empty';
	/** Longer than AnnotationValidator::MAX_CONTENT_LENGTH (400). */
	public const TOO_LONG = 'too_long';
	/** A loop without an end at or after its start (400). */
	public const INVALID_LOOP = 'invalid_loop';
	/** A drawing that is not the JSON of E22 or breaks its bounds (400). */
	public const INVALID_DRAWING = 'invalid_drawing';
	/** A stamp code outside Annotation::STAMPS (400). */
	public const UNKNOWN_STAMP = 'unknown_stamp';
	/** An anchor etag longer than its column (400). */
	public const INVALID_ANCHOR = 'invalid_anchor';
	/** No valid voice left in the list of target parts (400). */
	public const NO_TARGET_PARTS = 'no_target_parts';

	public function __construct(
		private string $reason,
	) {
		parent::__construct($reason);
	}

	public function getReason(): string {
		return $this->reason;
	}
}
