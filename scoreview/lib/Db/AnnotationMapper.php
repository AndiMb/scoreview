<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @extends QBMapper<Annotation>
 */
class AnnotationMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'scoreview_annotations', Annotation::class);
	}

	/**
	 * Alles, was eine Nutzerin zu dieser Datei sehen darf: die eigenen
	 * privaten Notizen PLUS alle geteilten Notizen dieser Datei
	 * (unabhängig davon, wer sie angelegt hat - "geteilt" heißt für jeden
	 * mit Dateizugriff sichtbar).
	 *
	 * @return Annotation[]
	 */
	public function findVisibleForUser(int $fileId, string $userId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->orX(
				$qb->expr()->eq('user_id', $qb->createNamedParameter($userId)),
				$qb->expr()->eq('visibility', $qb->createNamedParameter(Annotation::VISIBILITY_SHARED)),
			))
			->orderBy('measure_number', 'ASC')
			->addOrderBy('fraction', 'ASC');
		return $this->findEntities($qb);
	}

	/**
	 * Alle Notizen zu einer Datei loeschen.
	 *
	 * Bewusst NICHT an NodeDeletedEvent gehaengt: dieses Ereignis feuert schon
	 * beim Verschieben in den Papierkorb (an der Testinstanz nachgemessen -
	 * die Datei behaelt dort ihre fileId und laesst sich wiederherstellen).
	 * Notizen dort zu loeschen waere ein unumkehrbarer Verlust fuer eine
	 * umkehrbare Handlung. Aufgerufen wird das hier deshalb nur aus
	 * BackgroundJob\CleanupOrphansJob, wenn die fileId nirgends mehr existiert
	 * - auch nicht im Papierkorb.
	 *
	 * @return int Zahl der geloeschten Zeilen
	 */
	public function deleteByFileId(int $fileId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)));
		return $qb->executeStatement();
	}

	/**
	 * Alle Notizen einer Nutzerin loeschen - fuer UserDeletedEvent. Anders
	 * als beim Papierkorb-Fall oben ist das eindeutig: das Konto ist weg,
	 * seine Inhalte haben in der Datenbank nichts mehr verloren.
	 *
	 * @return int Zahl der geloeschten Zeilen
	 */
	public function deleteByUserId(string $userId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		return $qb->executeStatement();
	}

	/**
	 * Alle fileIds, zu denen es ueberhaupt Notizen gibt - fuer den
	 * Aufraeum-Job, damit er nicht die ganze Tabelle laden muss.
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
	 * Nur ueber Datei-ID gefiltert, bewusst OHNE Owner-Einschraenkung (anders
	 * als der bisherige Name suggerieren wuerde) - geteilte Notizen duerfen
	 * von JEDER Nutzerin mit Schreibrecht auf die Datei geaendert werden,
	 * nicht nur von der Autorin. Die eigentliche
	 * Zugriffsentscheidung (Owner bei privat, Schreibrecht bei geteilt) treffen
	 * AnnotationService::updateContent()/delete() anhand des von
	 * AnnotationController::canWriteShared() durchgereichten Rechts, nicht
	 * diese Abfrage - sie liefert nur "existiert diese ID zu dieser Datei
	 * ueberhaupt".
	 */
	public function findByIdAndFileId(int $id, int $fileId): ?Annotation {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}
}
