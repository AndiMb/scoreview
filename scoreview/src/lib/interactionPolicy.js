// Eine Stelle fuer "darf diese Bedienung gerade wirken?" - statt verstreuter
// `if (performance)` in jedem Handler von ScoreViewer.vue. Wer eine neue
// Bedienung einbaut, traegt sie hier ein und fragt allowed(); vergisst er es,
// ist sie im Aufführungsmodus gesperrt (siehe unten), nicht offen.

/**
 * Alle Bedienungen, die die Policy kennt.
 *
 * - `seek`: Suchlauf, Takteingabe, Sprung zu einer Notiz
 * - `noteClick`: Klick auf eine Note springt dorthin
 * - `loop`: Loop setzen oder aendern
 * - `mixer`: Lautstaerke, Stumm, Solo, Instrument
 * - `annotate`: Notizen und Stempel anlegen, aendern, loeschen
 * - `play`: Wiedergabe starten oder anhalten
 * - `tone`: Anfangston - klingt, gehoert also im Aufführungsmodus gesperrt
 * - `settings`: Werkzeuge, die umstellen, was man sieht oder hoert -
 *   Metronom, Tempo, Darstellung, Notizanzeige, „Neu konvertieren",
 *   der Aufklapper „Probe" (Leitungen)
 * - `page`: Blaettern (Wischen, Pedal, PageUp/PageDown)
 * - `zoom`: Zoom und Vollbild
 * - `nextPiece`: naechstes/voriges Stueck der Setliste
 * - `followJump`: ein Positionssprung, den die Leitung schickt ("Folgt mir")
 */
export const ACTIONS = Object.freeze([
	'seek',
	'noteClick',
	'loop',
	'mixer',
	'annotate',
	'play',
	'tone',
	'settings',
	'page',
	'zoom',
	'nextPiece',
	'followJump',
])

/**
 * Was im Aufführungsmodus wirkt. Alles andere ist gesperrt:
 * Ein versehentlicher Tipp am Notenstaender darf nichts ausloesen, was man
 * hoert oder was die Stelle verliert.
 */
const PERFORMANCE_ALLOWED = new Set(['page', 'zoom', 'nextPiece', 'followJump'])

/** Was offline nicht wirken kann, weil es den Server braucht (§7.4). */
const OFFLINE_DENIED = new Set(['annotate', 'followJump'])

/**
 * What a visitor of a public link cannot do: notes and a leader's jumps
 * belong to an account, and the visitor has none. The server refuses both
 * routes anyway; blocked here, the controls do not appear in the first place.
 */
const GUEST_DENIED = new Set(['annotate', 'followJump'])

/**
 * @param {string} action eine der ACTIONS
 * @param {{performance?: boolean, following?: boolean, offline?: boolean, guest?: boolean}} ctx
 *   performance: Aufführungsmodus an; following: das Geraet folgt gerade
 *   einer Leitung; offline: der Viewer laeuft auf der Offline-Seite (E14);
 *   guest: a visitor of a public link, without an account
 * @return {boolean}
 */
export function allowed(action, { performance = false, following = false, offline = false, guest = false } = {}) {
	if (!ACTIONS.includes(action)) {
		// Unbekannt heisst gesperrt: Ein Tippfehler im Aktionsnamen darf den
		// Aufführungsmodus nicht unbemerkt aushebeln.
		return false
	}
	if (offline && OFFLINE_DENIED.has(action)) {
		// Offline gibt es keinen Server, der eine Notiz annaehme oder eine
		// Leitung schickte. Gesperrt statt still verloren.
		return false
	}
	if (guest && GUEST_DENIED.has(action)) {
		return false
	}
	if (action === 'followJump') {
		// Der Sprung der Leitung kommt nur an, solange gefolgt wird - auch im
		// Aufführungsmodus. Wer ihn nicht will, loest das Folgen;
		// gesperrt wird er hier nicht zusaetzlich.
		return following
	}
	if (performance) {
		return PERFORMANCE_ALLOWED.has(action)
	}
	// Ausserhalb des Aufführungsmodus wirkt alles, auch waehrend des Folgens:
	// Eigenes Navigieren ist erlaubt und loest das Folgen (followState.js)
	// - das ist eine Folge der Bedienung, keine Sperre.
	return true
}
