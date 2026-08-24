<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCP\AppFramework\Db\Entity;

/**
 * Konvertierungsstatus einer .mscz-Datei für einen bestimmten etag. Ein
 * Re-Upload/eine Bearbeitung ändert den etag und erzeugt damit implizit
 * einen neuen Datensatz statt den alten zu überschreiben - das Caching in
 * IAppData folgt exakt demselben Schlüssel (fileId, etag).
 *
 * @method int getFileId()
 * @method void setFileId(int $fileId)
 * @method string getEtag()
 * @method void setEtag(string $etag)
 * @method string getStatus()
 * @method void setStatus(string $status)
 * @method ?string getErrorMessage()
 * @method void setErrorMessage(?string $errorMessage)
 * @method ?string getErrorCode()
 * @method void setErrorCode(?string $errorCode)
 * @method int getFormatVersion()
 * @method void setFormatVersion(int $formatVersion)
 * @method \DateTime getCreatedAt()
 * @method void setCreatedAt(\DateTime $createdAt)
 * @method \DateTime getUpdatedAt()
 * @method void setUpdatedAt(\DateTime $updatedAt)
 */
class ScoreConversion extends Entity implements \JsonSerializable {
	public const STATUS_PENDING = 'pending';
	public const STATUS_PROCESSING = 'processing';
	public const STATUS_READY = 'ready';
	public const STATUS_ERROR = 'error';

	/**
	 * Feste Wertemenge (Phase 14) - erlaubt eine feste Uebersetzung je Code
	 * beim Anzeigen (siehe ScoreViewer.vue errorCodeText()) statt eines
	 * rohen, nur einmal in der Sprache des Konvertierenden geschriebenen
	 * Fehlertexts. `ERROR_UNKNOWN` ist zugleich expliziter Code und Fallback
	 * fuer einen fehlenden/nicht erkannten Code.
	 */
	public const ERROR_SIDECAR_UNREACHABLE = 'sidecar_unreachable';
	public const ERROR_SIDECAR_REJECTED = 'sidecar_rejected';
	public const ERROR_CONVERSION_FAILED = 'conversion_failed';
	public const ERROR_TIMEOUT = 'timeout';
	public const ERROR_NO_PAGES = 'no_pages';
	public const ERROR_TOO_LARGE = 'too_large';
	public const ERROR_UNKNOWN = 'unknown';

	protected $fileId;
	protected $etag;
	protected $status;
	protected $errorMessage;
	protected $errorCode;
	protected $formatVersion;
	protected $createdAt;
	protected $updatedAt;

	public function __construct() {
		$this->addType('fileId', 'integer');
		$this->addType('formatVersion', 'integer');
		$this->addType('createdAt', 'datetime');
		$this->addType('updatedAt', 'datetime');
	}

	public function jsonSerialize(): array {
		return [
			'status' => $this->status,
			'error' => $this->errorMessage,
			'errorCode' => $this->errorCode,
		];
	}
}
