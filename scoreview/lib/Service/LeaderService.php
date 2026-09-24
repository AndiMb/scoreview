<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\Leader;
use OCA\ScoreView\Db\LeaderMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Collaboration\Collaborators\ISearch;
use OCP\Constants;
use OCP\DB\Exception as DbException;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\IUserManager;
use OCP\Share\IShare;

/**
 * Die Leitungsrolle einer Partitur (B1): wer sie hat, wer sie vergeben und
 * wieder nehmen darf.
 *
 * Grundsatz: **Die Rolle setzt den Dateizugriff voraus, sie ersetzt ihn
 * nicht.** Jede Methode bekommt deshalb einen Node, der bereits aus Sicht der
 * handelnden Person aufgeloest ist (UserFileResolver) - wer die Datei nicht
 * sieht, kommt gar nicht bis hierher. Fuer Dritte (die Zielperson einer
 * Ernennung, die Eintraege der Liste) wird der Zugriff hier eigens geprueft.
 *
 * Drei Quellen machen jemanden zur Leitung:
 *
 * 1. **Die Eigentuemerin**, bestimmt bei jeder Pruefung aus
 *    `$node->getOwner()`. Sie steht nie in der Tabelle und laesst sich darum
 *    gar nicht abberufen - auch nicht versehentlich durch einen
 *    Datenbankeintrag.
 * 2. **Ohne Eigentuemerin** (Gruppenordner und aehnliche Speicher liefern
 *    keine): wer Schreibrecht an der Datei hat. Irgendwer muss die erste
 *    Ernennung aussprechen koennen, und Schreibrecht ist dort das Recht, das
 *    einer Eigentuemerschaft am naechsten kommt - es ist dasselbe, das schon
 *    geteilte Notizen erlaubt (AnnotationController::canWriteShared).
 * 3. **Ein Eintrag in `scoreview_leaders`.** Er wirkt nur, solange die Person
 *    die Datei sieht. Verliert sie den Zugriff, verliert sie die
 *    Rolle, ohne dass der Eintrag verschwindet - bekommt sie ihn zurueck, ist
 *    sie wieder Leitung. Eine voruebergehend entzogene Freigabe soll die
 *    Ernennung nicht loeschen.
 */
class LeaderService {
	/** Hoechstens so viele Vorschlaege beim Ernennen (S4). */
	public const MAX_CANDIDATES = 20;
	/** Kuerzester Suchbegriff - darunter waere die Liste Zufall. */
	public const MIN_QUERY_LENGTH = 2;
	/**
	 * So viele Treffer holt die Suche, bevor auf den Dateizugriff gefiltert
	 * wird. Etwas mehr als MAX_CANDIDATES, weil ein Teil der Treffer die Datei
	 * nicht sieht und wegfaellt; knapp gehalten, weil jeder Treffer eine
	 * Aufloesung im Dateibaum einer FREMDEN Person kostet (getUserFolder
	 * samt Einhaengen ihrer Freigaben) - und das je Tastendruck im Suchfeld.
	 * Wer so allgemein sucht, dass nach 30 Treffern keine 20 mit Zugriff
	 * uebrig sind, tippt weiter.
	 */
	private const SEARCH_LIMIT = 30;

	/**
	 * Hoechstens so viele Zugriffspruefungen je Suche - die eigentliche
	 * Kostengrenze. Die Suche liefert exakte Treffer ZUSAETZLICH zum Limit,
	 * die Zahl der Treffer allein begrenzt die Pruefungen also nicht.
	 */
	private const MAX_ACCESS_CHECKS = self::SEARCH_LIMIT;

	public function __construct(
		private LeaderMapper $mapper,
		private IRootFolder $rootFolder,
		private IUserManager $userManager,
		private ISearch $search,
		private ITimeFactory $time,
	) {
	}

	/**
	 * @param Node $node aus Sicht von $uid aufgeloest - der Dateizugriff ist
	 *                   damit bereits belegt
	 */
	public function isLeader(Node $node, string $uid): bool {
		$owner = $node->getOwner();
		if ($owner !== null) {
			if ($owner->getUID() === $uid) {
				return true;
			}
		} elseif (($node->getPermissions() & Constants::PERMISSION_UPDATE) !== 0) {
			return true;
		}
		return $this->mapper->findByFileAndUser($node->getId(), $uid) !== null;
	}

