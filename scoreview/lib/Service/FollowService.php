<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\FollowMapper;
use OCA\ScoreView\Db\FollowSession;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\DB\Exception as DbException;
use OCP\Files\Node;
use OCP\ICache;
use OCP\ICacheFactory;
use OCP\IMemcache;
use OCP\IUserManager;

/**
 * „Folgt mir" (E10 in docs/architecture.md): Eine Leitung sendet Position, Loop und Anfangston, alle
 * anderen Geraete mit derselben Partitur folgen.
 *
 * **Zustand mit Zaehlern statt Ereignissen.** Gespeichert
 * wird je Datei EIN Zustand: `position`, `loop` und `tone`, jeder mit einem
 * eigenen `seq`, dazu eine `version`, die bei jeder Aenderung steigt. Ein
 * Geraet vergleicht nur die Version und holt bei Abweichung den ganzen
 * Zustand; was es daraus macht, entscheidet es selbst an den Zaehlern
 * (src/lib/followState.js). Dadurch bekommt ein Nachzuegler oder ein Geraet
 * nach einem Funkloch den letzten Stand, und nichts wird nachgespielt.
 *
 * **Die Version ist zugleich die Kennung der Sitzung.** Eine neue Sitzung
 * beginnt nicht bei 1, sondern bei einer Zufallszahl: Ein Geraet, das die
 * alte Sitzung bei Version 3 verlassen hat (Funkloch, Tab im Hintergrund)
 * und in der neuen zufaellig wieder auf 3 traefe, bekaeme sonst ein 204 und
 * saehe die neue Sitzung nie. Derselbe Startwert steht als `state.session`
 * im Zustand - daran erkennt der Browser, dass seine Zaehler nicht mehr
 * gelten.
 *
 * **Lesen ohne Datenbank.** Den Loewenanteil einer Abfrage kostet
 * gemessen der Nextcloud-Start, nicht die Zeile - aber bei 40 Geraeten alle
 * 800 ms soll die Datenbank gar nicht erst mitlaufen, schon gar nicht unter
 * SQLite. Der Stand liegt deshalb im Cache, geschrieben wird er bei jeder
 * Aenderung der Leitung, gelesen bei jeder Abfrage; die Datenbank sieht nur
 * die Aenderungen und einen Fehlgriff je 30 s (lokaler Cache: je Sekunde). Ist `since` gleich der Version
 * im Cache, ist die Antwort ein 204.
 *
 * Welcher Cache: der verteilte, wenn einer eingerichtet ist, sonst der lokale
 * (APCu). Der lokale gehoert EINEM Server - bei mehreren Webservern ohne
 * verteilten Cache saehe ein Geraet eine Aenderung, die auf dem anderen
 * Server geschrieben wurde, erst nach Ablauf des Eintrags. Das waere ein
 * verlorener Sprung, keine Verzoegerung: Das Geraet bekaeme 204 auf einen
 * Stand, den es nicht mehr gibt. Deshalb gilt ein lokaler Eintrag nur
 * LOCAL_MAX_AGE_MS lang; danach fragt der naechste Aufruf die Datenbank. Bei
 * einem Webserver kostet das einen Lesezugriff je Sekunde und Datei, nicht je
 * Geraet - der Kurzschluss bleibt also fast vollstaendig erhalten.
 *
 * **Sitzungsende:** durch eine Leitung, oder 30 min ohne
 * Lebenszeichen. Das wird beim Lesen als „beendet" gewertet, auch aus dem
 * Cache; die Zeile raeumt CleanupOrphansJob ab.
 */
