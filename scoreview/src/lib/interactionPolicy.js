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

/**
 * @param {string} action eine der ACTIONS
 * @param {{performance?: boolean, following?: boolean}} ctx
 *   performance: Aufführungsmodus an; following: das Geraet folgt gerade
 *   einer Leitung
 * @return {boolean}
 */
export function allowed(action, { performance = false, following = false } = {}) {
	if (!ACTIONS.includes(action)) {
		// Unbekannt heisst gesperrt: Ein Tippfehler im Aktionsnamen darf den
		// Aufführungsmodus nicht unbemerkt aushebeln.
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
