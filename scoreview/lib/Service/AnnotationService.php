<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\Annotation;
use OCA\ScoreView\Db\AnnotationMapper;
use OCP\IUserManager;

/**
 * Verwaltet Notizen (Phase 11: privat, Phase 18: zusätzlich geteilt). Der
 * Anker ist musikalisch (Taktnummer + Bruchteil innerhalb des Taktes, siehe
 * Migration\Version000100Date20260823130000) - diese Klasse berechnet den
 * Anker nicht selbst (das passiert clientseitig aus timing.json/
 * measures.json, siehe scoreLayout.js resolveMeasurePosition), sondern
 * speichert und verwaltet ihn nur.
 *
 * Wer eine geteilte Notiz anlegen/ändern/löschen darf, entscheidet diese
 * Klasse ebenfalls NICHT selbst - das hängt von Dateirechten ab
 * (`PERMISSION_UPDATE` am aufgelösten Node), die nur der Controller über
 * `UserFileResolver` kennt. Die Methoden hier nehmen die fertige
 * Berechtigungsentscheidung (`canWriteShared`) deshalb als Parameter
 * entgegen, statt sie zu erraten.
 */
class AnnotationService {
	public function __construct(
		private AnnotationMapper $mapper,
		private IUserManager $userManager,
	) {
	}

	/**
	 * @return array<int, array> serialize()-Form je Annotation, inkl. `orphaned`.
	 */
	public function listForFile(int $fileId, string $userId, ?int $currentMeasureCount): array {
		return array_map(
			fn (Annotation $a) => $this->serialize($a, $userId, $currentMeasureCount),
			$this->mapper->findVisibleForUser($fileId, $userId)
		);
	}

	/**
	 * jsonSerialize() ergänzt um Felder, die den Blickwinkel der ANFRAGENDEN
	 * Nutzerin brauchen und deshalb nicht auf der Entity selbst leben können:
	 * `mine` (fürs Bearbeiten-UI - nicht anhand der rohen userId im Client
	 * geprüft, die wird absichtlich gar nicht erst ausgeliefert) und
	 * `authorName` (nur für geteilte Notizen sinnvoll - Displayname statt
	 * roher userId, siehe PLAN.md Phase 18 "Autor über IUserManager").
	 */
	public function serialize(Annotation $a, string $currentUserId, ?int $currentMeasureCount = null): array {
		$data = $a->jsonSerialize();
		$data['mine'] = $a->getUserId() === $currentUserId;
		$data['authorName'] = $a->getVisibility() === Annotation::VISIBILITY_SHARED
			? ($this->userManager->get($a->getUserId())?->getDisplayName() ?? $a->getUserId())
			: null;
		if ($currentMeasureCount !== null) {
			// "Verwaist" (PLAN.md Phase 11 - "nicht aufloesbare Notizen sichtbar
			// als verwaist markieren statt sie zu verlieren"): die Partitur hat
			// inzwischen weniger Takte als der Anker referenziert - kann nach
			// einem Re-Upload passieren, der Takte entfernt hat. Ein
			// UNveraendertes measure_number bei einer GROESSEREN Taktzahl gilt
			// bewusst NICHT als verwaist - der Anker ist weiterhin gueltig,
			// genau das ist der Sinn eines musikalischen statt eines
			// Pixel-Ankers (siehe Migrationskommentar).
			$data['orphaned'] = $a->getMeasureNumber() > $currentMeasureCount;
		}
		return $data;
	}

	public function create(int $fileId, string $userId, int $measureNumber, float $fraction, ?int $elid, ?string $anchorEtag, string $content, string $visibility): Annotation {
		$now = new \DateTime();
		$annotation = new Annotation();
		$annotation->setFileId($fileId);
		$annotation->setUserId($userId);
		$annotation->setMeasureNumber($measureNumber);
		$annotation->setFraction($fraction);
		$annotation->setElid($elid);
		$annotation->setAnchorEtag($anchorEtag);
		$annotation->setVisibility($visibility);
		$annotation->setContent($content);
		$annotation->setCreatedAt($now);
		$annotation->setUpdatedAt($now);
		return $this->mapper->insert($annotation);
	}

	/**
	 * @throws \RuntimeException wenn eine geteilte Notiz ohne Schreibrecht
	 *                           geändert werden soll (Controller macht daraus 403 - eine geteilte
	 *                           Notiz ist für jeden mit Dateizugriff ohnehin sichtbar, es gibt also
	 *                           nichts zu verbergen, anders als beim null-Fall unten).
	 * @return ?Annotation null, wenn die ID zu dieser Datei nicht existiert,
	 *                     ODER eine private Notiz einer anderen Nutzerin gehört (Controller
	 *                     macht daraus 404 - bewusst ohne Existenz zu bestätigen).
	 */
	public function updateContent(int $id, int $fileId, string $userId, bool $canWriteShared, string $content): ?Annotation {
		$annotation = $this->mapper->findByIdAndFileId($id, $fileId);
		if ($annotation === null) {
			return null;
		}
		if ($annotation->getVisibility() === Annotation::VISIBILITY_SHARED) {
			if (!$canWriteShared) {
				throw new \RuntimeException('Kein Schreibrecht fuer geteilte Notizen dieser Datei.');
			}
		} elseif ($annotation->getUserId() !== $userId) {
			return null;
		}
		$annotation->setContent($content);
		$annotation->setUpdatedAt(new \DateTime());
		return $this->mapper->update($annotation);
	}

	/**
	 * @throws \RuntimeException wenn eine geteilte Notiz ohne Schreibrecht
	 *                           gelöscht werden soll (siehe updateContent())
	 * @return bool false, wenn die ID zu dieser Datei nicht existiert ODER
	 *              eine private Notiz einer anderen Nutzerin gehört (Controller macht
	 *              daraus 404) - eigener Rückgabetyp statt null/Annotation wie bei
	 *              updateContent(), weil "gelöscht" kein Objekt zum Zurückgeben hat.
	 */
	public function delete(int $id, int $fileId, string $userId, bool $canWriteShared): bool {
		$annotation = $this->mapper->findByIdAndFileId($id, $fileId);
		if ($annotation === null) {
			return false;
		}
		if ($annotation->getVisibility() === Annotation::VISIBILITY_SHARED) {
			if (!$canWriteShared) {
				throw new \RuntimeException('Kein Schreibrecht fuer geteilte Notizen dieser Datei.');
			}
		} elseif ($annotation->getUserId() !== $userId) {
			return false;
		}
		$this->mapper->delete($annotation);
		return true;
	}
}
