<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * Scored runs per person, score, range of measures and level (E24). Every
 * query that reads is bound to the person, as for the practice log (E20):
 * nobody else sees them, leaders included.
 *
 * A unit is `(from, to)`, both null for the whole piece.
 */
class SingRunMapper {
	private const TABLE = 'scoreview_sing_runs';

	public function __construct(
		private IDBConnection $db,
	) {
	}

	/**
	 * @param array<string, int|string|null> $row column => value
	 */
	public function insert(array $row): int {
		$qb = $this->db->getQueryBuilder();
		$values = [];
		foreach ($row as $column => $value) {
			$type = match (true) {
				$value === null => IQueryBuilder::PARAM_NULL,
				is_int($value) => IQueryBuilder::PARAM_INT,
				default => IQueryBuilder::PARAM_STR,
			};
			$values[$column] = $qb->createNamedParameter($value, $type);
		}
		$qb->insert(self::TABLE)->values($values);
		$qb->executeStatement();
		return $qb->getLastInsertId();
	}

	/**
	 * Newest first.
	 *
	 * @return list<array<string, mixed>>
	 */
	public function findForUnit(string $userId, int $fileId, ?int $from, ?int $to, string $level, int $limit): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from(self::TABLE);
		$this->whereUnit($qb, $userId, $fileId, $from, $to, $level);
		$qb->orderBy('id', 'DESC')->setMaxResults($limit);
		$result = $qb->executeQuery();
		$rows = $result->fetchAll();
		$result->closeCursor();
		return $rows;
	}

	/**
	 * The best total per tempo, over every kept run of the unit.
	 *
	 * @return array<int, int> tempo_pct => best total_pct
	 */
	public function bestByTempo(string $userId, int $fileId, ?int $from, ?int $to, string $level): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('tempo_pct')
			->selectAlias($qb->func()->max('total_pct'), 'best')
			->from(self::TABLE);
		$this->whereUnit($qb, $userId, $fileId, $from, $to, $level);
		$qb->groupBy('tempo_pct');
		$result = $qb->executeQuery();
		$best = [];
		while (($row = $result->fetch()) !== false) {
			$best[(int)$row['tempo_pct']] = (int)$row['best'];
		}
		$result->closeCursor();
		return $best;
	}

	/**
	 * Keeps the newest `$keep` runs of a unit.
	 */
	public function trimUnit(string $userId, int $fileId, ?int $from, ?int $to, string $level, int $keep): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select('id')->from(self::TABLE);
		$this->whereUnit($qb, $userId, $fileId, $from, $to, $level);
		$qb->orderBy('id', 'DESC')->setFirstResult($keep)->setMaxResults(1);
		$result = $qb->executeQuery();
		$firstDropped = $result->fetchOne();
		$result->closeCursor();
		if ($firstDropped === false) {
			return 0;
		}
		$delete = $this->db->getQueryBuilder();
		$delete->delete(self::TABLE);
		$this->whereUnit($delete, $userId, $fileId, $from, $to, $level);
		$delete->andWhere($delete->expr()->lte('id', $delete->createNamedParameter((int)$firstDropped, IQueryBuilder::PARAM_INT)));
		return $delete->executeStatement();
	}

	/**
	 * One person's runs of one score: "delete my results".
	 */
	public function deleteForFile(string $userId, int $fileId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete(self::TABLE)
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)));
		return $qb->executeStatement();
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

	private function whereUnit(IQueryBuilder $qb, string $userId, int $fileId, ?int $from, ?int $to, string $level): void {
		$qb->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('level', $qb->createNamedParameter($level)));
		if ($from === null || $to === null) {
			$qb->andWhere($qb->expr()->isNull('from_measure'))
				->andWhere($qb->expr()->isNull('to_measure'));
		} else {
			$qb->andWhere($qb->expr()->eq('from_measure', $qb->createNamedParameter($from, IQueryBuilder::PARAM_INT)))
				->andWhere($qb->expr()->eq('to_measure', $qb->createNamedParameter($to, IQueryBuilder::PARAM_INT)));
		}
	}
}