class FollowService {
	/**
	 * Lebensdauer eines Eintrags im verteilten Cache - die Obergrenze fuer
	 * eine Zeile, die jemand an der App vorbei aendert.
	 */
	public const CACHE_TTL = 30;
	/**
	 * Hoechstalter eines Eintrags im lokalen Cache. Geprueft wird an einem
	 * mitgespeicherten Zeitstempel in Millisekunden, nicht nur ueber die TTL:
	 * APCu rechnet in ganzen Sekunden ab dem Sekundenanfang, eine TTL von 1
	 * hielte einen Eintrag also bis zu 2 s.
	 */
	public const LOCAL_MAX_AGE_MS = 1000;
	public const LOCAL_CACHE_TTL = 1;
	/**
	 * Wie lange eine Anmeldung fuer Push gilt. Erneuert wird sie mit
	 * jeder Abfrage des Geraets, geschrieben aber hoechstens einmal je
	 * REFRESH_SECONDS - sonst schrieben 40 Geraete den gemeinsamen Eintrag im
	 * Sekundentakt und verloeren sich gegenseitig Anmeldungen.
	 */
	public const MEMBER_TTL = 120;
	public const MEMBER_REFRESH_SECONDS = 60;
	/** Obergrenze der Liste der Angemeldeten je Datei - Schutz, keine Fachgrenze. */
	public const MAX_MEMBERS = 500;
	/** Die Sperre um die Liste: Lebensdauer in s, Versuche, Wartezeit je Versuch. */
	private const MEMBER_LOCK_TTL = 5;
	private const MEMBER_LOCK_ATTEMPTS = 20;
	private const MEMBER_LOCK_WAIT_US = 5000;
	/** Hoechste Taktnummer, die angenommen wird - Schutz vor Unsinn, keine Fachgrenze. */
	public const MAX_MEASURE = 100000;
	/** Laenge eines Studierbuchstabens samt Zusatz („C+3", „A1"). */
	public const MAX_MARK_LENGTH = 16;
	/** So oft wird ein verlorenes Vergleichen-und-Tauschen wiederholt. */
	private const ATTEMPTS = 3;

	/** Die Version, die „keine Sitzung" bedeutet. */
	public const NO_SESSION = '0';

	private ICache $cache;
	/** Nur ein lokaler Cache: Eintraege gelten hoechstens LOCAL_MAX_AGE_MS. */
	private bool $localOnly;
	private int $ttl;

	public function __construct(
		private FollowMapper $mapper,
		private LeaderService $leaders,
		private IUserManager $userManager,
		private PushNotifier $push,
		private ITimeFactory $time,
		ICacheFactory $cacheFactory,
	) {
		$this->localOnly = !$cacheFactory->isAvailable();
		$this->cache = $this->localOnly
			? $cacheFactory->createLocal('scoreview')
			: $cacheFactory->createDistributed('scoreview');
		$this->ttl = $this->localOnly ? self::LOCAL_CACHE_TTL : self::CACHE_TTL;
	}

	/**
	 * Der aktuelle Stand, oder null, wenn er `$since` entspricht (204).
	 *
	 * @return ?array{version: string, active: bool, leaderUid?: string, leaderName?: string, heartbeat?: int, state?: array}
	 */
	public function read(int $fileId, ?string $since = null): ?array {
		$snapshot = $this->current($fileId);
		if ($since !== null && $since === $snapshot['version']) {
			return null;
		}
		return $snapshot;
	}

