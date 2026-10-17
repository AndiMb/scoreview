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
	 * Alle fileIds mit einem Cache-Eintrag - fuer den Aufraeum-Job.
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

	/**
	 * Ready conversions whose title, subtitle, composer or lyricist contain
	 * the term (E17). Newest first, so that a page of hits shows what was
	 * worked on last. One ready row per file: markReady() removes the older
	 * versions of a file (gcOldVersions).
	 *
	 * Access is NOT checked here - the table knows files, not people. The
	 * search provider resolves every hit in the searcher's own file tree and
	 * drops what is not there.
	 *
	 * @return ScoreConversion[]
	 */
	public function search(string $term, int $limit, int $offset): array {
		$qb = $this->db->getQueryBuilder();
		// `%` and `_` in the term are literal characters, not wildcards.
		$pattern = '%' . $this->db->escapeLikeParameter(mb_strtolower($term, 'UTF-8')) . '%';
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('status', $qb->createNamedParameter(ScoreConversion::STATUS_READY)))
			->andWhere($qb->expr()->like('search_text', $qb->createNamedParameter($pattern)))
			->orderBy('updated_at', 'DESC')
			->addOrderBy('id', 'DESC')
			->setMaxResults($limit)
			->setFirstResult($offset);
		return $this->findEntities($qb);
	}

	/**
	 * Ready conversions from before the search columns, in id order - for
	 * the repair step BackfillSearchText, which walks them in batches.
	 *
	 * @return ScoreConversion[]
	 */
	public function findReadyWithoutSearchText(int $afterId, int $limit): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('status', $qb->createNamedParameter(ScoreConversion::STATUS_READY)))
			->andWhere($qb->expr()->isNull('search_text'))
			->andWhere($qb->expr()->gt('id', $qb->createNamedParameter($afterId, IQueryBuilder::PARAM_INT)))
			->orderBy('id', 'ASC')
			->setMaxResults($limit);
		return $this->findEntities($qb);
	}
}
