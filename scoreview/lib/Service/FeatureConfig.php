<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCP\IAppConfig;

/**
 * Schalter und Zahlenwerte der Probe- und Konzertfunktionen, an EINER Stelle
 * gelesen und begrenzt.
 *
 * **Schalter:** Die Administration kann Leitung/„Folgt mir", Aufnahme,
 * Intonation und Mitverfolgen einzeln abschalten. Abgeschaltet heisst: Die
 * Endpunkte antworten 404, und der Viewer zeigt nichts davon. Das
 * Mitverfolgen steht auf aus, weil es noch nicht gebaut ist - ein Schalter,
 * der auf „an" steht und nichts bewirkt, waere eine falsche Auskunft.
 *
 * **Zahlenwerte:** Gelesen wird immer begrenzt. Ein per `occ` gesetzter
 * Unsinn (0 ms Abfrageintervall, eine Million Aufnahmen) soll nicht erst an
 * der Last des Servers auffallen.
 */
class FeatureConfig {
	public const FOLLOW_SESSION = 'feature_follow_session';
	public const RECORDING = 'feature_recording';
	public const INTONATION = 'feature_intonation';
	public const SCORE_FOLLOWER = 'feature_score_follower';

	public const FOLLOW_POLL_MS = 'follow_poll_ms';
	public const MAX_RECORDINGS_PER_SCORE = 'max_recordings_per_score';
	public const MAX_RECORDING_SECONDS = 'max_recording_seconds';
	public const MAX_RECORDING_BYTES_PER_USER = 'max_recording_bytes_per_user';
	public const MAX_RECORDING_BYTES_TOTAL = 'max_recording_bytes_total';

	private const MB = 1024 * 1024;

	/** @var array<string, bool> Schalter => Vorgabe */
	public const SWITCHES = [
		self::FOLLOW_SESSION => true,
		self::RECORDING => true,
		self::INTONATION => true,
		self::SCORE_FOLLOWER => false,
	];

	/**
	 * Vorgabe, Untergrenze, Obergrenze.
	 *
	 * `follow_poll_ms` (E10): 800 ms ist der gemessene Kompromiss -
	 * p95 knapp unter 0,8 s bei ~50 ms CPU je Abfrage. Unter 500 ms waere die
	 * Last bei 40 Geraeten nicht mehr vertretbar, ueber 3 s ist ein Sprung
	 * zur Leitung keiner mehr, sondern ein Nachziehen.
	 *
	 * `max_recording_seconds`: 600 s sind bei 16 kHz mono 16 bit etwa 19 MB
	 * je Aufnahme. Die Obergrenze von einer Stunde haelt eine einzelne
	 * Aufnahme unter der Groesse, die ein Upload in einem Stueck noch
	 * zuverlaessig schafft.
	 *
	 * `max_recording_bytes_per_user` und `max_recording_bytes_total` (S5 in
	 * docs/architecture.md): Aufnahmen liegen in IAppData und
	 * zaehlen damit gegen KEIN Kontingent der Nutzerin. Ohne eigene Grenzen
	 * koennte eine einzelne Person mit vielen Partituren den Datenspeicher der
	 * Instanz fuellen. 200 MB je Person sind rund zehn volle 10-Minuten-
	 * Aufnahmen; 5 GB instanzweit reichen fuer einen Chor mit 25 fleissigen
	 * Mitgliedern. Gespeichert in Bytes, damit `occ` und Rechnung dieselbe
	 * Einheit haben - die Oberflaeche zeigt MB.
	 *
	 * @var array<string, array{int, int, int}>
	 */
	public const NUMBERS = [
		self::FOLLOW_POLL_MS => [800, 500, 3000],
		self::MAX_RECORDINGS_PER_SCORE => [5, 1, 50],
		self::MAX_RECORDING_SECONDS => [600, 10, 3600],
		self::MAX_RECORDING_BYTES_PER_USER => [200 * self::MB, 10 * self::MB, 100 * 1024 * self::MB],
		self::MAX_RECORDING_BYTES_TOTAL => [5 * 1024 * self::MB, 100 * self::MB, 10 * 1024 * 1024 * self::MB],
	];

	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	public function isEnabled(string $switch): bool {
		if (!array_key_exists($switch, self::SWITCHES)) {
			return false;
		}
		return $this->appConfig->getValueBool(Application::APP_ID, $switch, self::SWITCHES[$switch]);
	}

