<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * The parts something is addressed to - a part annotation (B2) or a leader's
 * recording (E21) - as checked JSON `[{id, name}]`.
 *
 * Every part comes with id AND name: whether MuseScore's part id survives a
 * re-upload is not established, so the viewer matches by id first, then by
 * name (src/lib/annotationFilter.js). Duplicates are dropped, so the limit
 * cannot be used up with repeats.
 */
final class TargetParts {
	/**
	 * Bounds for the list. The column is TEXT and goes out with every
	 * listing; without bounds a single row would carry any amount. 64 parts
	 * cover any choir or orchestra score; MuseScore's part ids are short
	 * numbers, 64 characters are plenty, 128 for a part's name as well.
	 */
	public const MAX_PARTS = 64;
	public const MAX_ID_LENGTH = 64;
	public const MAX_NAME_LENGTH = 128;

	/**
	 * @param mixed $targetParts
	 * @return ?string null when no valid part is left or the list breaks
	 *                 the bounds
	 */
	public static function normalize(mixed $targetParts): ?string {
		if (!is_array($targetParts) || count($targetParts) === 0 || count($targetParts) > self::MAX_PARTS) {
			return null;
		}
		$result = [];
		$seen = [];
		foreach ($targetParts as $part) {
			if (!is_array($part)) {
				return null;
			}
			$id = $part['id'] ?? null;
			$name = $part['name'] ?? '';
			if (is_int($id)) {
				$id = (string)$id;
			}
			if (!is_string($id) || $id === '' || mb_strlen($id) > self::MAX_ID_LENGTH
				|| !is_string($name) || mb_strlen($name) > self::MAX_NAME_LENGTH) {
				return null;
			}
			if (isset($seen[$id])) {
				continue;
			}
			$seen[$id] = true;
			$result[] = ['id' => $id, 'name' => $name];
		}
		return json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
	}

	/**
	 * The stored JSON as a list. An unreadable column becomes an empty list
	 * rather than an error - one broken row must not take the listing along.
	 *
	 * @return list<array{id: string, name: string}>
	 */
	public static function decode(?string $json): array {
		if ($json === null || $json === '') {
			return [];
		}
		$decoded = json_decode($json, true);
		return is_array($decoded) ? array_values($decoded) : [];
	}
}
