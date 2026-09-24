<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\AppFramework\Db\Entity;

/**
 * Die laufende "Folgt mir"-Sitzung einer Partitur - hoechstens eine je Datei
 * (E10), deshalb ist die fileId selbst der Schluessel und es gibt keine
 * eigene `id`-Spalte. FollowMapper schreibt entsprechend ueber die fileId.
 *
 * `state` ist JSON mit Zaehlern (`position.seq`, `loop.seq`, `tone.seq`),
 * `version` steigt bei jeder Aenderung. Ein Geraet vergleicht nur die
 * Version und holt bei Abweichung den ganzen Zustand: Nachzuegler bekommen
 * so den letzten Stand, nichts wird nachgespielt.
 *
 * @method int getFileId()
 * @method void setFileId(int $fileId)
 * @method string getLeaderUid()
 * @method void setLeaderUid(string $leaderUid)
 * @method \DateTime getStartedAt()
 * @method void setStartedAt(\DateTime $startedAt)
 * @method \DateTime getHeartbeatAt()
 * @method void setHeartbeatAt(\DateTime $heartbeatAt)
 * @method int getVersion()
 * @method void setVersion(int $version)
 * @method ?string getState()
 * @method void setState(?string $state)
 */
class FollowSession extends Entity {
	/**
	 * Ohne Lebenszeichen der Leitung gilt eine Sitzung nach 30 Minuten als
	 * beendet. Beim Lesen wird sie dann als beendet gewertet, der
	 * Aufraeum-Job loescht die Zeile.
	 */
	public const TIMEOUT_SECONDS = 30 * 60;

	protected $fileId;
	protected $leaderUid;
	protected $startedAt;
	protected $heartbeatAt;
	protected $version = 0;
	protected $state;

	public function __construct() {
		$this->addType('fileId', 'integer');
		$this->addType('startedAt', 'datetime');
		$this->addType('heartbeatAt', 'datetime');
		$this->addType('version', 'integer');
	}
}
