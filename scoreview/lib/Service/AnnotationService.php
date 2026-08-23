<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\Annotation;
use OCA\ScoreView\Db\AnnotationMapper;

/**
 * Verwaltet private Notizen (Phase 11). Der Anker ist musikalisch
 * (Taktnummer + Bruchteil innerhalb des Taktes, siehe
 * Migration\Version000100Date20260823130000) - diese Klasse berechnet den
 * Anker nicht selbst (das passiert clientseitig aus timing.json/
 * measures.json, siehe scoreLayout.js resolveMeasurePosition), sondern
 * speichert und verwaltet ihn nur.
 */
class AnnotationService {
	public function __construct(
		private AnnotationMapper $mapper,
	) {
	}

	/**
	 * @return array<int, array> jsonSerialize()-Form je Annotation, ergänzt
	 *   um `orphaned` - siehe unten für die Bedeutung.
	 */
	public function listForFile(int $fileId, string $userId, ?int $currentMeasureCount): array {
		return array_map(function (Annotation $a) use ($currentMeasureCount) {
			$data = $a->jsonSerialize();
			// "Verwaist" (PLAN.md Phase 11 - "nicht aufloesbare Notizen sichtbar
			// als verwaist markieren statt sie zu verlieren"): die Partitur hat
			// inzwischen weniger Takte als der Anker referenziert - kann nach
			// einem Re-Upload passieren, der Takte entfernt hat. Ein
			// UNveraendertes measure_number bei einer GROESSEREN Taktzahl gilt
			// bewusst NICHT als verwaist - der Anker ist weiterhin gueltig,
			// genau das ist der Sinn eines musikalischen statt eines
			// Pixel-Ankers (siehe Migrationskommentar).
			$data['orphaned'] = $currentMeasureCount !== null && $a->getMeasureNumber() > $currentMeasureCount;
			return $data;
		}, $this->mapper->findByFileIdAndUser($fileId, $userId));
	}

	public function create(int $fileId, string $userId, int $measureNumber, float $fraction, ?int $elid, ?string $anchorEtag, string $content): Annotation {
		$now = new \DateTime();
		$annotation = new Annotation();
		$annotation->setFileId($fileId);
		$annotation->setUserId($userId);
		$annotation->setMeasureNumber($measureNumber);
		$annotation->setFraction($fraction);
		$annotation->setElid($elid);
		$annotation->setAnchorEtag($anchorEtag);
		$annotation->setVisibility(Annotation::VISIBILITY_PRIVATE);
		$annotation->setContent($content);
		$annotation->setCreatedAt($now);
		$annotation->setUpdatedAt($now);
		return $this->mapper->insert($annotation);
	}

	/** @throws \RuntimeException wenn keine eigene Annotation mit dieser ID zu dieser Datei existiert */
	public function updateContent(int $id, int $fileId, string $userId, string $content): Annotation {
		$annotation = $this->mapper->findOwnById($id, $fileId, $userId);
		if ($annotation === null) {
			throw new \RuntimeException('Notiz nicht gefunden oder kein Zugriff.');
		}
		$annotation->setContent($content);
		$annotation->setUpdatedAt(new \DateTime());
		return $this->mapper->update($annotation);
	}

	/** @throws \RuntimeException wenn keine eigene Annotation mit dieser ID zu dieser Datei existiert */
	public function delete(int $id, int $fileId, string $userId): void {
		$annotation = $this->mapper->findOwnById($id, $fileId, $userId);
		if ($annotation === null) {
			throw new \RuntimeException('Notiz nicht gefunden oder kein Zugriff.');
		}
		$this->mapper->delete($annotation);
	}
}