	/**
	 * Startet eine Sitzung oder uebernimmt die laufende. Mit
	 * `$measure` bekommen alle gleich die Stelle der Leitung - sonst stuenden
	 * die Folgegeraete nach dem Start dort, wo jede gerade war.
	 *
	 * @throws FollowException NOT_LEADER, INVALID, CONFLICT
	 */
	public function start(Node $node, string $actor, ?int $measure = null, ?string $mark = null): array {
		$this->requireLeader($node, $actor);
		$position = $measure === null ? null : $this->position($measure, $mark);
		$fileId = $node->getId();

		for ($attempt = 0; $attempt < self::ATTEMPTS; $attempt++) {
			$row = $this->mapper->findByFileId($fileId);
			if ($row !== null && !$this->expired($row)) {
				$expected = $row->getVersion();
				$state = $this->decode($row);
				$changed = false;
				if ($row->getLeaderUid() !== $actor) {
					$row->setLeaderUid($actor);
					$changed = true;
				}
				if ($position !== null) {
					$state['position'] = ['seq' => $state['position']['seq'] + 1] + $position;
					$changed = true;
				}
				$row->setHeartbeatAt($this->time->getDateTime());
				if ($changed) {
					$row->setState($this->encode($state));
					$row->setVersion($expected + 1);
					if (!$this->mapper->updateIfVersion($row, $expected)) {
						continue;
					}
					return $this->publish($fileId, $row, $actor);
				}
				// Dieselbe Leitung startet erneut: nur ein Lebenszeichen,
				// nichts, worauf die Geraete reagieren muessten.
				if (!$this->mapper->touchIfVersion($fileId, $expected, $row->getHeartbeatAt())) {
					continue;
				}
				return $this->snapshot($row);
			}

			if ($row !== null) {
				// Abgelaufen: Die alte Zeile ist nur noch nicht abgeraeumt.
				// Nur genau diese Fassung loeschen - hat ein gleichzeitiger
				// Start sie schon ersetzt, gehoert die neue Zeile ihm.
				$this->mapper->deleteIfVersion($fileId, $row->getVersion());
			}
			$session = random_int(1, 1000000000);
			$state = self::initialState($session);
			if ($position !== null) {
				$state['position'] = ['seq' => 1] + $position;
			}
			$now = $this->time->getDateTime();
			$row = new FollowSession();
			$row->setFileId($fileId);
			$row->setLeaderUid($actor);
			$row->setStartedAt($now);
			$row->setHeartbeatAt($now);
			$row->setVersion($session);
			$row->setState($this->encode($state));
			try {
				$this->mapper->insert($row);
			} catch (DbException $e) {
				// Zwei Leitungen starten im selben Augenblick: Der
				// Primaerschluessel laesst nur eine Sitzung zu, die
				// andere wird im naechsten Durchlauf zur Uebernahme.
				if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
					throw $e;
				}
				continue;
			}
			return $this->publish($fileId, $row, $actor);
		}
		throw new FollowException(FollowException::CONFLICT);
	}

	/**
	 * Eine Aenderung der Leitung: Position, Loop, Anfangston und/oder nur ein
	 * Lebenszeichen. Jede gesendete Angabe zaehlt ihr `seq` hoch - auch wenn
	 * sie dem alten Wert gleicht: „Nochmal ab C" ist ein neuer Befehl, auch
	 * wenn C schon der letzte war.
	 *
	 * @param array{position?: array{measure: int, mark?: ?string}, loop?: ?array{from: int, to: int}, clearLoop?: bool, tone?: bool, heartbeat?: bool} $changes
	 * @throws FollowException NOT_LEADER, NO_SESSION, OTHER_LEADER, INVALID, CONFLICT
	 */
	public function change(Node $node, string $actor, array $changes): array {
		$this->requireLeader($node, $actor);
		$position = isset($changes['position'])
			? $this->position((int)($changes['position']['measure'] ?? 0), $changes['position']['mark'] ?? null)
			: null;
		$loop = null;
		if (!empty($changes['clearLoop'])) {
			$loop = ['from' => null, 'to' => null];
		} elseif (isset($changes['loop'])) {
			$loop = $this->loopRange($changes['loop']);
		}
		$tone = !empty($changes['tone']);
		$fileId = $node->getId();

		for ($attempt = 0; $attempt < self::ATTEMPTS; $attempt++) {
			$row = $this->mapper->findByFileId($fileId);
			if ($row === null || $this->expired($row)) {
				throw new FollowException(FollowException::NO_SESSION);
			}
			if ($row->getLeaderUid() !== $actor) {
				throw new FollowException(FollowException::OTHER_LEADER);
			}
			$row->setHeartbeatAt($this->time->getDateTime());
			$expected = $row->getVersion();
			if ($position === null && $loop === null && !$tone) {
				// Nur das Lebenszeichen (alle 60 s): kein Zaehler, keine neue
				// Version. Geschrieben nur, wenn die Zeile noch die gelesene
				// Version traegt: Hat derweil jemand die Sitzung beendet, bleibt
				// sie beendet, statt als Geist weiterzuleben.
				//
				// Und bewusst NICHT in den Cache: Der Stand dieses Aufrufs ist
				// schon beim Schreiben womoeglich ueberholt - eine Aenderung,
				// die gleich danach eintrifft, laege sonst unter einem alten
				// Stand begraben, und die Geraete bekaemen 204 auf einen Sprung,
				// den sie nie gesehen haben. Das Lebenszeichen im Cache darf
				// dagegen alt sein: Er haelt hoechstens CACHE_TTL, die Grenze
				// liegt bei 30 min.
				if ($this->mapper->touchIfVersion($fileId, $expected, $row->getHeartbeatAt())) {
					return $this->snapshot($row);
				}
				continue;
			}
			$state = $this->decode($row);
			if ($position !== null) {
				$state['position'] = ['seq' => $state['position']['seq'] + 1] + $position;
			}
			if ($loop !== null) {
				$state['loop'] = ['seq' => $state['loop']['seq'] + 1] + $loop;
			}
			if ($tone) {
				// Serverzeit, nicht die des Leitungsgeraets: Verglichen wird
				// spaeter mit `serverNow` derselben Uhr, so spielen
				// Uhrabweichungen zwischen den Geraeten keine Rolle.
				$state['tone'] = ['seq' => $state['tone']['seq'] + 1, 'issuedAt' => $this->nowMs()];
			}
			$row->setState($this->encode($state));
			$row->setVersion($expected + 1);
			if ($this->mapper->updateIfVersion($row, $expected)) {
				return $this->publish($fileId, $row, $actor);
			}
		}
		throw new FollowException(FollowException::CONFLICT);
	}

	/**
	 * Beendet die Sitzung. Das darf jede Leitung, nicht nur die leitende -
	 * sonst bliebe eine Sitzung, deren Leitung gegangen ist, eine halbe
	 * Stunde lang stehen.
	 *
	 * @throws FollowException NOT_LEADER
	 */
	public function end(Node $node, string $actor): array {
		$this->requireLeader($node, $actor);
		$fileId = $node->getId();
		$this->mapper->deleteByFileId($fileId);
		$none = self::none();
		$this->cache->set($this->key($fileId), $this->entry($none), $this->ttl);
		$this->push->notify($this->members($fileId, $actor), $fileId, $none['version']);
		$this->cache->remove($this->membersKey($fileId));
		return $none;
	}

	/**
	 * Meldet `$uid` fuer Push an. Ohne laufende Sitzung oder ohne Push
	 * gibt es nichts anzumelden - die Antwort sagt dem Geraet, ob es sich auf
	 * Push verlassen darf oder abfragen muss.
	 */
	public function join(int $fileId, string $uid): bool {
		if (!$this->current($fileId)['active'] || !$this->push->isAvailable()) {
			return false;
		}
		$this->touchMember($fileId, $uid, true);
		return true;
	}

	/**
	 * Haelt eine Anmeldung am Leben - aus der Abfrage eines Geraets, das Push
	 * nutzt. Guenstig, weil es fast immer nur liest.
	 */
	public function refreshMember(int $fileId, string $uid): void {
		$this->touchMember($fileId, $uid, false);
	}

	public function nowMs(): int {
		return (int)$this->time->now()->format('Uv');
	}

	/**
	 * Der Zustand einer frischen Sitzung: alle Zaehler auf 0, also „noch nichts
	 * gesendet". Ein Geraet springt erst bei `seq > 0`.
	 *
	 * @return array{session: int, position: array, loop: array, tone: array}
	 */
	public static function initialState(int $session): array {
		return [
			'session' => $session,
			'position' => ['seq' => 0, 'measure' => null, 'mark' => null],
			'loop' => ['seq' => 0, 'from' => null, 'to' => null],
			'tone' => ['seq' => 0, 'issuedAt' => null],
		];
	}

	/**
	 * @return array{version: string, active: false}
	 */
	private static function none(): array {
		return ['version' => self::NO_SESSION, 'active' => false];
	}

	private function current(int $fileId): array {
		$snapshot = $this->cached($this->key($fileId));
		if ($snapshot === null) {
			$row = $this->mapper->findByFileId($fileId);
			$snapshot = $row === null ? self::none() : $this->snapshot($row);
			$this->fill($this->key($fileId), $snapshot);
		}
		// Auch aus dem Cache: Eine Sitzung ohne Lebenszeichen ist beendet,
		// ohne dass jemand die Zeile anfassen muesste.
		if ($snapshot['active'] && $this->time->getTime() - (int)$snapshot['heartbeat'] > FollowSession::TIMEOUT_SECONDS) {
			return self::none();
		}
		return $snapshot;
	}

	/**
	 * Der Stand aus dem Cache, oder null, wenn keiner da ist oder der lokale
	 * zu alt ist (siehe LOCAL_MAX_AGE_MS).
	 */
	private function cached(string $key): ?array {
		$entry = $this->cache->get($key);
		if (!is_array($entry) || !isset($entry['at'], $entry['snapshot']['version'])) {
			return null;
		}
		if ($this->localOnly && $this->nowMs() - (int)$entry['at'] > self::LOCAL_MAX_AGE_MS) {
			return null;
		}
		return $entry['snapshot'];
	}

	/**
	 * Der Cache-Eintrag: der Stand und wann er abgelegt wurde.
	 *
	 * @return array{at: int, snapshot: array}
	 */
	private function entry(array $snapshot): array {
		return ['at' => $this->nowMs(), 'snapshot' => $snapshot];
	}

	/**
	 * Legt einen aus der Datenbank gelesenen Stand in den Cache - aber nur,
	 * wenn dort noch keiner liegt. Sonst gewinnt ein Wettlauf die falsche
	 * Seite: Eine Abfrage liest die alte Zeile, die Leitung schreibt
	 * derweil Zeile und Cache neu, und danach legte die Abfrage den alten
	 * Stand wieder darueber. Alle Geraete, die den alten schon kennen,
	 * bekaemen bis zum Ablauf des Eintrags 204 - ein verlorener Sprung.
	 *
	 * APCu und Redis koennen „nur, wenn frei" (IMemcache::add); ein Cache
	 * ohne das bekommt ein gewoehnliches set - dort bleibt das Fenster, das
	 * der naechste Schreibzugriff der Leitung schliesst.
	 *
	 * Liegt dort ein lokaler Eintrag, der nur fuer `cached()` zu alt ist,
	 * scheitert `add` - dann fragt jeder Aufruf die Datenbank, bis APCu den
	 * Eintrag verwirft (hoechstens eine weitere Sekunde). Ueberschreiben
	 * waere billiger, oeffnete aber genau den Wettlauf oben wieder.
	 */
	private function fill(string $key, array $snapshot): void {
		if ($this->cache instanceof IMemcache) {
			$this->cache->add($key, $this->entry($snapshot), $this->ttl);
		} else {
			$this->cache->set($key, $this->entry($snapshot), $this->ttl);
		}
	}

	/**
	 * Schreibt einen neuen Stand in den Cache und benachrichtigt die
	 * Angemeldeten. Nur fuer Aenderungen, die eine neue Version geschrieben
	 * haben - ein Lebenszeichen geht nicht hierher (siehe change()).
	 *
	 * Offen bleibt ein schmales Fenster: Schreiben zwei Aenderungen kurz
	 * nacheinander und legt die fruehere ihren Stand als zweite in den Cache,
	 * liegt dort bis zu CACHE_TTL die aeltere Version. Ein Vergleich vor dem
	 * Schreiben schloesse das nicht (lesen und schreiben sind zwei Schritte),
	 * und die naechste Aenderung der Leitung raeumt es ohnehin auf.
	 */
	private function publish(int $fileId, FollowSession $row, string $actor): array {
		$snapshot = $this->snapshot($row);
		$this->cache->set($this->key($fileId), $this->entry($snapshot), $this->ttl);
		$this->push->notify($this->members($fileId, $actor), $fileId, $snapshot['version']);
		return $snapshot;
	}

	private function snapshot(FollowSession $row): array {
		$uid = $row->getLeaderUid();
		return [
			'version' => (string)$row->getVersion(),
			'active' => true,
			'leaderUid' => $uid,
			'leaderName' => $this->userManager->getDisplayName($uid) ?? $uid,
			'heartbeat' => $row->getHeartbeatAt()->getTimestamp(),
			'state' => $this->decode($row),
		];
	}

	private function expired(FollowSession $row): bool {
		return $this->time->getTime() - $row->getHeartbeatAt()->getTimestamp() > FollowSession::TIMEOUT_SECONDS;
	}

	/**
	 * Liest den gespeicherten Zustand und fuellt fehlende Teile auf - eine
	 * Zeile, deren JSON jemand von Hand gekuerzt hat, soll keinen Fehler
	 * werfen, sondern als „noch nichts gesendet" gelten.
	 */
	private function decode(FollowSession $row): array {
		$raw = json_decode((string)$row->getState(), true);
		$raw = is_array($raw) ? $raw : [];
		$state = self::initialState((int)($raw['session'] ?? $row->getVersion()));
		foreach (['position', 'loop', 'tone'] as $part) {
			if (isset($raw[$part]) && is_array($raw[$part])) {
				$state[$part] = array_merge($state[$part], $raw[$part]);
				$state[$part]['seq'] = (int)$state[$part]['seq'];
			}
		}
		return $state;
	}

	private function encode(array $state): string {
		return json_encode($state, JSON_THROW_ON_ERROR);
	}

	/**
	 * @return array{measure: int, mark: ?string}
	 * @throws FollowException INVALID
	 */
	private function position(int $measure, mixed $mark): array {
		if ($measure < 1 || $measure > self::MAX_MEASURE) {
			throw new FollowException(FollowException::INVALID);
		}
		if ($mark !== null && (!is_string($mark) || mb_strlen($mark) > self::MAX_MARK_LENGTH)) {
			throw new FollowException(FollowException::INVALID);
		}
		$mark = $mark === null ? null : trim($mark);
		return ['measure' => $measure, 'mark' => $mark === '' ? null : $mark];
	}

	/**
	 * @return array{from: int, to: int}
	 * @throws FollowException INVALID
	 */
	private function loopRange(mixed $loop): array {
		$from = is_array($loop) ? (int)($loop['from'] ?? 0) : 0;
		$to = is_array($loop) ? (int)($loop['to'] ?? 0) : 0;
		if ($from < 1 || $to < $from || $to > self::MAX_MEASURE) {
			throw new FollowException(FollowException::INVALID);
		}
		return ['from' => $from, 'to' => $to];
	}

	/** @throws FollowException */
	private function requireLeader(Node $node, string $actor): void {
		if (!$this->leaders->isLeader($node, $actor)) {
			throw new FollowException(FollowException::NOT_LEADER);
		}
	}

	/**
	 * Die fuer Push Angemeldeten, ohne die handelnde Leitung - sie hat die
	 * Aenderung selbst ausgeloest und braucht keine Nachricht darueber.
	 *
	 * @return list<string>
	 */
	private function members(int $fileId, string $except): array {
		$members = $this->cache->get($this->membersKey($fileId));
		if (!is_array($members)) {
			return [];
		}
		$cutoff = $this->time->getTime() - self::MEMBER_TTL;
		$result = [];
		foreach ($members as $uid => $seen) {
			// Rein numerische Kennungen werden als Array-Schluessel zu int.
			$uid = (string)$uid;
			if ($uid !== $except && (int)$seen >= $cutoff) {
				$result[] = $uid;
			}
		}
		return $result;
	}

	/**
	 * Traegt `$uid` in die Liste der Angemeldeten ein.
	 *
	 * **Warum unter einer Sperre.** Die Liste ist EIN Cache-Eintrag, und
	 * lesen-aendern-schreiben ist kein Schritt: Melden sich zu Probenbeginn
	 * zwanzig Geraete in derselben Sekunde an, schriebe jedes seine Fassung
	 * ueber die der anderen, und wer dabei verloren geht, bekommt bis zu
	 * seiner naechsten Erneuerung keinen Push - er merkt es erst an einem
	 * verpassten Sprung. Die Sperre ist ein eigener Schluessel, gesetzt mit
	 * IMemcache::add (APCu und Redis: „nur, wenn frei", in einem Schritt),
	 * mit kurzer Lebensdauer, damit ein abgebrochener Prozess sie nicht
	 * dauerhaft haelt. IMemcache::cas taete es auch, setzt aber keine
	 * Lebensdauer - der Eintrag bliebe unter Redis ewig liegen.
	 *
	 * Wartet ein Aufruf zu lange, schreibt er ohne Sperre: Eine Anmeldung, die
	 * vielleicht verloren geht, ist besser als eine Abfrage, die haengt. Ohne
	 * IMemcache (nur ein einfacher Cache) gibt es keine Sperre - dort laeuft
	 * ohnehin nur ein Webserver.
	 *
	 * Die Liste ist auf MAX_MEMBERS begrenzt (die zuletzt gesehenen bleiben),
	 * damit sie auch bei einer offenen Instanz nicht beliebig waechst.
	 */
	private function touchMember(int $fileId, string $uid, bool $force): void {
		$key = $this->membersKey($fileId);
		if (!$force && $this->isFresh($this->cache->get($key), $uid)) {
			return;
		}
		$locked = $this->lockMembers($fileId);
		try {
			$members = $this->cache->get($key);
			$members = is_array($members) ? $members : [];
			$now = $this->time->getTime();
			$members[$uid] = $now;
			// Abgelaufene gleich mit abraeumen, sonst waechst der Eintrag ueber
			// eine lange Probe mit jedem Geraet, das je da war.
			$members = array_filter($members, static fn ($seen) => $now - (int)$seen <= self::MEMBER_TTL);
			if (count($members) > self::MAX_MEMBERS) {
				arsort($members);
				$members = array_slice($members, 0, self::MAX_MEMBERS, true);
			}
			$this->cache->set($key, $members, self::MEMBER_TTL);
		} finally {
			if ($locked) {
				$this->cache->remove($this->membersLockKey($fileId));
			}
		}
	}

	private function isFresh(mixed $members, string $uid): bool {
		return is_array($members) && isset($members[$uid])
			&& $this->time->getTime() - (int)$members[$uid] < self::MEMBER_REFRESH_SECONDS;
	}

	private function lockMembers(int $fileId): bool {
		if (!($this->cache instanceof IMemcache)) {
			return false;
		}
		for ($attempt = 0; $attempt < self::MEMBER_LOCK_ATTEMPTS; $attempt++) {
			if ($this->cache->add($this->membersLockKey($fileId), 1, self::MEMBER_LOCK_TTL)) {
				return true;
			}
			usleep(self::MEMBER_LOCK_WAIT_US);
		}
		return false;
	}

	private function key(int $fileId): string {
		return 'follow:' . $fileId;
	}

	private function membersKey(int $fileId): string {
		return 'follow-members:' . $fileId;
	}

	private function membersLockKey(int $fileId): string {
		return 'follow-members-lock:' . $fileId;
	}
}