	/**
	 * Die Leitungen, die gerade wirken: die Eigentuemerin zuerst, dann die
	 * Ernannten in der Reihenfolge ihrer Ernennung. Eintraege von Personen
	 * ohne Dateizugriff fehlen - sie haben keine Wirkung, und die Liste soll
	 * zeigen, wer die Partitur leitet, nicht wer es einmal durfte.
	 *
	 * Bewusst NUR ausgeblendet, nicht geloescht, obwohl die Pruefung hier
	 * ohnehin laeuft und das Aufraeumen nichts extra kostete: Eine entzogene
	 * Freigabe ist oft voruebergehend (Gruppe umgebaut, Share neu angelegt),
	 * und ein lesender Aufruf, der dabei still Ernennungen loescht, nahme sie
	 * auch dann weg (Grundsatz 3 oben). Ein verwaister Eintrag ist eine Zeile
	 * ohne Wirkung; endgueltig gehen die Eintraege mit der Datei
	 * (CleanupOrphansJob) oder dem Konto (UserDeletedListener).
	 *
	 * Ohne Eigentuemerin fehlen die Leitungen kraft Schreibrecht: Wer
	 * alles schreiben darf, weiss nur der Speicher, und aufzaehlen laesst es
	 * sich nicht ohne Weiteres. Die Liste zeigt dann nur die Ernannten.
	 *
	 * @return list<array{userId: string, displayName: string, isOwner: bool}>
	 */
	public function listLeaders(Node $node): array {
		$result = [];
		$owner = $node->getOwner();
		if ($owner !== null) {
			$result[] = ['userId' => $owner->getUID(), 'displayName' => $owner->getDisplayName(), 'isOwner' => true];
		}
		foreach ($this->mapper->findByFileId($node->getId()) as $leader) {
			$uid = $leader->getUserId();
			if ($owner !== null && $uid === $owner->getUID()) {
				continue;
			}
			if (!$this->canSee($uid, $node->getId())) {
				continue;
			}
			$result[] = ['userId' => $uid, 'displayName' => $this->userManager->getDisplayName($uid) ?? $uid, 'isOwner' => false];
		}
		return $result;
	}

	/**
	 * Ernennt $target. Wer schon Leitung ist, bleibt es - ein zweiter Klick
	 * ist kein Fehler.
	 *
	 * @throws LeaderException NOT_LEADER, NOT_APPOINTABLE
	 */
	public function appoint(Node $node, string $actor, string $target): void {
		$this->requireLeader($node, $actor);
		$fileId = $node->getId();
		// Erst die Zugriffspruefung, dann alles andere: Eine Ernennung ohne
		// Zugriff haette keine Wirkung und saesse unsichtbar in der
		// Tabelle, bis jemand die Datei freigibt - und waere dann eine
		// Ernennung, die niemand bewusst ausgesprochen hat.
		if ($target === '' || !$this->canSee($target, $fileId)) {
			throw new LeaderException(LeaderException::NOT_APPOINTABLE);
		}
		if ($node->getOwner()?->getUID() === $target || $this->mapper->findByFileAndUser($fileId, $target) !== null) {
			return;
		}

		$leader = new Leader();
		$leader->setFileId($fileId);
		$leader->setUserId($target);
		$leader->setAppointedBy($actor);
		$leader->setCreatedAt($this->time->getDateTime());
		try {
			$this->mapper->insert($leader);
		} catch (DbException $e) {
			// Zwei Leitungen ernennen dieselbe Person im selben Augenblick:
			// Der UNIQUE-Index laesst nur einen Eintrag zu, und genau der ist
			// das gewuenschte Ergebnis.
			if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
		}
	}

