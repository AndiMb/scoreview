<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @extends QBMapper<ScoreVariant>
 */
class ScoreVariantMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'scoreview_variants', ScoreVariant::class);
	}

	public function findOne(int $fileId, string $etag, string $variant): ?ScoreVariant {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('etag', $qb->createNamedParameter($etag)))
			->andWhere($qb->expr()->eq('variant', $qb->createNamedParameter($variant)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/**
	 * The variants of one score version, least recently used first - the
	 * order the eviction removes them in.
	 *
	 * @return ScoreVariant[]
	 */
	public function findForVersion(int $fileId, string $etag): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('etag', $qb->createNamedParameter($etag)))
			->orderBy('accessed_at', 'ASC')
			->addOrderBy('id', 'ASC');
		return $this->findEntities($qb);
	}

	public function deleteForFile(int $fileId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}

	public function deleteForVersion(int $fileId, string $etag): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('etag', $qb->createNamedParameter($etag)));
		$qb->executeStatement();
	}
}
