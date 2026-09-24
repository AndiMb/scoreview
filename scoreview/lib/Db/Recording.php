<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\AppFramework\Db\Entity;

/**
 * Die Metadaten einer eigenen Aufnahme. Die WAV selbst liegt in IAppData
 * (Service\RecordingStorage), nicht in Files: Nur die Aufnehmende hoert sie,
 * und sie soll nicht als Datei in fremden Freigaben auftauchen.
 *
 * `scoreStartMs` ist die Partiturzeit des ersten Samples, schon um Aus- und
 * Eingangslatenz korrigiert - damit die Aufnahme beim Abspielen am
 * richtigen Takt anliegt.
 *
 * @method int getFileId()
 * @method void setFileId(int $fileId)
 * @method string getUserId()
 * @method void setUserId(string $userId)
 * @method \DateTime getCreatedAt()
 * @method void setCreatedAt(\DateTime $createdAt)
 * @method int getDurationMs()
 * @method void setDurationMs(int $durationMs)
 * @method int getSizeBytes()
 * @method void setSizeBytes(int $sizeBytes)
 * @method int getScoreStartMs()
 * @method void setScoreStartMs(int $scoreStartMs)
 * @method float getTempoFactor()
 * @method void setTempoFactor(float $tempoFactor)
 * @method ?bool getWithAccompaniment()
 * @method void setWithAccompaniment(?bool $withAccompaniment)
 */
class Recording extends Entity {
	protected $fileId;
	protected $userId;
	protected $createdAt;
	protected $durationMs = 0;
	protected $sizeBytes = 0;
	protected $scoreStartMs = 0;
	protected $tempoFactor = 1.0;
	protected $withAccompaniment = false;

	public function __construct() {
		$this->addType('fileId', 'integer');
		$this->addType('createdAt', 'datetime');
		$this->addType('durationMs', 'integer');
		$this->addType('sizeBytes', 'integer');
		$this->addType('scoreStartMs', 'integer');
		$this->addType('tempoFactor', 'float');
		$this->addType('withAccompaniment', 'boolean');
	}
}
