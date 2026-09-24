<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\AppFramework\Db\Entity;

/**
 * Eine ernannte Leitung einer Partitur (Migration
 * Version000100Date20260924100000). Die Eigentuemerin hat keinen Eintrag -
 * sie ist Leitung kraft Dateibaum und deshalb nicht abberufbar.
 *
 * Der Eintrag allein macht noch niemanden zur Leitung: Ohne Dateizugriff
 * zaehlt er nicht. So faellt die Rolle mit einer entzogenen Freigabe weg und
 * kommt mit ihr zurueck, ohne dass hier etwas geloescht werden muesste.
 *
 * @method int getFileId()
 * @method void setFileId(int $fileId)
 * @method string getUserId()
 * @method void setUserId(string $userId)
 * @method string getAppointedBy()
 * @method void setAppointedBy(string $appointedBy)
 * @method \DateTime getCreatedAt()
 * @method void setCreatedAt(\DateTime $createdAt)
 */
class Leader extends Entity {
	protected $fileId;
	protected $userId;
	protected $appointedBy;
	protected $createdAt;

	public function __construct() {
		$this->addType('fileId', 'integer');
		$this->addType('createdAt', 'datetime');
	}
}
