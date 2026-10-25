<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\AppFramework\Db\Entity;

/**
 * One display variant of a score version (docs/architecture.md E19): a part,
 * a phone page, concert pitch or transposed notation, engraved by the same
 * engine as the base conversion and cached next to it.
 *
 * A table of its own rather than a column on scoreview_conversions: that row
 * is "the conversion of the file" in some twenty places, and a variant column
 * would have every one of them think about `variant = ''`.
 *
 * Status values and error codes are those of ScoreConversion, so the viewer
 * reads both with the same code.
 *
 * @method int getFileId()
 * @method void setFileId(int $fileId)
 * @method string getEtag()
 * @method void setEtag(string $etag)
 * @method string getVariant()
 * @method void setVariant(string $variant)
 * @method string getStatus()
 * @method void setStatus(string $status)
 * @method ?string getErrorCode()
 * @method void setErrorCode(?string $errorCode)
 * @method ?string getErrorMessage()
 * @method void setErrorMessage(?string $errorMessage)
 * @method ?int getFormatVersion()
 * @method void setFormatVersion(?int $formatVersion)
 * @method ?string getEngine()
 * @method void setEngine(?string $engine)
 * @method ?int getPageCount()
 * @method void setPageCount(?int $pageCount)
 * @method \DateTime getCreatedAt()
 * @method void setCreatedAt(\DateTime $createdAt)
 * @method \DateTime getUpdatedAt()
 * @method void setUpdatedAt(\DateTime $updatedAt)
 * @method ?\DateTime getAccessedAt()
 * @method void setAccessedAt(?\DateTime $accessedAt)
 */
class ScoreVariant extends Entity {
	/**
	 * The server cannot engrave variants: the sidecar's stock MuseScore has
	 * neither the segment ids (M10) nor the mappings a variant needs (E19).
	 */
	public const ERROR_UNSUPPORTED = 'variant_unsupported';

	protected $fileId;
	protected $etag;
	protected $variant;
	protected $status;
	protected $errorCode;
	protected $errorMessage;
	protected $formatVersion;
	/**
	 * The engine release that engraved it (LocalConverter::engineVersion()) -
	 * unlike the base conversion, a variant records the version, so a
	 * difference in engraving can be traced to one.
	 */
	protected $engine;
	protected $pageCount;
	protected $createdAt;
	protected $updatedAt;
	/** For the eviction of the least recently used variant (VariantService). */
	protected $accessedAt;

	public function __construct() {
		$this->addType('fileId', 'integer');
		$this->addType('formatVersion', 'integer');
		$this->addType('pageCount', 'integer');
		$this->addType('createdAt', 'datetime');
		$this->addType('updatedAt', 'datetime');
		$this->addType('accessedAt', 'datetime');
	}
}
