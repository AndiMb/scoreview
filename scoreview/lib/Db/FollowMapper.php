<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\Entity;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * Schreibt ueber die fileId statt ueber `id`: Die Tabelle hat keine
 * `id`-Spalte, weil es je Datei hoechstens eine Sitzung gibt (siehe
 * FollowSession). QBMapper::insert() fragte danach die letzte
 * Autoincrement-ID ab - auf PostgreSQL ein Fehler ohne Sequenz -, und
 * update()/delete() filterten nach `id`. Beides ist deshalb hier ersetzt.
 *
 * @extends QBMapper<FollowSession>
 */
class FollowMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'scoreview_follow', FollowSession::class);
	}

	public function findByFileId(int $fileId): ?FollowSession {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/**
	 * @param FollowSession $entity
	 * @return FollowSession
	 */
	public function insert(Entity $entity): Entity {
		$qb = $this->db->getQueryBuilder();
		$qb->insert($this->getTableName());
		foreach (array_keys($entity->getUpdatedFields()) as $property) {
			$qb->setValue($entity->propertyToColumn($property), $this->parameter($qb, $entity, $property));
		}
		$qb->executeStatement();
		$entity->resetUpdatedFields();
		return $entity;
	}

	/**
	 * @param FollowSession $entity
	 * @return FollowSession
	 */
	public function update(Entity $entity): Entity {
		$fields = array_diff(array_keys($entity->getUpdatedFields()), ['fileId']);
		if ($fields === []) {
			return $entity;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName());
		foreach ($fields as $property) {
			$qb->set($entity->propertyToColumn($property), $this->parameter($qb, $entity, $property));
		}
		$qb->where($qb->expr()->eq('file_id', $qb->createNamedParameter($entity->getFileId(), IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
		$entity->resetUpdatedFields();
		return $entity;
	}

	/**
	 * Schreibt nur, wenn die Zeile noch die Version `$expected` traegt - ein
	 * Vergleichen-und-Tauschen in einer Anweisung. Zwei Leitungen, die im
	 * selben Augenblick senden, haetten sonst beide denselben Stand
	 * gelesen, beide ihre Aenderung daraufgesetzt, und die zweite haette die
	 * erste still ueberschrieben - samt eines Zaehlers, der dann doppelt
	 * vergeben waere und auf den Geraeten nichts ausloeste.
	 *
	 * @return bool ob geschrieben wurde; false heisst: neu lesen und nochmal
	 */
	public function updateIfVersion(FollowSession $entity, int $expected): bool {
		$fields = array_diff(array_keys($entity->getUpdatedFields()), ['fileId']);
		if ($fields === []) {
			return true;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName());
		foreach ($fields as $property) {
			$qb->set($entity->propertyToColumn($property), $this->parameter($qb, $entity, $property));
		}
		$qb->where($qb->expr()->eq('file_id', $qb->createNamedParameter($entity->getFileId(), IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('version', $qb->createNamedParameter($expected, IQueryBuilder::PARAM_INT)));
		$changed = $qb->executeStatement() > 0;
		if ($changed) {
			$entity->resetUpdatedFields();
		}
		return $changed;
	}

	/**
	 * Nur das Lebenszeichen, und nur, wenn die Zeile noch die gelesene
	 * Version traegt. Ein gewoehnliches Update nach dem Lesen liefe sonst
	 * auch dann, wenn die Sitzung inzwischen beendet oder neu begonnen wurde -
	 * und der Aufrufer hielte eine Sitzung fuer lebendig, die es nicht mehr
	 * gibt.
	 *
	 * @return bool ob die Zeile getroffen wurde
	 */
	public function touchIfVersion(int $fileId, int $expected, \DateTimeInterface $heartbeat): bool {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('heartbeat_at', $qb->createNamedParameter($heartbeat, IQueryBuilder::PARAM_DATE))
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('version', $qb->createNamedParameter($expected, IQueryBuilder::PARAM_INT)));
		return $qb->executeStatement() > 0;
	}

	/**
	 * Loescht die Zeile nur, wenn sie noch die gelesene Version traegt - fuer
	 * eine abgelaufene Sitzung, die gerade durch eine neue ersetzt wird. Ohne
	 * die Bedingung loeschte ein langsamer Start die Sitzung, die ein
	 * schnellerer Start derweil schon neu angelegt hat.
	 *
	 * @return int Zahl der geloeschten Zeilen
	 */
	public function deleteIfVersion(int $fileId, int $version): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('version', $qb->createNamedParameter($version, IQueryBuilder::PARAM_INT)));
		return $qb->executeStatement();
	}

	/**
	 * @param FollowSession $entity
	 * @return FollowSession
	 */
	public function delete(Entity $entity): Entity {
		$this->deleteByFileId($entity->getFileId());
		return $entity;
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
	 * Die Sitzungen, die eine geloeschte Person leitete. Ohne Leitung gibt es
	 * nichts mehr zu folgen - das ist dasselbe wie ein Sitzungsende.
	 *
	 * @return int Zahl der geloeschten Zeilen
	 */
	public function deleteByLeader(string $userId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('leader_uid', $qb->createNamedParameter($userId)));
		return $qb->executeStatement();
	}

	/**
	 * Sitzungen ohne Lebenszeichen seit `$cutoff` - beim Lesen gelten sie
	 * ohnehin als beendet (FollowSession::TIMEOUT_SECONDS), hier werden sie
	 * nur noch abgeraeumt.
	 *
	 * @return int Zahl der geloeschten Zeilen
	 */
	public function deleteHeartbeatBefore(\DateTimeInterface $cutoff): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->lt('heartbeat_at', $qb->createNamedParameter($cutoff, IQueryBuilder::PARAM_DATE)));
		return $qb->executeStatement();
	}

	/**
	 * @return int[]
	 */
	public function findAllFileIds(): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('file_id')->from($this->getTableName());
		$result = $qb->executeQuery();
		$ids = array_map(static fn (array $row) => (int)$row['file_id'], $result->fetchAll());
		$result->closeCursor();
		return $ids;
	}

	private function parameter(IQueryBuilder $qb, Entity $entity, string $property): mixed {
		$getter = 'get' . ucfirst($property);
		return $qb->createNamedParameter($entity->$getter(), $this->getParameterTypeForProperty($entity, $property));
	}
}
