// Die Werkzeuge der Bedienleiste, in Gruppen. Hier und nur hier steht, welches
// Werkzeug wann sichtbar ist und wohin es gehoert - der Viewer rendert die
// Gruppen nur und fragt pro Werkzeug `items.includes(id)`.
//
// Gruppen statt einer Knopfreihe: Die Reihe war auf bis zu 14 Werkzeuge
// gewachsen und passte auf keinem Tablet mehr neben den Transport. Draussen
// bleibt, was waehrend des Singens gebraucht wird (Transport, Vollbild); der
// Rest steht beisammen, wo man ihn sucht.

/**
 * @typedef {object} BarContext
 * @property {(action: string) => boolean} can die Interaktionsregel
 *   (lib/interactionPolicy.js) - im Auffuehrungsmodus bleibt so nur Zoom
 * @property {boolean} hasRealPlayer ob Ton da ist (Mixer, Anfangston-Modus)
 * @property {boolean} canFocusMyPart ob „nur meine Zeile" etwas bewirken kann
 * @property {boolean} recordingEnabled Aufnahme von der Administration an
 * @property {boolean} intonationEnabled Intonation von der Administration an
 * @property {boolean} setlistCanCreate ob im Ordner angelegt werden darf (E11)
 * @property {boolean} isLeader Leitung dieser Partitur (E9)
 */

/**
 * Die sichtbaren Gruppen in Leistenreihenfolge, jede mit ihren sichtbaren
 * Werkzeugen. Leere Gruppen entfallen - ein Gruppenknopf, hinter dem nichts
 * steht, waere ein Knopf, der nichts tut.
 *
 * Wer leitet, findet die Probe vorn: Dort wird waehrend einer Probe
 * gearbeitet. Fuer alle anderen steht sie zuletzt, aber sie steht da - die
 * Liste der Leitungen sehen bewusst alle (LeaderPanel.vue), und „Neue
 * Setliste" braucht jede, die im Ordner anlegen darf.
 *
 * @param {BarContext} ctx
 * @return {Array<{id: 'practice'|'view'|'rehearsal', items: string[]}>}
 */
export function barGroups(ctx) {
	const { can } = ctx
	const settings = can('settings')
	const groups = {
		practice: pick({
			loop: can('loop'),
			tempo: settings,
			metronome: settings,
			toneMode: ctx.hasRealPlayer && can('tone'),
			mixer: ctx.hasRealPlayer && can('mixer'),
			practice: (ctx.recordingEnabled || ctx.intonationEnabled) && settings,
		}),
		view: pick({
			// Zoom zuerst und ohne Unterseite: Im Auffuehrungsmodus ist es
			// das einzige Werkzeug, am Notenstaender das haeufigste.
			zoom: can('zoom'),
			appearance: settings,
			myPart: ctx.canFocusMyPart && settings,
			noteText: settings,
			annotations: can('annotate'),
		}),
		rehearsal: pick({
			rehearsal: settings,
			newSetlist: settings && ctx.setlistCanCreate,
		}),
	}
	const order = ctx.isLeader
		? ['rehearsal', 'practice', 'view']
		: ['practice', 'view', 'rehearsal']
	return order
		.map((id) => ({ id, items: groups[id] }))
		.filter((group) => group.items.length > 0)
}

/**
 * @param {Record<string, boolean>} flags
 * @return {string[]} die Schluessel, deren Wert wahr ist, in Schreibreihenfolge
 */
function pick(flags) {
	return Object.keys(flags).filter((key) => flags[key])
}

/**
 * Die Schalter des Viewers, gleichnamig: metronomeEnabled, loopActive,
 * trainerActive, showMixer, showPractice, focusMyPart, showNoteText,
 * showAnnotations, showRehearsal (Booleans) und setlistEditorMode
 * ('new' | 'edit' | null).
 *
 * @typedef {Record<string, boolean|string|null>} BarState
 */

/**
 * Ob in einer Gruppe etwas eingeschaltet ist - der Punkt am Gruppenknopf.
 * Ohne ihn verschwaende ein laufendes Metronom hinter einem geschlossenen
 * Aufklapper, und mitten in der Probe suchte jemand einen Schalter, den er
 * nicht sieht. Zoom und Darstellung zaehlen nicht: Sie sind Zustand, nichts,
 * das "noch laeuft".
 *
 * @param {string} id
 * @param {BarState} s
 * @return {boolean}
 */
export function groupActive(id, s) {
	switch (id) {
		case 'practice':
			return Boolean(s.metronomeEnabled || s.loopActive || s.trainerActive || s.showMixer || s.showPractice)
		case 'view':
			return Boolean(s.focusMyPart || s.showNoteText || s.showAnnotations)
		case 'rehearsal':
			return Boolean(s.showRehearsal || s.setlistEditorMode === 'new')
		default:
			return false
	}
}

/**
 * Der Punkt am „Mehr"-Knopf der kompakten Leiste: irgendeine Gruppe aktiv.
 *
 * @param {BarState} s
 * @return {boolean}
 */
export function anyGroupActive(s) {
	return ['practice', 'view', 'rehearsal'].some((id) => groupActive(id, s))
}
