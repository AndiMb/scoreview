<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\AppFramework\Db\Entity;

/**
 * Private Notiz einer Nutzerin zu einer musikalischen Position (siehe
 * Migration\Version000100Date20260823130000 für das Anker-Design).
 *
 * @method int getFileId()
 * @method void setFileId(int $fileId)
 * @method string getUserId()
 * @method void setUserId(string $userId)
 * @method int getMeasureNumber()
 * @method void setMeasureNumber(int $measureNumber)
 * @method float getFraction()
 * @method void setFraction(float $fraction)
 * @method ?int getElid()
 * @method void setElid(?int $elid)
 * @method ?string getAnchorEtag()
 * @method void setAnchorEtag(?string $anchorEtag)
 * @method string getVisibility()
 * @method void setVisibility(string $visibility)
 * @method string getContent()
 * @method void setContent(string $content)
 * @method \DateTime getCreatedAt()
 * @method void setCreatedAt(\DateTime $createdAt)
 * @method \DateTime getUpdatedAt()
 * @method void setUpdatedAt(\DateTime $updatedAt)
 */
class Annotation extends Entity implements \JsonSerializable {
	public const VISIBILITY_PRIVATE = 'private';
	public const VISIBILITY_SHARED = 'shared';

	protected $fileId;
	protected $userId;
	protected $measureNumber;
	protected $fraction;
	protected $elid;
	protected $anchorEtag;
	protected $visibility;
	protected $content;
	protected $createdAt;
	protected $updatedAt;

	public function __construct() {
		$this->addType('fileId', 'integer');
		$this->addType('measureNumber', 'integer');
		$this->addType('fraction', 'float');
		$this->addType('elid', 'integer');
		$this->addType('createdAt', 'datetime');
		$this->addType('updatedAt', 'datetime');
	}

	public function jsonSerialize(): array {
		return [
			'id' => $this->getId(),
			'measureNumber' => $this->measureNumber,
			'fraction' => $this->fraction,
			// Bislang nie ausgeliefert (bis Phase 18 unbemerkt) - der Sekundär-
			// anker aus Phase 11 (exakte Notenkoordinate innerhalb desselben
			// etags, siehe scoreLayout.js annotationMarkers) konnte dadurch nie
			// greifen, jede Notiz landete immer auf der gröberen Takt-Näherung.
			'elid' => $this->elid,
			'anchorEtag' => $this->anchorEtag,
			'content' => $this->content,
			'visibility' => $this->visibility,
			'createdAt' => $this->createdAt?->format(\DateTimeInterface::ATOM),
			'updatedAt' => $this->updatedAt?->format(\DateTimeInterface::ATOM),
		];
	}
}
