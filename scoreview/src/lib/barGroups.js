// Die Werkzeuge der Bedienleiste, in Gruppen. Hier und nur hier steht, welches
// Werkzeug wann sichtbar ist und wohin es gehoert - der Viewer rendert die
// Gruppen nur und fragt pro Werkzeug `items.includes(id)`.
//
// Gruppen statt einer Knopfreihe: Die Reihe war auf bis zu 14 Werkzeuge
// gewachsen und passte auf keinem Tablet mehr neben den Transport. Draussen
// bleibt, was waehrend des Singens gebraucht wird (Transport, Vollbild); der
// Rest steht beisammen, wo man ihn sucht. What someone uses all the time they
// pin next to it (E23).
//
// Three groups by what a tool is about: what I hear and how I practise, what
// I see, and the score as a file and a piece of the rehearsal. Within a group
// the frequent tools come first; what is set once and left alone comes in a
// later section, below a divider.

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
 * @property {boolean} [singScoreEnabled] scored singing switched on by the
 *   administration (E24); it needs the intonation as well
 * @property {boolean} [offline] der Viewer laeuft auf der Offline-Seite: Was
 *   den Server braucht, entfaellt - ein Kontextwert, keine Weiche im Viewer
 * @property {boolean} [standalone] Direct Editing der mobilen Apps (E8) -
 *   dort gibt es die Offline-Seite nicht
 */

/** @typedef {'playback'|'view'|'score'} GroupId */

/**
 * @typedef {object} BarGroup
 * @property {GroupId} id which group
 * @property {string[][]} sections the visible tools, in sections divided by
 *   a line; empty sections are dropped
 * @property {string[]} items all visible tools of the group, flat
 */

export const GROUP_IDS = Object.freeze(['playback', 'view', 'score'])

/**
 * What a pinned button does (E23), by kind of tool: `panel` opens and closes
 * a card over the score, `switch` flips a setting, `page` opens the tool's
 * page in a popover of its own, `action` runs once. Zoom and the choice of
 * starting note are not here: zoom is a slider that already stands first in
 * "View", the starting note has its button in the transport.
 *
 * As ViewerPreferences::BAR_PIN_IDS - the server only stores ids from there.
 */
export const PINNABLE = Object.freeze({
	loop: 'page',
	metronome: 'switch',
	tempo: 'page',
	mixer: 'panel',
	transpose: 'page',
	coach: 'page',
	recording: 'panel',
	tuner: 'panel',
	practiceLog: 'panel',
	sing: 'panel',
	autoScroll: 'switch',
	myPart: 'switch',
	noteNames: 'page',
	annotations: 'panel',
	noteText: 'switch',
	layout: 'page',
	appearance: 'page',
	partChoice: 'panel',
	rehearsal: 'panel',
	newSetlist: 'action',
	print: 'action',
	export: 'page',
	offline: 'page',
	info: 'page',
})

export const MAX_PINS = 4

/**
 * Die sichtbaren Gruppen in Leistenreihenfolge, jede mit ihren sichtbaren
 * Werkzeugen. Leere Gruppen entfallen - ein Gruppenknopf, hinter dem nichts
 * steht, waere ein Knopf, der nichts tut.
 *
 * The order is the same for everyone: a leader reaches "Leaders and Follow
 * me" through the pin they get by default (barPins), not through a group
 * that moves depending on the role.
 *
 * @param {BarContext} ctx
 * @return {BarGroup[]}
 */
