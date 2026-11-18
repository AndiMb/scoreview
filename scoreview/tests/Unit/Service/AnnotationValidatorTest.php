<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\Annotation;
use OCA\ScoreView\Service\AnnotationException;
use OCA\ScoreView\Service\AnnotationValidator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The rules a note must meet, without a controller around them: each case
 * ends in exactly one code, and what passes passes for every caller - the
 * HTTP mapping is AnnotationControllerTest's.
 */
class AnnotationValidatorTest extends TestCase {
	private static function drawing(array $strokes, mixed $part = null): string {
		return json_encode(['v' => 1, 'part' => $part, 's' => $strokes]);
	}

	/**
	 * @return array<string, array{string, int, ?int, string, ?string, ?string, ?string}>
	 */
	public static function cases(): array {
		$tooLong = str_repeat('a', AnnotationValidator::MAX_CONTENT_LENGTH + 1);
		return [
			'text' => [Annotation::KIND_TEXT, 3, null, 'Atmen', null, null, null],
			'text with umlauts at the limit' => [Annotation::KIND_TEXT, 3, null, str_repeat('ü', AnnotationValidator::MAX_CONTENT_LENGTH), null, null, null],
			'empty text' => [Annotation::KIND_TEXT, 3, null, " \n", null, null, AnnotationException::EMPTY],
			'text too long' => [Annotation::KIND_TEXT, 3, null, $tooLong, null, null, AnnotationException::TOO_LONG],
			'stamp without text' => [Annotation::KIND_STAMP, 3, null, '', Annotation::STAMPS[0], null, null],
			'unknown stamp' => [Annotation::KIND_STAMP, 3, null, '', 'BREATH', null, AnnotationException::UNKNOWN_STAMP],
			'stamp text too long' => [Annotation::KIND_STAMP, 3, null, $tooLong, Annotation::STAMPS[0], null, AnnotationException::TOO_LONG],
			'loop' => [Annotation::KIND_LOOP, 3, 5, '', null, null, null],
			'loop of one measure' => [Annotation::KIND_LOOP, 3, 3, '', null, null, null],
			'loop ending before it starts' => [Annotation::KIND_LOOP, 3, 2, '', null, null, AnnotationException::INVALID_LOOP],
			'loop without end' => [Annotation::KIND_LOOP, 3, null, '', null, null, AnnotationException::INVALID_LOOP],
			'drawing' => [Annotation::KIND_DRAWING, 3, null, self::drawing([[0, 0, 1.5, -2]]), null, null, null],
			'drawing for a part' => [Annotation::KIND_DRAWING, 3, null, self::drawing([[0, 0, 1, 1]], ['id' => '3', 'name' => 'Bass']), null, null, null],
			'drawing as markup' => [Annotation::KIND_DRAWING, 3, null, '<svg onload=alert(1)>', null, null, AnnotationException::INVALID_DRAWING],
			'drawing too far out' => [Annotation::KIND_DRAWING, 3, null, self::drawing([[0, 0, 401, 1]]), null, null, AnnotationException::INVALID_DRAWING],
			'drawing with text' => [Annotation::KIND_DRAWING, 3, null, self::drawing([[0, 0, '1', 1]]), null, null, AnnotationException::INVALID_DRAWING],
			'anchor etag too long' => [Annotation::KIND_TEXT, 3, null, 'x', null, str_repeat('e', 65), AnnotationException::INVALID_ANCHOR],
			'anchor etag at the limit' => [Annotation::KIND_TEXT, 3, null, 'x', null, str_repeat('e', 64), null],
		];
	}

	#[DataProvider('cases')]
	public function testForCreate(string $kind, int $measure, ?int $end, string $content, ?string $stamp, ?string $anchorEtag, ?string $refusal): void {
		try {
			AnnotationValidator::forCreate($kind, $measure, $end, $content, $stamp, $anchorEtag);
			$this->assertNull($refusal, 'expected a refusal');
		} catch (AnnotationException $e) {
			$this->assertSame($refusal, $e->getReason());
		}
	}

	public function testAnUnknownKindIsAText(): void {
		$this->assertSame(Annotation::KIND_TEXT, AnnotationValidator::kind('picture'));
		$this->assertSame(Annotation::KIND_LOOP, AnnotationValidator::kind(Annotation::KIND_LOOP));
	}

	public function testTargetPartsAreNormalisedOrRefused(): void {
		$this->assertSame('[{"id":"3","name":"Bass"}]', AnnotationValidator::targetParts([['id' => '3', 'name' => 'Bass']]));
		$this->expectExceptionObject(new AnnotationException(AnnotationException::NO_TARGET_PARTS));
		AnnotationValidator::targetParts([]);
	}
}
