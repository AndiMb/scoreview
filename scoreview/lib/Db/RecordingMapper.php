<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * Jede Abfrage ist an die Nutzerin gebunden, bis auf die des Aufraeum-Jobs:
 * Eine Aufnahme hoert nur, wer sie gemacht hat (S8 - fremd heisst 404, nicht
 * 403).
 *
 * @extends QBMapper<Recording>
 */
class RecordingMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'scoreview_recordings', Recording::class);
	}

	/**
	 * @return Recording[] die aelteste zuerst - sie ist die, die beim
	 *                     Erreichen der Obergrenze verdraengt wird
	 */
	public function findByFileAndUser(int $fileId, string $userId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->orderBy('created_at', 'ASC')
			->addOrderBy('id', 'ASC');
		return $this->findEntities($qb);
	}

	public function findOwn(int $id, int $fileId, string $userId): ?Recording {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/**
	 * Wer zu dieser Datei Aufnahmen hat - der Aufraeum-Job braucht das, weil
	 * die WAVs je Nutzerin in einem eigenen IAppData-Ordner liegen.
	 *
	 * @return string[]
	 */
	public function findUserIdsByFileId(int $fileId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct('user_id')
			->from($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)));
		$result = $qb->executeQuery();
		$ids = array_map(static fn (array $row) => (string)$row['user_id'], $result->fetchAll());
		$result->closeCursor();
		return $ids;
	}

	/**
	 * Belegter Speicher einer Nutzerin ueber alle Partituren - fuer die
	 * Grenze je Person (FeatureConfig::MAX_RECORDING_BYTES_PER_USER). Aus
	 * der Tabelle statt aus IAppData, weil ein Ordnerdurchlauf je Upload bei
	 * vielen Aufnahmen teuer waere und die Zeile ohnehin die Groesse traegt.
	 */
	public function sumSizeByUser(string $userId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->sum('size_bytes'))
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		return $this->scalar($qb);
	}

	/**
	 * Belegter Speicher aller Aufnahmen der Instanz
	 * (FeatureConfig::MAX_RECORDING_BYTES_TOTAL).
	 */
	public function sumSizeTotal(): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->sum('size_bytes'))->from($this->getTableName());
		return $this->scalar($qb);
	}

	private function scalar(IQueryBuilder $qb): int {
		$result = $qb->executeQuery();
		$value = $result->fetchOne();
		$result->closeCursor();
		return (int)($value ?? 0);
	}

	/**
	 * Ob eine Nutzerin ueberhaupt noch Aufnahmen hat - entscheidet, ob ihr
	 * Ordner in IAppData weg kann (Service\RecordingStorage). Aus der Tabelle,
	 * weil ISimpleFolder nur Dateien auflistet, keine Unterordner: ein leerer
	 * Nutzerordner laesst sich dort nicht von einem vollen unterscheiden.
	 */
	public function hasAnyForUser(string $userId): bool {
		$qb = $this->db->getQueryBuilder();
		$qb->select('id')
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->setMaxResults(1);
		$result = $qb->executeQuery();
		$found = $result->fetchOne() !== false;
		$result->closeCursor();
		return $found;
	}

	/**
	 * @return int Zahl der geloeschten Zeilen
	 */
	public function deleteByFileId(int $fileId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)));
		return $qb->executeStatement();
	}

	/**
	 * @return int Zahl der geloeschten Zeilen
	 */
	public function deleteByUserId(string $userId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		return $qb->executeStatement();
	}

	/**
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
}
