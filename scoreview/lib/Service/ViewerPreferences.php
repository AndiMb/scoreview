<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCP\IConfig;

/**
 * Die Anzeigeeinstellungen des Viewers, je Nutzerin gespeichert.
 *
 * Warum serverseitig und nicht im `localStorage` des Browsers: Die App wird
 * bewusst auf mehreren Geraeten benutzt - am Rechner vorbereitet, am Tablet
 * auf dem Notenstaender gelesen. Eine Farbe, die auf dem einen Geraet gut
 * lesbar ist, soll auf dem anderen nicht neu gesucht werden muessen.
 *
 * Gelesen wird das ohne eigene HTTP-Anfrage: Der Anfangszustand haengt schon
 * an der Files-Seite (Listener\FilesLoadAdditionalScriptsListener), auf der
 * das Viewer-Bundle ohnehin geladen wird. Geschrieben wird ueber
 * Controller\PreferenceController.
 *
 * **Normalisiert wird hier, nicht im Browser.** Die Werte landen als
 * CSS-Farbe bzw. als Verzweigung im Viewer; was hier herausgeht, ist
 * garantiert eine `#rrggbb`-Farbe und einer der beiden bekannten Modi - ein
 * beliebiger String aus einem POST kann so gar nicht erst bis in ein
 * `style`-Attribut durchreichen.
 */
class ViewerPreferences {
	public const KEY_HIGHLIGHT_COLOR = 'highlight_color';
	public const KEY_HIGHLIGHT_MODE = 'highlight_mode';
	/** „Meine Stimme" auf ein Ohr, die uebrigen aufs andere. */
	public const KEY_STEREO_MY_PART = 'stereo_my_part';
	/** Dunkelmodus der Noten: dem Theme folgen oder fest hell/dunkel. */
	public const KEY_NOTE_THEME = 'note_theme';
	/** Praefix, dahinter die fileId - „Meine Stimme" gilt je Partitur. */
	public const KEY_MY_PART_PREFIX = 'my_part.';

	/**
	 * Obergrenze fuer eine Stimmen-ID. MuseScore vergibt kurze Zahlen
	 * (meta.json `parts[].id`); die Grenze haelt nur eine fremde Eingabe davon
	 * ab, beliebig viel in die Nutzereinstellungen zu schreiben.
	 */
	public const MAX_PART_ID_LENGTH = 64;

	/** Die klingenden Notenkoepfe selbst einfaerben (M10, wo das SVG es hergibt). */
	public const MODE_NOTES = 'notes';
	/** Stattdessen das Band an der klingenden Stelle zeigen. */
	public const MODE_BAR = 'bar';

	/**
	 * Kraeftiges Rot statt des frueheren Nextcloud-Blaus: Blau auf schwarzen
	 * Notenkoepfen ist zwar da, faellt beim Lesen aus einem Meter Abstand
	 * aber kaum auf (Nutzerrueckmeldung). Rot hebt sich sowohl von der
	 * schwarzen Druckfarbe als auch vom weissen Papier ab und kollidiert
	 * nicht mit dem gelben „meine Stimme"-Streifen.
	 */
	public const DEFAULT_COLOR = '#d32f2f';
	public const DEFAULT_MODE = self::MODE_NOTES;

	public const THEME_AUTO = 'auto';
	public const THEME_LIGHT = 'light';
	public const THEME_DARK = 'dark';
	/** Voreinstellung: dem Nextcloud-Theme folgen. */
	public const DEFAULT_THEME = self::THEME_AUTO;

	public function __construct(
		private IConfig $config,
	) {
	}

	/**
	 * @return array{highlightColor: string, highlightMode: string, stereoMyPart: bool, noteTheme: string}
	 */
	public function get(?string $userId): array {
		if ($userId === null) {
			return $this->defaults();
		}
		return [
			'highlightColor' => self::normalizeColor(
				$this->config->getUserValue($userId, Application::APP_ID, self::KEY_HIGHLIGHT_COLOR, self::DEFAULT_COLOR),
			),
			'highlightMode' => self::normalizeMode(
				$this->config->getUserValue($userId, Application::APP_ID, self::KEY_HIGHLIGHT_MODE, self::DEFAULT_MODE),
			),
			'stereoMyPart' => $this->config->getUserValue($userId, Application::APP_ID, self::KEY_STEREO_MY_PART, '0') === '1',
			'noteTheme' => self::normalizeTheme(
				$this->config->getUserValue($userId, Application::APP_ID, self::KEY_NOTE_THEME, self::DEFAULT_THEME),
			),
		];
	}

	/**
	 * Speichert die normalisierten Werte und gibt zurueck, was tatsaechlich
	 * gespeichert wurde - der Client uebernimmt das Ergebnis, statt seine
	 * eigene Eingabe als gesetzt anzunehmen.
	 *
	 * @return array{highlightColor: string, highlightMode: string}
	 */
	public function set(string $userId, string $highlightColor, string $highlightMode): array {
		$werte = [
			'highlightColor' => self::normalizeColor($highlightColor),
			'highlightMode' => self::normalizeMode($highlightMode),
		];
		$this->config->setUserValue($userId, Application::APP_ID, self::KEY_HIGHLIGHT_COLOR, $werte['highlightColor']);
		$this->config->setUserValue($userId, Application::APP_ID, self::KEY_HIGHLIGHT_MODE, $werte['highlightMode']);
		return $werte;
	}

