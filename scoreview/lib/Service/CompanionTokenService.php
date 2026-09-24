<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\Lock\ILockingProvider;
use OCP\Lock\LockedException;
use OCP\Security\ISecureRandom;

/**
 * Begleit-Token fuer die eigenstaendige Seite der mobilen Apps (S1 und E8
 * in docs/architecture.md).
 *
 * **Wozu.** Die Seite hat als Ausweis nur das Direct-Editing-Token, und das
 * gilt fuer genau EINE Datei (Middleware\DirectAccessMiddleware). Eine
 * Setliste braucht aber weitere Stuecke. Ein Begleit-Token ist die Erlaubnis
 * fuer genau eine weitere Datei, ausgestellt aus Sicht derselben Nutzerin -
 * nie mehr, als sie ohnehin oeffnen duerfte.
 *
 * **Aufbau:** `v1.<payload>.<mac>`, `payload` = base64url(JSON
 * `{uid, fid, purpose, exp, dt, ep}`), `mac` = base64url(HMAC-SHA256(Schluessel,
 * "scoreview-companion-v1|" + payload)). Selbsttragend statt als Zeile in der
 * Datenbank: Jede Anfrage der Seite prueft einen Token, und ein
 * Datenbankzugriff je Anfrage kostete gerade dort, wo viele Geraete
 * gleichzeitig blaettern (Konzert). Widerrufen wird stattdessen ueber drei
 * Hebel, die pro Anfrage geprueft werden:
 *
 * - `exp`: hart 12 h nach Ausgabe, nie verlaengert - genug fuer eine Probe
 *   oder ein Konzert, und ein abgegriffener Token veraltet von selbst.
 * - `dt`: gekuerzter SHA-256 des Direct-Editing-Tokens, mit dem er
 *   ausgegeben wurde. Die Middleware verlangt beide Header und gleicht ab;
 *   ist das Direct-Editing-Token weg, taugt der Begleiter nichts mehr. Das
 *   Direct-Editing-Token selbst steht nie im Begleiter.
 * - `ep`: eine Epoche je Nutzerin (Nutzereinstellung), die bei
 *   Passwortwechsel und Deaktivieren steigt (Listener\CompanionRevocationListener).
 *
 * Dazu das Geheimnis selbst: Wird es gewechselt, ist jeder Token ungueltig.
 *
 * Das Geheimnis wechseln - also alle Begleit-Token widerrufen:
 * `occ config:app:delete scoreview companion_secret`. Beim naechsten
 * Gebrauch entsteht ein neues; angelegt wird es sonst schon beim Installieren
 * und bei jedem Update (Migration\GenerateCompanionSecret).
 */
class CompanionTokenService {
	public const PURPOSE_SCORE = 'score';
	public const PURPOSE_SETLIST = 'setlist';

	/** 12 h: eine Probe oder ein Konzert, nicht laenger. */
	public const LIFETIME_SECONDS = 43200;

	/**
	 * Laengengrenzen VOR jedem Dekodieren: Ein Header von einem Megabyte soll
	 * nicht erst durch base64 und json_decode laufen, um dann abgelehnt zu
	 * werden. Ein echter Token ist rund 250 Zeichen lang.
	 */
	public const MAX_TOKEN_LENGTH = 1024;
	public const MAX_PAYLOAD_LENGTH = 700;

	public const SECRET_KEY = 'companion_secret';
	public const EPOCH_KEY = 'companion_epoch';

	private const VERSION = 'v1';
	/**
	 * Domaenentrennung: Dasselbe Geheimnis soll nie eine Signatur ergeben,
	 * die an anderer Stelle als etwas anderes durchginge - auch nicht fuer
	 * eine kuenftige Fassung dieses Formats.
	 */
	private const DOMAIN = 'scoreview-companion-v1|';
	/** 32 hexadezimale Zeichen = 128 Bit des Digests, genug gegen jede Kollision hier. */
	private const DIGEST_LENGTH = 32;
	private const HEX = '0123456789abcdef';

	/** Kein Dateipfad - ILockingProvider sperrt beliebige Schluessel. */
	private const LOCK_PATH = 'scoreview/companion_secret';
	private const LOCK_ATTEMPTS = 10;
	private const LOCK_WAIT_US = 50000;

	private ?string $key = null;

	public function __construct(
		private IAppConfig $appConfig,
		private IConfig $config,
		private ISecureRandom $random,
		private ITimeFactory $time,
		private ?ILockingProvider $locking = null,
	) {
	}