	/**
	 * Ob irgendeine Funktion das Mikrofon braucht - nur dann gibt die App es
	 * in der Berechtigungsrichtlinie frei (S3). Eine Freigabe, die
	 * niemand nutzt, waere eine Tuer ohne Zweck.
	 */
	public function usesMicrophone(): bool {
		return $this->isEnabled(self::RECORDING)
			|| $this->isEnabled(self::INTONATION)
			|| $this->isEnabled(self::SCORE_FOLLOWER);
	}

	public function followPollMs(): int {
		return $this->number(self::FOLLOW_POLL_MS);
	}

	public function maxRecordingsPerScore(): int {
		return $this->number(self::MAX_RECORDINGS_PER_SCORE);
	}

	public function maxRecordingSeconds(): int {
		return $this->number(self::MAX_RECORDING_SECONDS);
	}

	public function maxRecordingBytesPerUser(): int {
		return $this->number(self::MAX_RECORDING_BYTES_PER_USER);
	}

	public function maxRecordingBytesTotal(): int {
		return $this->number(self::MAX_RECORDING_BYTES_TOTAL);
	}

	/**
	 * Was der Viewer beim ersten Rendern wissen muss - im Anfangszustand statt
	 * ueber eine eigene Anfrage (wer eine Funktion nicht nutzt, merkt
	 * nichts davon, auch keine zusaetzliche Anfrage).
	 *
	 * @return array{followSession: bool, recording: bool, intonation: bool, scoreFollower: bool, followPollMs: int, maxRecordingsPerScore: int, maxRecordingSeconds: int}
	 */
	public function forViewer(): array {
		return [
			'followSession' => $this->isEnabled(self::FOLLOW_SESSION),
			'recording' => $this->isEnabled(self::RECORDING),
			'intonation' => $this->isEnabled(self::INTONATION),
			'scoreFollower' => $this->isEnabled(self::SCORE_FOLLOWER),
			'followPollMs' => $this->followPollMs(),
			'maxRecordingsPerScore' => $this->maxRecordingsPerScore(),
			'maxRecordingSeconds' => $this->maxRecordingSeconds(),
		];
	}

	/**
	 * Speichert einen Zahlenwert begrenzt und gibt zurueck, was gespeichert
	 * wurde - die Oberflaeche zeigt danach den echten Wert statt der Eingabe.
	 */
	public function setNumber(string $key, int $value): int {
		$clamped = self::clamp($key, $value);
		$this->appConfig->setValueInt(Application::APP_ID, $key, $clamped);
		return $clamped;
	}

	public function setEnabled(string $switch, bool $enabled): void {
		if (array_key_exists($switch, self::SWITCHES)) {
			$this->appConfig->setValueBool(Application::APP_ID, $switch, $enabled);
		}
	}

	/**
	 * @throws \InvalidArgumentException bei einem unbekannten Schluessel -
	 *                                   ein Programmierfehler, keine Eingabe
	 */
	public static function clamp(string $key, int $value): int {
		if (!array_key_exists($key, self::NUMBERS)) {
			throw new \InvalidArgumentException('Unbekannter Zahlenwert: ' . $key);
		}
		[, $min, $max] = self::NUMBERS[$key];
		return max($min, min($max, $value));
	}

	/**
	 * Ein Zahlenwert, begrenzt - fuer Stellen, die den Schluessel als Wert
	 * herumreichen (das Admin-Formular).
	 */
	public function number(string $key): int {
		[$default] = self::NUMBERS[$key];
		return self::clamp($key, $this->appConfig->getValueInt(Application::APP_ID, $key, $default));
	}
}
