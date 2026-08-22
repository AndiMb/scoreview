<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @extends QBMapper<ScoreConversion>
 */
class ScoreConversionMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'scoreview_conversions', ScoreConversion::class);
	}

	public function findByFileIdAndEtag(int $fileId, string $etag): ?ScoreConversion {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('etag', $qb->createNamedParameter($etag)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}
}
