<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * The key of a display variant (docs/architecture.md E19), on the server.
 *
 * The grammar is converter/lib/variantKey.mjs - the one the converter and the
 * viewer use - restated here because the key arrives in a URL and becomes a
 * folder name before any JavaScript sees it. tests/Unit/Service/
 * VariantKeyTest.php runs the same cases as variantKey.test.mjs; the two
 * must agree, or the viewer asks for keys the server refuses.
 *
 *     <source>~<format>~<pitch>~<transposition>
 *     source: full | ex<0..999> | part<[A-Za-z0-9_-]{1,40}>
 *     format: orig | phone | phonel
 *     pitch:  w | c
 *     transposition: -12 .. 12, written without sign for >= 0, no leading zero
 *
 * Only the canonical spelling is a key, and the neutral point of all four
 * axes is the base conversion, not a variant: either would be a second
 * address for the same bytes.
 */
final class VariantKey {
	public const BASE = 'full~orig~w~0';

	private const PATTERN = '/^(full|ex(0|[1-9][0-9]{0,2})|part([A-Za-z0-9_-]{1,40}))~(orig|phone|phonel)~(w|c)~(0|-?(?:[1-9]|1[0-2]))$/';

	/**
	 * The fields of a key; null for anything but a canonical variant key.
	 *
	 * @return ?array{source: string, excerpt: ?int, partId: ?string, format: string, pitch: string, transpose: int}
	 */
	public static function parse(string $key): ?array {
		if ($key === self::BASE || strlen($key) > 64 || preg_match(self::PATTERN, $key, $m) !== 1) {
			return null;
		}
		$excerpt = ($m[2] ?? '') !== '' ? (int)$m[2] : null;
		$partId = ($m[3] ?? '') !== '' ? $m[3] : null;
		return [
			'source' => $excerpt !== null ? 'ex' : ($partId !== null ? 'part' : 'full'),
			'excerpt' => $excerpt,
			'partId' => $partId,
			'format' => $m[4],
			'pitch' => $m[5],
			'transpose' => (int)$m[6],
		];
	}

	/**
	 * Whether the key names something this score has: a stored part it
	 * stores, a part id it has. Read from the base conversion's meta.json, so
	 * an unknown source is a 404 before any process starts.
	 *
	 * @param array{source: string, excerpt: ?int, partId: ?string} $parsed
	 * @param array<string, mixed> $meta
	 */
	public static function fitsScore(array $parsed, array $meta): bool {
		if ($parsed['source'] === 'ex') {
			$excerpts = is_array($meta['excerpts'] ?? null) ? $meta['excerpts'] : [];
			return $parsed['excerpt'] < count($excerpts);
		}
		if ($parsed['source'] === 'part') {
			foreach (is_array($meta['parts'] ?? null) ? $meta['parts'] : [] as $part) {
				if (is_array($part) && (string)($part['id'] ?? '') === $parsed['partId']) {
					return true;
				}
			}
			return false;
		}
		return true;
	}
}
