// Die Bruecke zur mobilen Nextcloud-App - reines Modul, ohne DOM-Zugriff
// ausser dem uebergebenen Fenster.
//
// Die App oeffnet die Seite eines Direct Editors in einer Vollbild-WebView und
// stellt darin ein Objekt bereit, ueber das die Seite zurueckreden kann:
// Android als JS-Interface `DirectEditingMobileInterface`, iOS als
// Message-Handler gleichen Namens. Muster: nextcloud/whiteboard,
// src/utils/mobileInterface.ts.
//
// Ohne diese Bruecke gaebe es zwei Sackgassen: Der Ladebildschirm der App
// laege dauerhaft ueber der Seite (sie blendet ihn erst auf `loaded()` aus und
// meldet nach zehn Sekunden zusaetzlich einen Timeout), und das Schliessen
// haette keinen Adressaten - eine WebView hat keine Zurueck-Schaltflaeche, die
// von sich aus die Activity beendete.
//
// Fehlt die Bruecke, ist jeder Aufruf wirkungslos statt ein Fehler: Dieselbe
// Seite laeuft auch im gewoehnlichen Browser, und dort gibt es schlicht
// niemanden, dem etwas zu melden waere.

/** Der Name, unter dem beide Plattformen ihr Objekt ablegen. */
const BRUECKENNAME = 'DirectEditingMobileInterface'

/**
 * @param {Window} fenster Das Fenster, in dem die Bruecke zu suchen ist -
 *   als Argument, damit das Modul ohne Browser pruefbar bleibt.
 * @return {{verfuegbar: boolean, loading: () => boolean,
 *   loaded: () => boolean, close: () => boolean, reload: () => boolean,
 *   share: () => boolean}} Die Bruecke; jeder Aufruf meldet, ob er
 *   jemanden erreicht hat
 */
export function createBridge(fenster = globalThis) {
	const android = fenster?.[BRUECKENNAME]
	const ios = fenster?.webkit?.messageHandlers?.[BRUECKENNAME]

	/**
	 * @param {string} name Der Name der Nachricht, wie die App ihn kennt.
	 * @return {boolean} ob sie jemanden erreicht hat
	 */
	function rufe(name) {
		try {
			if (typeof android?.[name] === 'function') {
				android[name]()
				return true
			}
			if (typeof ios?.postMessage === 'function') {
				// iOS kennt keine Methodennamen, nur eine Nachricht je Handler -
				// der Name wandert deshalb in die Nutzlast.
				ios.postMessage(name)
				return true
			}
		} catch {
			// Eine WebView, die beim Aufruf wirft, ist immer noch besser als
			// eine Seite, die daran stirbt.
			return false
		}
		return false
	}

	return {
		/**
		 * Ob ueberhaupt jemand zuhoert. Nicht nur Diagnose: Am Schliessknopf
		 * entscheidet sich daran, ob er `close()` ruft oder in der Historie
		 * zurueckgeht (StandaloneFrame.vue).
		 */
		verfuegbar: Boolean(android || ios),

		/** Die App zeigt ihren eigenen Ladezustand. */
		loading: () => rufe('loading'),

		/**
		 * Die App blendet ihren Ladebildschirm aus. Gerufen wird das erst,
		 * wenn wirklich etwas zu sehen ist - Notenbild oder Fehlermeldung -,
		 * nicht schon beim Laden der Seite: Bei laufender Konvertierung laege
		 * er sonst minutenlang ueber einem leeren Viewer.
		 */
		loaded: () => rufe('loaded'),

		/** Die Activity beenden - der einzige Weg aus der WebView hinaus. */
		close: () => rufe('close'),

		/**
		 * Die App laedt die Seite mit einem FRISCHEN Token neu. Aus der Seite
		 * heraus ginge das nicht: Fuer `Manager::edit()` ist der Token ein
		 * Einmal-Token, ein blosses location.reload() liefe in die
		 * Fehlerseite der App.
		 */
		reload: () => rufe('reload'),

		/** Die Teilen-Ansicht der App. Heute ungenutzt, Teil ihrer Schnittstelle. */
		share: () => rufe('share'),
	}
}
