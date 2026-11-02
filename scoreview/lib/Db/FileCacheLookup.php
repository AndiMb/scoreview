<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * Which of many fileIds still have a row in `filecache` - one query per
 * chunk instead of one `IRootFolder::getById()` per fileId.
 *
 * Only a pre-filter for BackgroundJob\CleanupOrphansJob, never the reason to
 * delete anything: a fileId that has a row here still exists somewhere,
 * including the trash bin (trashed files keep their row under
 * `files_trashbin/`). A fileId without a row cannot be resolved by
 * `getById()` either, but the job still confirms that before deleting.
 */
class FileCacheLookup {
	/**
	 * Oracle allows at most 1000 elements in an IN list; the other databases
	 * would take more, but one daily job does not need the last round trip.
	 */
	private const CHUNK = 1000;

	public function __construct(
		private IDBConnection $db,
	) {
	}

	/**
	 * @param int[] $fileIds
	 * @return int[] the subset that has a filecache row, in no particular order
	 */
	public function existingIds(array $fileIds): array {
		$found = [];
		foreach (array_chunk(array_values(array_unique($fileIds)), self::CHUNK) as $chunk) {
			$qb = $this->db->getQueryBuilder();
			$qb->select('fileid')
				->from('filecache')
				->where($qb->expr()->in('fileid', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)));
			$result = $qb->executeQuery();
			while (($row = $result->fetch()) !== false) {
				$found[] = (int)$row['fileid'];
			}
			$result->closeCursor();
		}
		return $found;
	}
}