	/**
	 * Stereobild und Dunkelmodus speichern - je Wert nur, wenn er mitkommt.
	 *
	 * Getrennt von set(), weil beide spaeter dazukamen: Ein Viewer, der sie
	 * noch nicht kennt (ein Browser mit dem Bundle von gestern im Cache),
	 * schickt sie nicht mit - und darf sie dann auch nicht auf die Vorgabe
	 * zuruecksetzen.
	 *
	 * @return array{stereoMyPart?: bool, noteTheme?: string} was tatsaechlich gespeichert wurde
	 */
	public function setDisplay(string $userId, ?bool $stereoMyPart, ?string $noteTheme): array {
		$werte = [];
		if ($stereoMyPart !== null) {
			$werte['stereoMyPart'] = $stereoMyPart;
			$this->config->setUserValue($userId, Application::APP_ID, self::KEY_STEREO_MY_PART, $stereoMyPart ? '1' : '0');
		}
		if ($noteTheme !== null) {
			$werte['noteTheme'] = self::normalizeTheme($noteTheme);
			$this->config->setUserValue($userId, Application::APP_ID, self::KEY_NOTE_THEME, $werte['noteTheme']);
		}
		return $werte;
	}

	/**
	 * „Meine Stimme" dieser Nutzerin fuer diese Partitur, oder null.
	 *
	 * Je Datei statt einmal fuer alle: Wer im einen Stueck Tenor singt, singt
	 * im naechsten womoeglich Bass - und Anfangston, Stimmnotizen und
	 * Intonation haengen alle an dieser Wahl. Geprueft wird nicht, ob es die
	 * Stimme in der Partitur gibt: Nach einem Re-Upload kann sie fehlen, und
	 * dann faellt der Viewer von selbst auf „keine" zurueck, ohne dass die
	 * Wahl fuer eine spaetere Fassung verloren waere.
	 */
	public function getMyPart(string $userId, int $fileId): ?string {
		$value = $this->config->getUserValue($userId, Application::APP_ID, self::KEY_MY_PART_PREFIX . $fileId, '');
		return self::normalizePartId($value);
	}

	/**
	 * Speichert die Wahl; null oder leer heisst „keine Stimme" und loescht den
	 * Eintrag, statt einen leeren Wert je geoeffneter Partitur anzuhaeufen.
	 *
	 * @return ?string was tatsaechlich gilt
	 */
	public function setMyPart(string $userId, int $fileId, ?string $partId): ?string {
		$partId = self::normalizePartId($partId ?? '');
		$key = self::KEY_MY_PART_PREFIX . $fileId;
		if ($partId === null) {
			$this->config->deleteUserValue($userId, Application::APP_ID, $key);
		} else {
			$this->config->setUserValue($userId, Application::APP_ID, $key, $partId);
		}
		return $partId;
	}

	/**
	 * @return ?string null bei leerem oder unbrauchbarem Wert
	 */
	public static function normalizePartId(string $value): ?string {
		$value = trim($value);
		if ($value === '' || mb_strlen($value) > self::MAX_PART_ID_LENGTH || preg_match('/[\x00-\x1f\x7f]/', $value) === 1) {
			return null;
		}
		return $value;
	}

	/**
	 * @return array{highlightColor: string, highlightMode: string, stereoMyPart: bool, noteTheme: string}
	 */
	public function defaults(): array {
		return [
			'highlightColor' => self::DEFAULT_COLOR,
			'highlightMode' => self::DEFAULT_MODE,
			// Aus: Wer die Funktion nicht kennt, hoert das Stueck wie
			// gewohnt.
			'stereoMyPart' => false,
			'noteTheme' => self::DEFAULT_THEME,
		];
	}

	/**
	 * Genau `#rrggbb`, sonst die Vorgabe. Die Kurzform `#rgb` wird
	 * ausgeschrieben statt abgelehnt - `<input type="color">` liefert zwar
	 * immer sechs Stellen, ein von Hand gesetzter Wert (occ) aber nicht
	 * zwingend.
	 */
	public static function normalizeColor(string $value): string {
		$value = strtolower(trim($value));
		if (preg_match('/^#[0-9a-f]{6}$/', $value) === 1) {
			return $value;
		}
		if (preg_match('/^#([0-9a-f])([0-9a-f])([0-9a-f])$/', $value, $treffer) === 1) {
			return '#' . $treffer[1] . $treffer[1] . $treffer[2] . $treffer[2] . $treffer[3] . $treffer[3];
		}
		return self::DEFAULT_COLOR;
	}

	/** Nur die drei bekannten Werte; alles andere folgt dem Theme. */
	public static function normalizeTheme(string $value): string {
		$value = trim($value);
		return in_array($value, [self::THEME_LIGHT, self::THEME_DARK], true) ? $value : self::THEME_AUTO;
	}

	/** Alles ausser `bar` bedeutet `notes` - nie ein dritter, nirgends behandelter Zustand. */
	public static function normalizeMode(string $value): string {
		return trim($value) === self::MODE_BAR ? self::MODE_BAR : self::MODE_NOTES;
	}
}
