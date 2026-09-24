<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\Annotation;
use OCA\ScoreView\Db\AnnotationMapper;
use OCP\IUserManager;

/**
 * Verwaltet Notizen (privat, geteilt, fuer Stimmen) und Stempel. Der
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
 * entgegen, statt sie zu erraten. Dasselbe gilt fuer die Leitungsrolle
 * (`isLeader`, LeaderService): Stimmnotizen (`parts`) duerfen nur Leitungen
 * aendern und loeschen, und ob jemand Leitung ist, weiss der Controller.
 *
 * Die drei Sichtbarkeiten haben damit drei getrennte Regeln, die sich nicht
 * vermischen: privat - nur die Autorin; geteilt - Schreibrecht an der Datei;
 * Stimmen - Leitung. Eine Leitung ohne Schreibrecht darf also Stimmnotizen
 * pflegen, aber keine geteilten: Die Rolle ergaenzt die Regeln der geteilten Notizen, sie ersetzt sie nicht.
 */
class AnnotationService {
	/**
	 * Hoechstens so viele Notizen je Nutzerin und Datei, alle Sichtbarkeiten
	 * zusammen (S4). Ohne Grenze liesse sich eine Partitur mit beliebig vielen
	 * geteilten oder Stimmnotizen fluten - und listForFile() liefert sie bei
	 * JEDEM Oeffnen allen Lesenden aus. 500 sind mehr als ein Stempel je Takt
	 * einer langen Partitur; wer das erreicht, raeumt auf statt weiter
	 * anzuhaeufen.
	 *
	 * Gezaehlt wird vor dem Einfuegen, ohne Sperre: Zwei gleichzeitige
	 * Anfragen derselben Person koennen die Grenze um eine Notiz
	 * ueberschreiten. Das ist hier harmlos - anders als bei den Aufnahmen
	 * geht es um Bytes, nicht um Megabytes -, und die Drosselung der Route
	 * haelt die Zahl solcher Paare klein.
	 */
	public const MAX_PER_USER_AND_FILE = 500;

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
	 * roher userId, aufgelöst über IUserManager).
	 */
	public function serialize(Annotation $a, string $currentUserId, ?int $currentMeasureCount = null): array {
		$data = $a->jsonSerialize();
		$data['mine'] = $a->getUserId() === $currentUserId;
		// Auch bei Stimmnotizen: Wer die Leitung ist, soll man sehen,
		// und in einem Chor mit mehreren Leitungen auch, welche.
		$data['authorName'] = in_array($a->getVisibility(), [Annotation::VISIBILITY_SHARED, Annotation::VISIBILITY_PARTS], true)
			? ($this->userManager->get($a->getUserId())?->getDisplayName() ?? $a->getUserId())
			: null;
		if ($currentMeasureCount !== null) {
			// "Verwaist" (nicht aufloesbare Notizen sichtbar als verwaist
			// markieren statt sie zu verlieren): die Partitur hat
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

	/**
	 * @param ?string $targetPartsJson JSON `[{id, name}]`, bereits geprueft
	 *                                 (Controller) - nur bei `parts`
	 * @param bool $byLeader ob die Autorin beim Anlegen Leitung ist
	 * @throws AnnotationLimitException bei MAX_PER_USER_AND_FILE
	 */
	public function create(int $fileId, string $userId, int $measureNumber, float $fraction, ?int $elid, ?string $anchorEtag, string $content, string $visibility, string $kind = Annotation::KIND_TEXT, ?string $stamp = null, ?string $targetPartsJson = null, bool $byLeader = false): Annotation {
		if ($this->mapper->countByFileAndUser($fileId, $userId) >= self::MAX_PER_USER_AND_FILE) {
			throw new AnnotationLimitException('Zu viele Notizen zu dieser Datei.');
		}
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
		$annotation->setKind($kind);
		$annotation->setStamp($stamp);
		$annotation->setTargetParts($targetPartsJson);
		$annotation->setByLeader($byLeader);
		$annotation->setCreatedAt($now);
		$annotation->setUpdatedAt($now);
		return $this->mapper->insert($annotation);
	}

	/**
	 * @param bool $isLeader ob die anfragende Nutzerin Leitung ist - zaehlt
	 *                       nur bei Stimmnotizen
	 * @param ?string $targetPartsJson neue Zielstimmen einer Stimmnotiz;
	 *                                 null = unveraendert, bei anderen Notizen wirkungslos
	 * @throws \RuntimeException wenn eine geteilte Notiz ohne Schreibrecht
	 *                           geändert werden soll (Controller macht daraus 403 - eine geteilte
	 *                           Notiz ist für jeden mit Dateizugriff ohnehin sichtbar, es gibt also
	 *                           nichts zu verbergen, anders als beim null-Fall unten). Ebenso
	 *                           bei einer Stimmnotiz ohne Leitungsrolle - auch die sieht jede
	 *                           Person mit Dateizugriff.
	 * @throws \InvalidArgumentException wenn eine Textnotiz leer werden soll
	 *                                   (Controller macht daraus 400). Ein Stempel darf ohne Text
	 *                                   sein - erst hier bekannt, weil erst hier die Notiz geladen ist.
	 * @return ?Annotation null, wenn die ID zu dieser Datei nicht existiert,
	 *                     ODER eine private Notiz einer anderen Nutzerin gehört (Controller
	 *                     macht daraus 404 - bewusst ohne Existenz zu bestätigen).
	 */
	public function updateContent(int $id, int $fileId, string $userId, bool $canWriteShared, string $content, bool $isLeader = false, ?string $targetPartsJson = null): ?Annotation {
		$annotation = $this->mapper->findByIdAndFileId($id, $fileId);
		if ($annotation === null) {
			return null;
		}
		if (!$this->mayWrite($annotation, $userId, $canWriteShared, $isLeader)) {
			return null;
		}
		if ($annotation->getKind() !== Annotation::KIND_STAMP && trim($content) === '') {
			throw new \InvalidArgumentException('Eine Textnotiz braucht Text.');
		}
		$annotation->setContent($content);
		if ($targetPartsJson !== null && $annotation->getVisibility() === Annotation::VISIBILITY_PARTS) {
			$annotation->setTargetParts($targetPartsJson);
		}
		$annotation->setUpdatedAt(new \DateTime());
		return $this->mapper->update($annotation);
	}

	/**
	 * @throws \RuntimeException wenn eine geteilte Notiz ohne Schreibrecht
	 *                           oder eine Stimmnotiz ohne Leitungsrolle gelöscht werden soll
	 *                           (siehe updateContent())
	 * @return bool false, wenn die ID zu dieser Datei nicht existiert ODER
	 *              eine private Notiz einer anderen Nutzerin gehört (Controller macht
	 *              daraus 404) - eigener Rückgabetyp statt null/Annotation wie bei
	 *              updateContent(), weil "gelöscht" kein Objekt zum Zurückgeben hat.
	 */
	public function delete(int $id, int $fileId, string $userId, bool $canWriteShared, bool $isLeader = false): bool {
		$annotation = $this->mapper->findByIdAndFileId($id, $fileId);
		if ($annotation === null) {
			return false;
		}
		if (!$this->mayWrite($annotation, $userId, $canWriteShared, $isLeader)) {
			return false;
		}
		$this->mapper->delete($annotation);
		return true;
	}

	/**
	 * Die Schreibregel je Sichtbarkeit, an EINER Stelle fuer Aendern und
	 * Loeschen - was man aendern darf, darf man auch loeschen.
	 *
	 * @return bool false = so tun, als gaebe es die Notiz nicht (private
	 *              Notiz einer anderen Nutzerin, Controller: 404)
	 * @throws \RuntimeException sichtbar, aber nicht schreibbar (Controller: 403)
	 */
	private function mayWrite(Annotation $annotation, string $userId, bool $canWriteShared, bool $isLeader): bool {
		$visibility = $annotation->getVisibility();
		if ($visibility === Annotation::VISIBILITY_SHARED) {
			if (!$canWriteShared) {
				throw new \RuntimeException('Kein Schreibrecht fuer geteilte Notizen dieser Datei.');
			}
			return true;
		}
		if ($visibility === Annotation::VISIBILITY_PARTS) {
			// Leitungen pflegen die Hinweise gemeinsam, auch die einer
			// anderen oder einer inzwischen abberufenen Leitung - sonst
			// blieben deren Hinweise unkorrigierbar stehen.
			if (!$isLeader) {
				throw new \RuntimeException('Stimmnotizen aendern nur Leitungen.');
			}
			return true;
		}
		return $annotation->getUserId() === $userId;
	}
}
