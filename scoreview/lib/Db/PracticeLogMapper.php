<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\DB\Exception as DbException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * Seconds practised per person, score and day (E20). Every query that reads
 * is bound to the person: the log is nobody's business but the singer's -
 * leaders included, the same rule as for recordings (S8).
 *
 * Without an entity: a row is three keys and a counter, and the one write
 * is "add to it", which an entity would turn into read, change, write.
 */
class PracticeLogMapper {
	private const TABLE = 'scoreview_practice_log';

	public function __construct(
		private IDBConnection $db,
	) {
	}

	/**
	 * Adds seconds to a day, capped at `$maxPerDay`. Update first, insert
	 * when there was nothing to update: the usual call adds to a row that
	 * exists. Two first reports of a day at once meet at the unique index -
	 * the loser of the insert updates instead of failing.
	 *
	 * @return int the day's total after adding
	 */
	public function addSeconds(string $userId, int $fileId, string $day, int $seconds, int $maxPerDay): int {
		if ($this->increment($userId, $fileId, $day, $seconds, $maxPerDay) === 0) {
			try {
				$qb = $this->db->getQueryBuilder();
				$qb->insert(self::TABLE)
					->values([
						'user_id' => $qb->createNamedParameter($userId),
						'file_id' => $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT),
						'day' => $qb->createNamedParameter($day),
						'seconds' => $qb->createNamedParameter(min($seconds, $maxPerDay), IQueryBuilder::PARAM_INT),
					]);
				$qb->executeStatement();
			} catch (DbException $e) {
				if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
					throw $e;
				}
				$this->increment($userId, $fileId, $day, $seconds, $maxPerDay);
			}
		}
		return $this->secondsOn($userId, $fileId, $day);
	}

	/**
	 * The cap is applied in PHP after reading, not in SQL: LEAST() is spelled
	 * differently across the supported databases. A race between the read and
	 * the write can push one day past the cap by one report - harmless for a
	 * number that only the singer sees.
	 */
	private function increment(string $userId, int $fileId, string $day, int $seconds, int $maxPerDay): int {
		$current = $this->secondsOrNull($userId, $fileId, $day);
		if ($current === null) {
			return 0;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->update(self::TABLE)
			->set('seconds', $qb->createNamedParameter(min($maxPerDay, $current + $seconds), IQueryBuilder::PARAM_INT))
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('day', $qb->createNamedParameter($day)));
		$qb->executeStatement();
		return 1;
	}

	private function secondsOn(string $userId, int $fileId, string $day): int {
		return $this->secondsOrNull($userId, $fileId, $day) ?? 0;
	}

	private function secondsOrNull(string $userId, int $fileId, string $day): ?int {
		$qb = $this->db->getQueryBuilder();
		$qb->select('seconds')
			->from(self::TABLE)
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('day', $qb->createNamedParameter($day)));
		$result = $qb->executeQuery();
		$value = $result->fetchOne();
		$result->closeCursor();
		return $value === false ? null : (int)$value;
	}

	/**
	 * Days from `$fromDay` on (inclusive). The day is `YYYY-MM-DD`, so the
	 * string comparison is the calendar order.
	 *
	 * @return array<string, int> day => seconds, ascending
	 */
	public function findDays(string $userId, int $fileId, string $fromDay): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('day', 'seconds')
			->from(self::TABLE)
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->gte('day', $qb->createNamedParameter($fromDay)))
			->orderBy('day', 'ASC');
		$result = $qb->executeQuery();
		$days = [];
		while (($row = $result->fetch()) !== false) {
			$days[(string)$row['day']] = (int)$row['seconds'];
		}
		$result->closeCursor();
		return $days;
	}

	/**
	 * Days practised on any score from `$fromDay` on - for the streak, which
	 * counts practising, not practising this one piece.
	 *
	 * @return string[] ascending, each day once
	 */
	public function findActiveDays(string $userId, string $fromDay): array {
		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct('day')
			->from(self::TABLE)
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->gte('day', $qb->createNamedParameter($fromDay)))
			->andWhere($qb->expr()->gt('seconds', $qb->createNamedParameter(0, IQueryBuilder::PARAM_INT)))
			->orderBy('day', 'ASC');
		$result = $qb->executeQuery();
		$days = array_map(static fn (array $row) => (string)$row['day'], $result->fetchAll());
		$result->closeCursor();
		return $days;
	}

	/**
	 * @return int[]
	 */
	public function findAllFileIds(): array {
		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct('file_id')->from(self::TABLE);
		$result = $qb->executeQuery();
		$ids = array_map(static fn (array $row) => (int)$row['file_id'], $result->fetchAll());
		$result->closeCursor();
		return $ids;
	}

	public function deleteByFileId(int $fileId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete(self::TABLE)
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)));
		return $qb->executeStatement();
	}

	public function deleteByUserId(string $userId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete(self::TABLE)
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		return $qb->executeStatement();
	}

	/**
	 * Days before `$day` - the cleanup job keeps a bounded history.
	 */
	public function deleteBefore(string $day): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete(self::TABLE)
			->where($qb->expr()->lt('day', $qb->createNamedParameter($day)));
		return $qb->executeStatement();
	}
}