export function barGroups(ctx) {
	const { can } = ctx
	const settings = can('settings')
	const online = ctx.offline !== true
	const groups = {
		playback: [
			pick({
				loop: can('loop'),
				metronome: settings,
				tempo: settings,
				mixer: ctx.hasRealPlayer && can('mixer'),
				transpose: ctx.hasRealPlayer && settings,
				// Coach braucht eine eigene Stimme, die er hervorheben kann.
				coach: ctx.hasRealPlayer && ctx.canCoach === true && can('mixer'),
			}),
			// The microphone tools, together: same question for the microphone.
			pick({
				recording: (ctx.recordingEnabled || ctx.intonationEnabled) && settings && online,
				// The tuner (B3) hangs on the intonation switch: same analysis,
				// same microphone question. It needs no server, so it stays offline.
				tuner: ctx.intonationEnabled === true && settings,
				// Scored singing (E24) stores its runs on the server.
				sing: ctx.intonationEnabled === true && ctx.singScoreEnabled === true && settings && online,
			}),
			pick({
				// Practising is counted on the server; a page without one has
				// nothing to show (E20).
				practiceLog: ctx.practiceLogEnabled === true && settings && online,
			}),
		],
		view: [
			pick({
				// Zoom zuerst und ohne Unterseite: Im Auffuehrungsmodus ist es
				// das einzige Werkzeug, am Notenstaender das haeufigste.
				zoom: can('zoom'),
				// Without a submenu: it is flipped while reading, not set up
				// once (issue #12).
				autoScroll: settings,
				myPart: ctx.canFocusMyPart && settings,
				noteNames: settings,
				annotations: can('annotate'),
				noteText: settings,
			}),
			pick({
				layout: settings,
				appearance: settings,
			}),
		],
		score: [
			pick({
				// Without sound too: the highlight, note names, beat counts and
				// the print page use the choice as well (issue #18).
				partChoice: ctx.hasParts === true && settings,
				// Right below "my part": "my note" is the first note of it.
				toneMode: ctx.hasRealPlayer && can('tone'),
				rehearsal: settings && online,
				// „Neue Setliste" im Ordner der offenen Partitur (E11).
				newSetlist: settings && ctx.setlistCanCreate && online,
			}),
			pick({
				// The print page (E16) needs a session and a browser: the
				// mobile apps print through "open in browser", offline there
				// is no page.
				print: online && ctx.standalone !== true && settings,
				export: ctx.exportEnabled === true && ctx.hasRealPlayer && settings && online,
				// Vormerken geht nur von einer Seite aus, die online ist, und
				// nur im Browser - die Offline-Seite gibt es in den Apps nicht (E14).
				offline: ctx.offlineEnabled === true && online && ctx.standalone !== true && settings,
				info: settings,
			}),
		],
	}
	return GROUP_IDS
		.map((id) => {
			const sections = groups[id].filter((section) => section.length > 0)
			return { id, sections, items: sections.flat() }
		})
		.filter((group) => group.items.length > 0)
}

/**
 * The default until someone pins for themselves: the mixer, the tool most
 * looked for in a rehearsal; for a leader also "Leaders and Follow me",
 * which a leader works with during a rehearsal.
 *
 * @param {boolean} isLeader
 * @return {string[]}
 */
export function defaultPins(isLeader) {
	return isLeader ? ['mixer', 'rehearsal'] : ['mixer']
}

/**
 * The pinned buttons on the bar right now: only what is visible in a group
 * as well - a pinned mixer without sound or in performance mode disappears
 * like the tool itself instead of standing there greyed out.
 *
 * @param {BarGroup[]} groups barGroups()
 * @param {?string[]} pins as stored; null = never chosen
 * @param {boolean} isLeader
 * @return {Array<{id: string, kind: string}>}
 */
export function barPins(groups, pins, isLeader) {
	const visible = new Set(groups.flatMap((group) => group.items))
	return normalizePins(pins ?? defaultPins(isLeader))
		.filter((id) => visible.has(id))
		.map((id) => ({ id, kind: PINNABLE[id] }))
}

/**
 * Flip one pin. Pinning appends (the order is the order on the bar); at the
 * limit nothing changes - the pins are shown disabled then anyway
 * (pinLimitReached).
 *
 * @param {?string[]} pins as stored; null = never chosen
 * @param {string} id
 * @param {boolean} isLeader
 * @return {string[]} the new list, stored from now on
 */
export function togglePin(pins, id, isLeader) {
	const current = normalizePins(pins ?? defaultPins(isLeader))
	if (current.includes(id)) {
		return current.filter((pin) => pin !== id)
	}
	if (!(id in PINNABLE) || current.length >= MAX_PINS) {
		return current
	}
	return [...current, id]
}

/**
 * @param {?string[]} pins
 * @param {string} id
 * @param {boolean} isLeader
 * @return {boolean}
 */
export function isPinned(pins, id, isLeader) {
	return normalizePins(pins ?? defaultPins(isLeader)).includes(id)
}

/**
 * Counts the stored list, including what is hidden right now: otherwise a
 * fifth button could be pinned on a score without sound, and the next score
 * with sound would show five.
 *
 * @param {?string[]} pins
 * @param {boolean} isLeader
 * @return {boolean}
 */
export function pinLimitReached(pins, isLeader) {
	return normalizePins(pins ?? defaultPins(isLeader)).length >= MAX_PINS
}

/**
 * @param {unknown} pins
 * @return {string[]} known ids, each once, at most MAX_PINS
 */
function normalizePins(pins) {
	if (!Array.isArray(pins)) {
		return []
	}
	return [...new Set(pins.filter((id) => typeof id === 'string' && id in PINNABLE))].slice(0, MAX_PINS)
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
		case 'playback':
			// Eine Transposition gehoert dazu: Wer vergisst, dass alles einen
			// Ton tiefer klingt, singt in der Probe falsch an.
			return Boolean(s.metronomeEnabled || s.loopActive || s.trainerActive || s.showMixer || s.showPractice
				|| s.showTuner || s.showPracticeLog || s.coachActive || s.transposed)
		case 'view':
			return Boolean(s.focusMyPart || s.showNoteNames || s.showNoteText || s.showAnnotations)
		case 'score':
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
	return GROUP_IDS.some((id) => groupActive(id, s))
}
