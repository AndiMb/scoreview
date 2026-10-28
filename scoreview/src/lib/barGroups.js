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
 * @property {boolean} [hasParts] whether the score names parts to choose
 *   "my part" from - with or without sound (issue #18)
 * @property {boolean} [canCoach] ob es eine eigene Stimme gibt - der Coach
 *   braucht nur ihre Kanaele, keine Zuordnung der Notenzeilen
 * @property {boolean} recordingEnabled Aufnahme von der Administration an
 * @property {boolean} intonationEnabled Intonation von der Administration an
 * @property {boolean} setlistCanCreate ob im Ordner angelegt werden darf (E11)
 * @property {boolean} isLeader Leitung dieser Partitur (E9)
 * @property {boolean} [exportEnabled] Uebe-Tracks von der Administration an (E13)
 * @property {boolean} [offlineEnabled] Offline-Seite von der Administration an (E14)
 * @property {boolean} [practiceLogEnabled] practice log switched on by the
 *   administration (E20)
 * @property {boolean} [offline] der Viewer laeuft auf der Offline-Seite: Was
 *   den Server braucht, entfaellt - ein Kontextwert, keine Weiche im Viewer
 * @property {boolean} [standalone] Direct Editing der mobilen Apps (E8) -
 *   dort gibt es die Offline-Seite nicht
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
	const online = ctx.offline !== true
	const groups = {
		practice: pick({
			loop: can('loop'),
			tempo: settings,
			metronome: settings,
			toneMode: ctx.hasRealPlayer && can('tone'),
			mixer: ctx.hasRealPlayer && can('mixer'),
			// Coach braucht eine eigene Stimme, die er hervorheben kann.
			coach: ctx.hasRealPlayer && ctx.canCoach === true && can('mixer'),
			transpose: ctx.hasRealPlayer && settings,
			practice: (ctx.recordingEnabled || ctx.intonationEnabled) && settings && online,
			// The tuner (B3) hangs on the intonation switch: same analysis,
			// same microphone question. It needs no server, so it stays offline.
			tuner: ctx.intonationEnabled === true && settings,
			export: ctx.exportEnabled === true && ctx.hasRealPlayer && settings && online,
			// Practising is counted on the server; a page without one has
			// nothing to show (E20).
			practiceLog: ctx.practiceLogEnabled === true && settings && online,
		}),
		view: pick({
			// Zoom zuerst und ohne Unterseite: Im Auffuehrungsmodus ist es
			// das einzige Werkzeug, am Notenstaender das haeufigste.
			zoom: can('zoom'),
			layout: settings,
			appearance: settings,
			partChoice: ctx.hasParts === true && settings,
			myPart: ctx.canFocusMyPart && settings,
			// Without a submenu, like the switch above: it is flipped while
			// reading, not set up once (issue #12).
			autoScroll: settings,
			noteNames: settings,
			noteText: settings,
			annotations: can('annotate'),
			// The print page (E16) needs a session and a browser: the mobile
			// apps print through "open in browser", offline there is no page.
			print: online && ctx.standalone !== true && settings,
			// Vormerken geht nur von einer Seite aus, die online ist, und nur
			// im Browser - die Offline-Seite gibt es in den Apps nicht (E14).
			pin: ctx.offlineEnabled === true && online && ctx.standalone !== true && settings,
		}),
		rehearsal: pick({
			rehearsal: settings && online,
			newSetlist: settings && ctx.setlistCanCreate && online,
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
 * trainerActive, showMixer, showPractice, coachActive, transposed,
 * focusMyPart, showNoteNames, showNoteText, showAnnotations, showRehearsal
 * (Booleans) und setlistEditorMode ('new' | 'edit' | null).
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
			// Eine Transposition gehoert dazu: Wer vergisst, dass alles einen
			// Ton tiefer klingt, singt in der Probe falsch an.
			return Boolean(s.metronomeEnabled || s.loopActive || s.trainerActive || s.showMixer || s.showPractice
				|| s.showTuner || s.showPracticeLog || s.coachActive || s.transposed)
		case 'view':
			return Boolean(s.focusMyPart || s.showNoteNames || s.showNoteText || s.showAnnotations)
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
