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
 * Every tool of the bar, in its group and section, with the rule for when it
 * is visible. One table for both questions the bar asks: what to show
 * (barGroups) and which group a running tool lights up (groupActive) - two
 * lists would drift apart. Each rule gets the BarContext plus `settings`
 * (can('settings')) and `online` (not the offline page).
 *
 * @type {Record<GroupId, Array<Record<string, (c: object) => boolean>>>}
 */
const SECTIONS = Object.freeze({
	playback: [
		{
			loop: (c) => c.can('loop'),
			metronome: (c) => c.settings,
			tempo: (c) => c.settings,
			mixer: (c) => c.hasRealPlayer && c.can('mixer'),
			transpose: (c) => c.hasRealPlayer && c.settings,
			// Coach braucht eine eigene Stimme, die er hervorheben kann.
			coach: (c) => c.hasRealPlayer && c.canCoach === true && c.can('mixer'),
		},
		// The microphone tools, together: same question for the microphone.
		{
			recording: (c) => (c.recordingEnabled || c.intonationEnabled) && c.settings && c.online,
			// The tuner (B3) hangs on the intonation switch: same analysis,
			// same microphone question. It needs no server, so it stays offline.
			tuner: (c) => c.intonationEnabled === true && c.settings,
			// Scored singing (E24) stores its runs on the server.
			sing: (c) => c.intonationEnabled === true && c.singScoreEnabled === true && c.settings && c.online,
		},
		{
			// Practising is counted on the server; a page without one has
			// nothing to show (E20).
			practiceLog: (c) => c.practiceLogEnabled === true && c.settings && c.online,
		},
	],
	view: [
		{
			// Zoom zuerst und ohne Unterseite: Im Auffuehrungsmodus ist es
			// das einzige Werkzeug, am Notenstaender das haeufigste.
			zoom: (c) => c.can('zoom'),
			// Without a submenu: it is flipped while reading, not set up
			// once (issue #12).
			autoScroll: (c) => c.settings,
			myPart: (c) => c.canFocusMyPart && c.settings,
			noteNames: (c) => c.settings,
			annotations: (c) => c.can('annotate'),
			noteText: (c) => c.settings,
		},
		{
			layout: (c) => c.settings,
			appearance: (c) => c.settings,
		},
	],
	score: [
		{
			// Without sound too: the highlight, note names, beat counts and
			// the print page use the choice as well (issue #18).
			partChoice: (c) => c.hasParts === true && c.settings,
			// Right below "my part": "my note" is the first note of it.
			toneMode: (c) => c.hasRealPlayer && c.can('tone'),
			rehearsal: (c) => c.settings && c.online,
			// „Neue Setliste" im Ordner der offenen Partitur (E11).
			newSetlist: (c) => c.settings && c.setlistCanCreate && c.online,
		},
		{
			// The print page (E16) needs a session and a browser: the
			// mobile apps print through "open in browser", offline there
			// is no page.
			print: (c) => c.online && c.standalone !== true && c.settings,
			export: (c) => c.exportEnabled === true && c.hasRealPlayer && c.settings && c.online,
			// Vormerken geht nur von einer Seite aus, die online ist, und
			// nur im Browser - die Offline-Seite gibt es in den Apps nicht (E14).
			offline: (c) => c.offlineEnabled === true && c.online && c.standalone !== true && c.settings,
			info: (c) => c.settings,
		},
	],
})

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
	const c = { ...ctx, settings: ctx.can('settings'), online: ctx.offline !== true }
	return GROUP_IDS
		.map((id) => {
			const sections = SECTIONS[id]
				.map((section) => Object.keys(section).filter((tool) => section[tool](c)))
				.filter((section) => section.length > 0)
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
 * What is on in the viewer, for the tools of the bar (toolOn) and the dots
 * of the groups (groupActive).
 *
 * @typedef {object} BarState
 * @property {string[]} panels the tool ids of the open cards over the score
 *   (mixer, recording, tuner, practiceLog, sing, annotations, rehearsal,
 *   partChoice)
 * @property {boolean} [metronomeEnabled] the metronome clicks along
 * @property {boolean} [autoScroll] the score scrolls along with playback
 * @property {boolean} [loopActive] a loop is set
 * @property {boolean} [trainerActive] the speed trainer - it runs on the loop
 * @property {boolean} [singActive] a run of scored singing (E24) is going on
 * @property {boolean} [coachActive] the coach plays my part on its own instrument
 * @property {number} [transpose] semitones that sound now
 * @property {boolean} [focusMyPart] only my staff is highlighted
 * @property {boolean} [showNoteNames] note names or beat counts are drawn
 * @property {boolean} [showNoteText] notes are shown in the score
 * @property {?string} [setlistEditorMode] 'new' | 'edit' | null
 */

/**
 * Whether a tool is on: an open card, a switch, and for a page tool whether
 * it is doing something (a running loop, a transposition). The pinned
 * button and the row in the group show it, and the group's dot is made of
 * it (groupActive) - one answer for all three.
 *
 * Scored singing counts while a run goes on, card open or not (A3): the
 * lane under the score keeps listening when the card is closed, and the
 * microphone with it - the dot shows where to stop it.
 *
 * @param {string} id a tool of PINNABLE
 * @param {BarState} s
 * @return {boolean}
 */
export function toolOn(id, s) {
	switch (id) {
		case 'metronome': return s.metronomeEnabled === true
		case 'autoScroll': return s.autoScroll === true
		case 'myPart': return s.focusMyPart === true
		case 'noteText': return s.showNoteText === true
		case 'loop': return s.loopActive === true || s.trainerActive === true
		case 'transpose': return (s.transpose ?? 0) !== 0
		case 'coach': return s.coachActive === true
		case 'noteNames': return s.showNoteNames === true
		case 'sing': return panelOpen(s, 'sing') || s.singActive === true
		case 'newSetlist': return s.setlistEditorMode === 'new'
		default: return PINNABLE[id] === 'panel' && panelOpen(s, id)
	}
}

/**
 * @param {BarState} s
 * @param {string} id
 * @return {boolean}
 */
function panelOpen(s, id) {
	return (s.panels ?? []).includes(id)
}

// Tools that are on as a standing preference rather than as something that
// runs: scrolling along is on for most people all the time, and a dot that
// is always lit says nothing.
const NO_DOT = new Set(['autoScroll'])

/**
 * Ob in einer Gruppe etwas eingeschaltet ist - der Punkt am Gruppenknopf.
 * Ohne ihn verschwaende ein laufendes Metronom hinter einem geschlossenen
 * Aufklapper, und mitten in der Probe suchte jemand einen Schalter, den er
 * nicht sieht. Zoom und Darstellung zaehlen nicht: Sie sind Zustand, nichts,
 * das "noch laeuft". A transposition does count: whoever forgets that
 * everything sounds a tone lower starts wrong in the rehearsal.
 *
 * Made of toolOn over the tools of the group, so a pressed tool and the dot
 * of its group cannot disagree.
 *
 * @param {string} id
 * @param {BarState} s
 * @return {boolean}
 */
export function groupActive(id, s) {
	return (SECTIONS[id] ?? []).some((section) => Object.keys(section)
		.some((tool) => !NO_DOT.has(tool) && toolOn(tool, s)))
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

// Short form of the note-name system for the row in the group.
const NOTE_NAME_SHORT = Object.freeze({ de: 'C D H', en: 'C D B', 'solfa-fixed': 'do', 'solfa-movable': 'do' })

/**
 * What a row shows of its tool at its end (ToolRow.vue): "♩ 80", "12–16".
 *
 * @param {string} id
 * @param {object} v
 * @param {boolean} [v.loopActive]
 * @param {number|string} [v.loopFrom]
 * @param {number|string} [v.loopTo]
 * @param {number} [v.tempoBpm]
 * @param {boolean} [v.tempoGuessed] "*" marks an estimated tempo (M8)
 * @param {number} [v.transpose]
 * @param {boolean} [v.coachActive]
 * @param {string} [v.noteNames] the note-name preference
 * @param {boolean} [v.countsOn] beat counts are drawn
 * @param {string} [v.layout] the chosen layout
 * @param {string} [v.myPartLabel]
 * @param {boolean} [v.exportRunning]
 * @param {(text: string) => string} t the caller's translation
 * @return {string}
 */
export function toolValue(id, v, t) {
	switch (id) {
		case 'loop': return v.loopActive ? `${v.loopFrom}–${v.loopTo}` : ''
		case 'tempo': return `♩ ${v.tempoBpm}${v.tempoGuessed ? '*' : ''}`
		case 'transpose': {
			const n = v.transpose ?? 0
			return n === 0 ? '' : (n > 0 ? `+${n}` : `−${-n}`)
		}
		case 'coach': return v.coachActive ? t('On') : ''
		case 'noteNames': return [
			v.noteNames && v.noteNames !== 'off' ? (NOTE_NAME_SHORT[v.noteNames] ?? '') : '',
			v.countsOn ? '1 + 2' : '',
		].filter(Boolean).join(' · ')
		case 'layout': return { pages: '', band: t('Band'), lyrics: t('Text') }[v.layout] ?? ''
		case 'partChoice': return v.myPartLabel ?? ''
		case 'export': return v.exportRunning ? '…' : ''
		default: return ''
	}
}
