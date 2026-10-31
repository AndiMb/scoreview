<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\SingRunMapper;
use OCP\AppFramework\Utility\ITimeFactory;

/**
 * Scored runs of one's own part (docs/architecture.md E24).
 *
 * **What a run scored** is decided in the browser (src/lib/singScore.js):
 * the server cannot hear anyone sing. It bounds what it is told, so a broken
 * or forged client writes no nonsense - more than self-deception it cannot
 * prevent, and more is not needed: nobody but the singer sees the numbers
 * (E20).
 *
 * **Measures are checked for form only** (1 … MAX_MEASURE, from ≤ to, both
 * or none): how many measures the piece has is known to the artifacts in
 * the browser, not here.
 */
class SingRunService {
	public const LEVELS = ['easy', 'choir', 'strict'];

	/** Runs kept per person, score, unit and level - enough for a long history. */
	public const KEEP_PER_UNIT = 200;

	/** Runs the history shows. */
	public const LIST_LIMIT = 50;

	public const MAX_MEASURE = 100000;

	/** As the player's tempo factor, 0.5 … 1.5 (usePlayback.js). */
	public const MIN_TEMPO_PCT = 50;
	public const MAX_TEMPO_PCT = 150;

	public function __construct(
		private SingRunMapper $runs,
		private ITimeFactory $time,
	) {
	}

	/**
	 * @param array{from?: ?int, to?: ?int, level?: string, tempoPct?: int, totalPct?: ?int, pitchPct?: ?int, onsetPct?: ?int, releasePct?: ?int, notesScored?: int} $input
	 * @throws \InvalidArgumentException a value out of its bounds
	 * @return array<string, mixed> the run as stored
	 */
	public function add(int $fileId, string $userId, array $input): array {
		$from = $input['from'] ?? null;
		$to = $input['to'] ?? null;
		if (($from === null) !== ($to === null)) {
			throw new \InvalidArgumentException('A range needs both measures.');
		}
		if ($from !== null && ($from < 1 || $to > self::MAX_MEASURE || $from > $to)) {
			throw new \InvalidArgumentException('Measures out of range.');
		}
		$level = $input['level'] ?? '';
		if (!in_array($level, self::LEVELS, true)) {
			throw new \InvalidArgumentException('Unknown level.');
		}
		$tempo = $input['tempoPct'] ?? 0;
		if ($tempo < self::MIN_TEMPO_PCT || $tempo > self::MAX_TEMPO_PCT) {
			throw new \InvalidArgumentException('Tempo out of range.');
		}
		$notes = $input['notesScored'] ?? 0;
		if ($notes < 1 || $notes > 100000) {
			throw new \InvalidArgumentException('No notes scored.');
		}
		$total = $input['totalPct'] ?? null;
		if ($total === null) {
			throw new \InvalidArgumentException('No total.');
		}
		foreach ([$total, $input['pitchPct'] ?? null, $input['onsetPct'] ?? null, $input['releasePct'] ?? null] as $pct) {
			if ($pct !== null && ($pct < 0 || $pct > 100)) {
				throw new \InvalidArgumentException('Percentage out of range.');
			}
		}
		$row = [
			'user_id' => $userId,
			'file_id' => $fileId,
			'from_measure' => $from,
			'to_measure' => $to,
			'level' => $level,
			'tempo_pct' => $tempo,
			'total_pct' => $total,
			'pitch_pct' => $input['pitchPct'] ?? null,
			'onset_pct' => $input['onsetPct'] ?? null,
			'release_pct' => $input['releasePct'] ?? null,
			'notes_scored' => $notes,
			'created_at' => $this->time->getTime(),
		];
		$this->runs->insert($row);
		$this->runs->trimUnit($userId, $fileId, $from, $to, $level, self::KEEP_PER_UNIT);
		return self::present($row);
	}

	/**
	 * @return array{runs: list<array<string, mixed>>, best: array<string, int>}
	 */
	public function list(int $fileId, string $userId, ?int $from, ?int $to, string $level): array {
		if ($from === null || $to === null) {
			$from = $to = null;
		}
		if (!in_array($level, self::LEVELS, true)) {
			return ['runs' => [], 'best' => []];
		}
		$rows = $this->runs->findForUnit($userId, $fileId, $from, $to, $level, self::LIST_LIMIT);
		$best = [];
		foreach ($this->runs->bestByTempo($userId, $fileId, $from, $to, $level) as $tempo => $value) {
			// String keys: PHP would send a list for 0..n, an object is what the browser looks up.
			$best[(string)$tempo] = $value;
		}
		return ['runs' => array_map([self::class, 'present'], $rows), 'best' => $best];
	}

	public function clear(int $fileId, string $userId): int {
		return $this->runs->deleteForFile($userId, $fileId);
	}

	/**
	 * @param array<string, mixed> $row
	 * @return array<string, mixed>
	 */
	private static function present(array $row): array {
		$int = static fn ($v) => $v === null ? null : (int)$v;
		return [
			'from' => $int($row['from_measure']),
			'to' => $int($row['to_measure']),
			'level' => (string)$row['level'],
			'tempoPct' => (int)$row['tempo_pct'],
			'totalPct' => (int)$row['total_pct'],
			'pitchPct' => $int($row['pitch_pct']),
			'onsetPct' => $int($row['onset_pct']),
			'releasePct' => $int($row['release_pct']),
			'notesScored' => (int)$row['notes_scored'],
			'createdAt' => (int)$row['created_at'],
		];
	}
}
