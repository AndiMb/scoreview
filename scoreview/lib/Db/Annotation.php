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
 * @method string getKind()
 * @method void setKind(string $kind)
 * @method ?string getStamp()
 * @method void setStamp(?string $stamp)
 * @method ?string getTargetParts()
 * @method void setTargetParts(?string $targetParts)
 * @method ?bool getByLeader()
 * @method void setByLeader(?bool $byLeader)
 */
class Annotation extends Entity implements \JsonSerializable {
	public const VISIBILITY_PRIVATE = 'private';
	public const VISIBILITY_SHARED = 'shared';

	/**
	 * An eine oder mehrere Stimmen gerichtet (B2). Anlegen, aendern und
	 * loeschen duerfen nur Leitungen; lesen darf jede Person mit
	 * Dateizugriff - gefiltert wird im Client (lib/annotationFilter.js), weil
	 * "ohne Stimme alle, zurueckgenommen" eine Frage der Darstellung
	 * ist, keine des Zugriffs.
	 */
	public const VISIBILITY_PARTS = 'parts';

	public const KIND_TEXT = 'text';
	public const KIND_STAMP = 'stamp';

	/**
	 * Die Stempel als feste Liste: Der Client zeichnet jedes Symbol
	 * selbst (ScoreStamps.vue), ein unbekannter Code waere ein Stempel ohne
	 * Bild. Die Codes sind Schluessel, keine Anzeigetexte - uebersetzt wird im
	 * Client.
	 */
	public const STAMPS = [
		'breath', 'caesura',
		'pp', 'p', 'mp', 'mf', 'f', 'ff',
		'cresc', 'dim',
		'cue', 'attention',
		'fermata', 'rit', 'a_tempo',
	];

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
	/**
	 * Die Felder fuer Stempel und Stimmnotizen (Migration
	 * Version000100Date20260924100000). Vorbelegt wie die Spaltenvorgaben:
	 * Eine Notiz, die ohne sie angelegt wird, ist die Textnotiz, die sie immer
	 * war - und weil QBMapper nur geaenderte Felder schreibt, entscheidet beim
	 * Einfuegen ohnehin die Vorgabe der Spalte.
	 */
	protected $kind = self::KIND_TEXT;
	protected $stamp;
	/** JSON `[{id, name}]`, roh wie in der Spalte - ausgewertet wird im Service. */
	protected $targetParts;
	protected $byLeader = false;

	public function __construct() {
		$this->addType('fileId', 'integer');
		$this->addType('measureNumber', 'integer');
		$this->addType('fraction', 'float');
		$this->addType('elid', 'integer');
		$this->addType('createdAt', 'datetime');
		$this->addType('updatedAt', 'datetime');
		$this->addType('byLeader', 'boolean');
	}

	public function jsonSerialize(): array {
		return [
			'id' => $this->getId(),
			'measureNumber' => $this->measureNumber,
			'fraction' => $this->fraction,
			// Sekundäranker (exakte Notenkoordinate innerhalb desselben etags,
			// siehe scoreLayout.js annotationMarkers) - ohne dieses Feld faellt
			// jede Notiz auf die gröbere Takt-Näherung zurück.
			'elid' => $this->elid,
			'anchorEtag' => $this->anchorEtag,
			'content' => $this->content,
			'visibility' => $this->visibility,
			'kind' => $this->kind ?? self::KIND_TEXT,
			'stamp' => $this->stamp,
			'targetParts' => $this->decodedTargetParts(),
			// Beim Anlegen festgehalten, nicht bei jeder Anzeige neu
			// geprueft: Eine abberufene Leitung behaelt ihre Hinweise.
			'byLeader' => (bool)$this->byLeader,
			'createdAt' => $this->createdAt?->format(\DateTimeInterface::ATOM),
			'updatedAt' => $this->updatedAt?->format(\DateTimeInterface::ATOM),
		];
	}

	/**
	 * Die Zielstimmen als Liste. Eine unlesbare Spalte wird zur leeren Liste
	 * statt zum Fehler: Die Notiz bleibt dann "ohne Stimme" sichtbar,
	 * statt die ganze Notizliste der Partitur mitzureissen.
	 *
	 * @return list<array{id: string, name: string}>
	 */
	private function decodedTargetParts(): array {
		if ($this->targetParts === null || $this->targetParts === '') {
			return [];
		}
		$decoded = json_decode($this->targetParts, true);
		return is_array($decoded) ? array_values($decoded) : [];
	}
}