	/**
	 * Nimmt die Ernennung von $target zurueck. Das darf jede Leitung, auch
	 * gegenueber der Person, die sie selbst ernannt hat - die Rolle
	 * kennt keine Rangfolge ausser der Eigentuemerin.
	 *
	 * @throws LeaderException NOT_LEADER, OWNER, NOT_APPOINTED
	 */
	public function revoke(Node $node, string $actor, string $target): void {
		$this->requireLeader($node, $actor);
		if ($node->getOwner()?->getUID() === $target) {
			throw new LeaderException(LeaderException::OWNER);
		}
		$leader = $this->mapper->findByFileAndUser($node->getId(), $target);
		if ($leader === null) {
			throw new LeaderException(LeaderException::NOT_APPOINTED);
		}
		$this->mapper->delete($leader);
	}

	/**
	 * Vorschlaege zum Ernennen: Nutzerinnen, die zum Suchbegriff passen, die
	 * Datei sehen und noch keine Leitung sind.
	 *
	 * Die Suche laeuft ueber Nextclouds Sharee-Suche (ISearch) statt ueber
	 * IUserManager: So gelten dieselben Grenzen wie beim Teilen - wer laut
	 * Admin-Einstellung nur Personen der eigenen Gruppen finden darf, findet
	 * auch hier keine anderen. Ein eigener Endpunkt statt der OCS-Sharee-API
	 * im Browser, weil diese eine Sitzung verlangt und die Mobil-App nur ein
	 * Token hat (E8); der Filter auf den Dateizugriff kommt dabei
	 * gleich mit.
	 *
	 * @return list<array{userId: string, displayName: string}>
	 * @throws LeaderException NOT_LEADER
	 */
	public function candidates(Node $node, string $actor, string $query): array {
		$this->requireLeader($node, $actor);
		$query = trim($query);
		if (mb_strlen($query) < self::MIN_QUERY_LENGTH) {
			return [];
		}

		[$treffer] = $this->search->search($query, [IShare::TYPE_USER], false, self::SEARCH_LIMIT, 0);
		// Ausgeschlossen wird, wer schon Leitung ist - direkt aus der Tabelle
		// statt ueber listLeaders(): Die prueft fuer jeden Eintrag den
		// Dateizugriff, und hier waere das Aufwand ohne Ergebnis. Wer einen
		// Eintrag hat, aber die Datei nicht sieht, fiele unten ohnehin weg.
		$gesehen = [];
		$owner = $node->getOwner();
		if ($owner !== null) {
			$gesehen[$owner->getUID()] = true;
		}
		foreach ($this->mapper->findByFileId($node->getId()) as $leader) {
			$gesehen[$leader->getUserId()] = true;
		}
		$pruefungen = 0;
		$result = [];
		// Exakte Treffer zuerst - wer den vollen Namen tippt, soll die Person
		// oben sehen und nicht nach zwanzig Teiltreffern suchen muessen.
		foreach ([...($treffer['exact']['users'] ?? []), ...($treffer['users'] ?? [])] as $eintrag) {
			$uid = $eintrag['value']['shareWith'] ?? null;
			if (!is_string($uid) || isset($gesehen[$uid])) {
				continue;
			}
			$gesehen[$uid] = true;
			if (++$pruefungen > self::MAX_ACCESS_CHECKS) {
				break;
			}
			if (!$this->canSee($uid, $node->getId())) {
				continue;
			}
			$result[] = ['userId' => $uid, 'displayName' => (string)($eintrag['label'] ?? $uid)];
			if (count($result) >= self::MAX_CANDIDATES) {
				break;
			}
		}
		return $result;
	}

	/** @throws LeaderException */
	private function requireLeader(Node $node, string $actor): void {
		if (!$this->isLeader($node, $actor)) {
			throw new LeaderException(LeaderException::NOT_LEADER);
		}
	}

	/**
	 * Ob $uid die Datei in ihrem eigenen Dateibaum findet - dieselbe Frage,
	 * die UserFileResolver fuer die angemeldete Person stellt. Ein
	 * unbekanntes Konto wirft beim Aufloesen und zaehlt als "sieht sie nicht".
	 */
	private function canSee(string $uid, int $fileId): bool {
		try {
			return $this->rootFolder->getUserFolder($uid)->getById($fileId) !== [];
		} catch (\Throwable) {
			return false;
		}
	}
}
