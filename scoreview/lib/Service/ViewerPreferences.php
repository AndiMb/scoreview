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

	public function __construct(
		private IConfig $config,
	) {
	}

	/**
	 * @return array{highlightColor: string, highlightMode: string}
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
	 * @return array{highlightColor: string, highlightMode: string}
	 */
	public function defaults(): array {
		return [
			'highlightColor' => self::DEFAULT_COLOR,
			'highlightMode' => self::DEFAULT_MODE,
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

	/** Alles ausser `bar` bedeutet `notes` - nie ein dritter, nirgends behandelter Zustand. */
	public static function normalizeMode(string $value): string {
		return trim($value) === self::MODE_BAR ? self::MODE_BAR : self::MODE_NOTES;
	}
}
