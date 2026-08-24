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

	/**
	 * Alle fileIds mit einem Cache-Eintrag - fuer den Aufraeum-Job
	 * (Codereview-Befund A4).
	 *
	 * @return int[]
	 */
	public function findAllFileIds(): array {
		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct('file_id')->from($this->getTableName());
		$result = $qb->executeQuery();
		$ids = array_map(static fn (array $row) => (int)$row['file_id'], $result->fetchAll());
		$result->closeCursor();
		return $ids;
	}

	/**
	 * Fuer die Cache-GC alter etag-Versionen einer Datei (siehe
	 * ConversionService::gcOldVersions) - Verzeichnisauflistung ueber
	 * ISimpleFolder liefert keine Unterordner, daher hier ueber die DB.
	 *
	 * @return ScoreConversion[]
	 */
	public function findAllByFileId(int $fileId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)));
		return $this->findEntities($qb);
	}
}