	/**
	 * Legt das Geheimnis an, falls es fehlt - aus dem Repair-Step bei
	 * Installation und Update (Migration\GenerateCompanionSecret), damit die
	 * erste Anfrage es nicht erst erzeugen muss.
	 *
	 * @return bool ob ein neues entstanden ist
	 */
	public function ensureSecret(): bool {
		if (self::isValidSecret($this->readSecret())) {
			return false;
		}
		$this->createSecret();
		return true;
	}

	/**
	 * Der Fingerabdruck eines Direct-Editing-Tokens, wie er als `dt` im
	 * Begleiter steht - gekuerzt, weil er nur wiedererkennen, nicht
	 * zurueckfuehren soll.
	 */
	public static function digest(string $directToken): string {
		return substr(hash('sha256', $directToken), 0, self::DIGEST_LENGTH);
	}

	/**
	 * @param string $purpose self::PURPOSE_SCORE oder self::PURPOSE_SETLIST
	 * @param string $directDigest digest() des Direct-Editing-Tokens der Anfrage
	 */
	public function issue(string $uid, int $fileId, string $purpose, string $directDigest): string {
		if (!in_array($purpose, [self::PURPOSE_SCORE, self::PURPOSE_SETLIST], true)) {
			throw new \InvalidArgumentException('Unbekannter Zweck');
		}
		$payload = self::base64UrlEncode(json_encode([
			'uid' => $uid,
			'fid' => $fileId,
			'purpose' => $purpose,
			'exp' => $this->time->getTime() + self::LIFETIME_SECONDS,
			'dt' => $directDigest,
			'ep' => $this->epoch($uid),
		], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
		return self::VERSION . '.' . $payload . '.' . $this->mac($payload);
	}

	/** Wann ein jetzt ausgegebener Token ablaeuft (Unix-Zeit) - fuer die Antwort an die Seite. */
	public function expiresAt(): int {
		return $this->time->getTime() + self::LIFETIME_SECONDS;
	}

	/**
	 * Prueft Aufbau, Signatur und Ablauf. Ob `dt`, `ep`, `uid` und `fid` zur
	 * Anfrage passen, entscheidet die Middleware - sie kennt die Anfrage.
	 *
	 * @return array{uid: string, fid: int, purpose: string, exp: int, dt: string, ep: int}
	 * @throws CompanionTokenException
	 */
	public function verify(string $token): array {
		if (strlen($token) > self::MAX_TOKEN_LENGTH) {
			throw new CompanionTokenException(CompanionTokenException::MALFORMED);
		}
		$parts = explode('.', $token);
		if (count($parts) !== 3 || $parts[0] !== self::VERSION) {
			throw new CompanionTokenException(CompanionTokenException::MALFORMED);
		}
		[, $payload, $mac] = $parts;
		if ($payload === '' || strlen($payload) > self::MAX_PAYLOAD_LENGTH
			|| preg_match('/^[A-Za-z0-9_-]+$/', $payload) !== 1
			|| preg_match('/^[A-Za-z0-9_-]{43}$/', $mac) !== 1) {
			throw new CompanionTokenException(CompanionTokenException::MALFORMED);
		}
		// Erst die Signatur, dann der Inhalt: Was nicht von uns stammt, wird
		// gar nicht erst als JSON gelesen.
		if (!hash_equals($this->mac($payload), $mac)) {
			throw new CompanionTokenException(CompanionTokenException::SIGNATURE);
		}

		$json = self::base64UrlDecode($payload);
		try {
			$claims = $json === null ? null : json_decode($json, true, 2, JSON_THROW_ON_ERROR);
		} catch (\JsonException) {
			$claims = null;
		}
		if (!is_array($claims)
			|| !is_string($claims['uid'] ?? null) || $claims['uid'] === ''
			|| !is_int($claims['fid'] ?? null) || $claims['fid'] <= 0
			|| !in_array($claims['purpose'] ?? null, [self::PURPOSE_SCORE, self::PURPOSE_SETLIST], true)
			|| !is_int($claims['exp'] ?? null)
			|| !is_string($claims['dt'] ?? null) || strlen($claims['dt']) !== self::DIGEST_LENGTH
			|| !is_int($claims['ep'] ?? null)) {
			throw new CompanionTokenException(CompanionTokenException::MALFORMED);
		}

		$now = $this->time->getTime();
		// Auch ein Ablauf WEITER als 12 h in der Zukunft gilt nicht: So einen
		// Token stellt dieser Server nie aus.
		if ($claims['exp'] <= $now || $claims['exp'] > $now + self::LIFETIME_SECONDS) {
			throw new CompanionTokenException(CompanionTokenException::EXPIRED);
		}

		return [
			'uid' => $claims['uid'],
			'fid' => $claims['fid'],
			'purpose' => $claims['purpose'],
			'exp' => $claims['exp'],
			'dt' => $claims['dt'],
			'ep' => $claims['ep'],
		];
	}

	/** Die aktuelle Epoche der Nutzerin - Token mit einer anderen gelten nicht mehr. */
	public function epoch(string $uid): int {
		return (int)$this->config->getUserValue($uid, Application::APP_ID, self::EPOCH_KEY, '0');
	}

	/** Widerruft alle Begleit-Token der Nutzerin (Passwortwechsel, Deaktivieren). */
	public function bumpEpoch(string $uid): void {
		$this->config->setUserValue($uid, Application::APP_ID, self::EPOCH_KEY, (string)($this->epoch($uid) + 1));
	}

	private function mac(string $payload): string {
		return self::base64UrlEncode(hash_hmac('sha256', self::DOMAIN . $payload, $this->key(), true));
	}

	/**
	 * Das Geheimnis: 32 Byte aus ISecureRandom, als `sensitive` gespeichert
	 * (in `occ config:app:list` und im Supportbericht geschwaerzt) und `lazy`
	 * (nicht bei jedem Seitenaufruf geladen). Gespeichert als 64 Hexzeichen,
	 * weil IAppConfig Text haelt.
	 */
	private function key(): string {
		if ($this->key !== null) {
			return $this->key;
		}
		$stored = $this->readSecret();
		if (!self::isValidSecret($stored)) {
			// Fehlt, oder von Hand auf etwas Kurzes gesetzt: Ein schwaches
			// Geheimnis waere schlimmer als ein neues.
			$stored = $this->createSecret();
		}
		$this->key = (string)hex2bin($stored);
		return $this->key;
	}

	private function readSecret(): string {
		return $this->appConfig->getValueString(Application::APP_ID, self::SECRET_KEY, '', lazy: true);
	}

	private static function isValidSecret(string $stored): bool {
		return preg_match('/^[0-9a-f]{64}$/', $stored) === 1;
	}

	/**
	 * Erzeugt das Geheimnis - unter einer Sperre und mit erneutem Lesen.
	 *
	 * **Warum.** Normalerweise legt es der Repair-Step an. Fehlt es trotzdem
	 * (Widerruf per `occ config:app:delete`, ein Update ohne `occ upgrade`),
	 * erzeugen es die ersten Anfragen. Kaemen zwei gleichzeitig, schriebe
	 * jede ihr eigenes, das spaetere gewoenne - und jeder Token, den die
	 * andere derweil unterschrieben hat, waere ungueltig, noch bevor er
	 * benutzt wurde. IAppConfig kennt kein „nur, wenn frei"; deshalb die
	 * Sperre ueber ILockingProvider und unter ihr ein frisches Lesen an der
	 * Zwischenablage von IAppConfig vorbei.
	 *
	 * Ohne verfuegbare Sperre (Dateisperren abgeschaltet, oder sie haelt
	 * jemand zu lange) bleibt nur das frische Lesen - das schmaelert das
	 * Fenster, schliesst es aber nicht; im schlimmsten Fall gilt ein eben
	 * ausgegebener Token nicht und die Seite holt einen neuen.
	 */
	private function createSecret(): string {
		$locked = $this->lock();
		try {
			$this->appConfig->clearCache(true);
			$stored = $this->readSecret();
			if (self::isValidSecret($stored)) {
				return $stored;
			}
			$stored = $this->random->generate(64, self::HEX);
			$this->appConfig->setValueString(Application::APP_ID, self::SECRET_KEY, $stored, lazy: true, sensitive: true);
			return $stored;
		} finally {
			if ($locked) {
				$this->locking?->releaseLock(self::LOCK_PATH, ILockingProvider::LOCK_EXCLUSIVE);
			}
		}
	}

	private function lock(): bool {
		if ($this->locking === null) {
			return false;
		}
		for ($attempt = 0; $attempt < self::LOCK_ATTEMPTS; $attempt++) {
			try {
				$this->locking->acquireLock(self::LOCK_PATH, ILockingProvider::LOCK_EXCLUSIVE, 'ScoreView companion secret');
				return true;
			} catch (LockedException) {
				usleep(self::LOCK_WAIT_US);
			}
		}
		return false;
	}

	private static function base64UrlEncode(string $bytes): string {
		return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
	}

	private static function base64UrlDecode(string $text): ?string {
		$decoded = base64_decode(strtr($text, '-_', '+/'), true);
		return $decoded === false ? null : $decoded;
	}
}
