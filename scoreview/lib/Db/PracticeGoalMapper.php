<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * The weekly practice goal of a score (E20): one per score, set by a leader.
 * It belongs to the choir, not to the leader who set it - it stays when that
 * leader is revoked or their account goes, like a part annotation does.
 */
class PracticeGoalMapper {
	private const TABLE = 'scoreview_practice_goals';

	public function __construct(
		private IDBConnection $db,
	) {
	}

	/**
	 * @return ?array{minutesPerWeek: int, userId: string, updatedAt: string}
	 */
	public function find(int $fileId): ?array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('minutes_per_week', 'user_id', 'updated_at')
			->from(self::TABLE)
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		if ($row === false) {
			return null;
		}
		return [
			'minutesPerWeek' => (int)$row['minutes_per_week'],
			'userId' => (string)$row['user_id'],
			'updatedAt' => (string)$row['updated_at'],
		];
	}

	/**
	 * Replaces the goal: delete and insert, in one transaction. A second
	 * leader setting a goal at the same moment ends at the unique index and
	 * gets the error - the last one to try again wins, as with any edit.
	 */
	public function set(int $fileId, int $minutesPerWeek, string $userId, \DateTimeInterface $now): void {
		$this->db->beginTransaction();
		try {
			$this->deleteByFileId($fileId);
			$qb = $this->db->getQueryBuilder();
			$qb->insert(self::TABLE)
				->values([
					'file_id' => $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT),
					'minutes_per_week' => $qb->createNamedParameter($minutesPerWeek, IQueryBuilder::PARAM_INT),
					'user_id' => $qb->createNamedParameter($userId),
					'updated_at' => $qb->createNamedParameter($now, IQueryBuilder::PARAM_DATETIME_MUTABLE),
				]);
			$qb->executeStatement();
			$this->db->commit();
		} catch (\Throwable $e) {
			$this->db->rollBack();
			throw $e;
		}
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
}
