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
	 * Alles, was eine Nutzerin zu dieser Datei sehen darf (Phase 18): die
	 * eigenen privaten Notizen PLUS alle geteilten Notizen dieser Datei
	 * (unabhängig davon, wer sie angelegt hat - "geteilt" heißt für jeden
	 * mit Dateizugriff sichtbar, siehe PLAN.md Phase 18).
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
	 * Nur ueber Datei-ID gefiltert, bewusst OHNE Owner-Einschraenkung (anders
	 * als der bisherige Name suggerieren wuerde) - seit Phase 18 duerfen
	 * geteilte Notizen von JEDER Nutzerin mit Schreibrecht auf die Datei
	 * geaendert werden, nicht nur von der Autorin. Die eigentliche
	 * Zugriffsentscheidung (Owner bei privat, Schreibrecht bei geteilt)
	 * trifft AnnotationService::canModify(), nicht diese Abfrage - sie liefert
	 * nur "existiert diese ID zu dieser Datei ueberhaupt".
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
