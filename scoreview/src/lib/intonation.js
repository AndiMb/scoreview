// Gesungene Tonhoehe gegen die Note der eigenen Stimme - rein, ohne DOM
// (N-D2). Die Rahmen kommen aus lib/pitchDetect.js, die Noten aus
// lib/midiNotes.js, die Zuordnung Zeit → Partitur aus lib/recordingAlign.js.
//
// **Die Farbe haengt am Median nach dem Einschwingen** (D2-F3a): Ein
// Einsatz, der von unten kommt, ist Stimmbildung und kein Intonationsfehler,
// und Vibrato schwingt um den Ton herum - der Median mittelt es heraus, wo
// ein Mittelwert von einem einzelnen Ausreisser gezogen wuerde. Die
// `curve` behaelt dagegen alles, auch das Absacken am Notenende, zum
// Aufklappen.
//
// **Oktaven zaehlen nicht als Fehler.** Ein Tenor, der die Altstimme eine
// Oktave tiefer mitsingt, singt sie richtig. Gefaltet wird auf ±600 Cent um
// die Sollnote; eine Oktavverwechslung durch mehrstimmiges Signal faengt
// schon die Sicherheit (`clarity`) in pitchDetect.js ab.
//
// **Compared against a' = 440 only.** The adjustable reference is applied
// before, to the frames themselves (lib/referencePitch.js). Judging against
// a choir that has sunk as a whole would be a later extension.

import { CLARITY_THRESHOLD } from './pitchDetect.js'

/** a' the comparisons work in; the user's reference is lib/referencePitch.js. */
export const A4_HZ = 440

export const DEFAULT_THRESHOLDS = { green: 25, yellow: 50 }
/** Vorgabe, bis das Einschwingen an echten Laienstimmen gemessen ist (docs/limits.md). */
export const DEFAULT_SKIP_ATTACK_MS = 100
/**
 * Wie weit ein Einsatz vor dem Taktstrich liegen darf und trotzdem zum neuen
 * Takt zaehlt. Gemessen an Aequale: MuseScores MIDI rundet Ticks auf
 * Millisekunden, und die erste Note von Takt 3 steht dort bei 4799,992 ms,
 * der Takt bei 4800 - ohne Spielraum hiesse die Problemstelle „Takt 2".
 */
const ONSET_TOLERANCE_MS = 2

/** Mindestanteil auswertbarer Rahmen, sonst „nicht auswertbar". */
const MIN_VOICED_SHARE = 0.5

/**
 * Abweichung in Cent von der gleichstufigen Sollfrequenz.
 *
 * @param {number} hz
 * @param {number} midiPitch
 * @param {number} [a4]
 * @return {number}
 */
export function centsOff(hz, midiPitch, a4 = A4_HZ) {
	const target = a4 * 2 ** ((midiPitch - 69) / 12)
	return 1200 * Math.log2(hz / target)
}

/**
 * Auf die naechste Oktave der Sollnote gefaltet: -600 … +600.
 *
 * @param {number} cents
 * @return {number}
 */
export function foldOctave(cents) {
	return cents - 1200 * Math.round(cents / 1200)
}

/**
 * Drei Stufen, Vorgabe ±25/±50 Cent.
 *
 * @param {?number} cents
 * @param {{green:number, yellow:number}} [thresholds]
 * @return {'green'|'yellow'|'red'|'na'}
 */
export function classify(cents, thresholds = DEFAULT_THRESHOLDS) {
	if (cents === null || cents === undefined || !Number.isFinite(cents)) {
		return 'na'
	}
	const abs = Math.abs(cents)
	if (abs <= thresholds.green) {
		return 'green'
	}
	return abs <= thresholds.yellow ? 'yellow' : 'red'
}

/**
 * Die Note der eigenen Stimme an einer Partiturstelle.
 *
 * Bei einem Divisi (zwei Noten zugleich in der eigenen Stimme) die, die dem
 * gesungenen Ton am naechsten liegt - wer die untere singt, soll nicht an
 * der oberen gemessen werden.
 *
 * @param {Array<{onMs:number, offMs:number, pitch:number, channel:number}>} notes
 * @param {?Iterable<number>} myChannels
 * @param {number} scoreMs
 * @param {?number} [hz] gesungene Frequenz, fuer die Wahl im Divisi
 * @return {?object} die Note, oder null in einer Pause
 */
export function targetAt(notes, myChannels, scoreMs, hz = null) {
	if (!notes || !myChannels) {
		return null
	}
	return targetIn(ownNotes(notes, myChannels), scoreMs, hz)
}

/**
 * The notes of my part, sorted by onset once - the live needle asks for the
 * note under the cursor 50 times a second, and filtering all notes of the
 * score each time grew with the score, not with what sounds.
 *
 * @param {Array<{onMs:number, offMs:number, pitch:number, channel:number}>} notes
 * @param {?Iterable<number>} myChannels
 * @return {?{sorted: Array<object>, order: Map<object, number>, longestMs: number}}
 *   `order` is each note's place in `notes`, so ties resolve as before
 */
export function ownNotes(notes, myChannels) {
	if (!notes || !myChannels) {
		return null
	}
	const channels = new Set(myChannels)
	const order = new Map()
	const own = []
	let longestMs = 0
	notes.forEach((n, i) => {
		if (channels.has(n.channel)) {
			order.set(n, i)
			own.push(n)
			longestMs = Math.max(longestMs, n.offMs - n.onMs)
		}
	})
	return { sorted: own.sort((a, b) => a.onMs - b.onMs), order, longestMs }
}

/**
 * targetAt() on an ownNotes() index: the sounding notes are those with an
 * onset in (scoreMs - longest note, scoreMs], found by binary search.
 *
 * @param {?{sorted: Array<object>, order: Map<object, number>, longestMs: number}} index
 * @param {number} scoreMs
 * @param {?number} [hz]
 * @return {?object}
 */
export function targetIn(index, scoreMs, hz = null) {
	if (!index) {
		return null
	}
	const { sorted, order, longestMs } = index
	const klingend = []
	for (let i = firstOnsetAfter(sorted, scoreMs - longestMs - 1); i < sorted.length && sorted[i].onMs <= scoreMs; i++) {
		const n = sorted[i]
		if (scoreMs < n.offMs) {
			klingend.push(n)
		}
	}
	if (klingend.length === 0) {
		return null
	}
	// In score order, as the unsorted filter saw them: on equal pitch or
	// distance the first one wins.
	klingend.sort((a, b) => order.get(a) - order.get(b))
	if (klingend.length === 1 || !Number.isFinite(hz)) {
		return klingend.reduce((a, b) => (b.pitch > a.pitch ? b : a))
	}
	return klingend.reduce((a, b) => (Math.abs(foldOctave(centsOff(hz, b.pitch))) < Math.abs(foldOctave(centsOff(hz, a.pitch))) ? b : a))
}

/**
 * @param {Array<{onMs:number}>} sorted by onMs
 * @param {number} ms
 * @return {number} the first index with onMs > ms
 */
function firstOnsetAfter(sorted, ms) {
	let lo = 0
	let hi = sorted.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (sorted[mid].onMs <= ms) {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	return lo
}

/**
 * Ein Rahmen gegen eine Note: gefaltete Cent, oder null, wenn der Rahmen
 * nicht zaehlt.
 *
 * @param {{hz:?number, clarity:number}} frame
 * @param {number} pitch
 * @param {number} [clarityThreshold]
 * @return {?number}
 */
export function frameCents(frame, pitch, clarityThreshold = CLARITY_THRESHOLD) {
	if (!frame.hz || frame.clarity < clarityThreshold) {
		return null
	}
	return foldOctave(centsOff(frame.hz, pitch))
}

/**
 * Eine Note bewerten.
 *
 * @param {Array<{scoreMs:number, hz:?number, clarity:number}>} frames nach Zeit sortiert
 * @param {{onMs:number, offMs:number, pitch:number}} note
 * @param {object} [options]
 * @param {number} [options.skipAttackMs] Echtzeit-ms, die am Anfang nicht zaehlen
 * @param {number} [options.tempoFactor] Partitur-ms je Echtzeit-ms waehrend der Aufnahme
 * @param {{green:number, yellow:number}} [options.thresholds]
 * @param {number} [options.clarityThreshold]
 * @return {?{medianCents:?number, class:string, curve:Array<{scoreMs:number, cents:?number}>}} null, wenn die Aufnahme die Note nach dem Einschwingen nicht abdeckt
 */
export function evaluateNote(frames, note, options = {}) {
	const {
		skipAttackMs = DEFAULT_SKIP_ATTACK_MS,
		tempoFactor = 1,
		thresholds = DEFAULT_THRESHOLDS,
		clarityThreshold = CLARITY_THRESHOLD,
	} = options
	const inNote = frames.filter((f) => f.scoreMs >= note.onMs && f.scoreMs < note.offMs)
	if (inNote.length === 0) {
		return null
	}
	const curve = inNote.map((f) => ({ scoreMs: f.scoreMs, cents: frameCents(f, note.pitch, clarityThreshold) }))
	// Das Einschwingen in ECHTZEIT: Eine Stimme braucht dieselben 100 ms, ob
	// die Partitur langsam oder schnell laeuft.
	const bewertet = curve.filter((p) => p.scoreMs >= note.onMs + skipAttackMs * tempoFactor)
	if (bewertet.length === 0) {
		// Kuerzer als das Einschwingen, oder nur angeschnitten: Es gibt nichts,
		// woran sich die Note messen liesse - auch kein „nicht auswertbar".
		return null
	}
	const stimmhaft = bewertet.filter((p) => p.cents !== null)
	if (stimmhaft.length < 2 || stimmhaft.length < MIN_VOICED_SHARE * bewertet.length) {
		return { medianCents: null, class: 'na', curve }
	}
	const medianCents = median(stimmhaft.map((p) => p.cents))
	return { medianCents, class: classify(medianCents, thresholds), curve }
}

/**
 * Alle Noten der eigenen Stimme, die die Aufnahme abdeckt.
 *
 * @param {Array<{scoreMs:number, hz:?number, clarity:number}>} frames
 * @param {Array<object>} notes aus midiNotes.js
 * @param {?Iterable<number>} myChannels
 * @param {object} [options] wie evaluateNote()
 * @return {Array<{note:object, medianCents:?number, class:string, curve:Array}>}
 */
export function evaluateRecording(frames, notes, myChannels, options = {}) {
	if (!notes || !myChannels || frames.length === 0) {
		return []
	}
	const channels = new Set(myChannels)
	const vonMs = frames[0].scoreMs
	const bisMs = frames[frames.length - 1].scoreMs
	const result = []
	for (const note of notes) {
		if (!channels.has(note.channel) || note.offMs <= vonMs || note.onMs >= bisMs) {
			continue
		}
		const bewertung = evaluateNote(frames, note, options)
		if (bewertung) {
			result.push({ note, ...bewertung })
		}
	}
	return result.sort((a, b) => a.note.onMs - b.note.onMs)
}

/**
 * The problem spots for the list: "Measure 12, +38 cents", "80 ms late".
 * One entry per note, with every quantity that is off; its class is the
 * worst of them (decision D2 in Paket C: the note head shows the worst too).
 *
 * @param {Array<{note:object, medianCents:?number, class:string}>} evaluations
 * @param {function(number): ?number} measureOf score time → measure number
 * @param {Array<{onset:?{devMs:?number, class:string}, release:?{shortMs:?number, class:string}}>} [rhythm] from lib/rhythm.js, in the order of `evaluations`
 * @return {Array<{measure:?number, cents:?number, class:string, onMs:number, index:number, issues:Array<{kind:string, value:number, class:string}>}>}
 */
export function problemList(evaluations, measureOf, rhythm = []) {
	const off = (cls) => cls === 'yellow' || cls === 'red'
	const result = []
	evaluations.forEach((e, index) => {
		const issues = []
		if (off(e.class)) {
			issues.push({ kind: 'pitch', value: Math.round(e.medianCents), class: e.class })
		}
		const { onset, release } = rhythm[index] ?? {}
		if (onset && off(onset.class)) {
			issues.push({ kind: 'onset', value: Math.round(onset.devMs), class: onset.class })
		}
		if (release && off(release.class)) {
			issues.push({ kind: 'release', value: Math.round(release.shortMs), class: release.class })
		}
		if (issues.length === 0) {
			return
		}
		result.push({
			measure: measureOf(e.note.onMs + ONSET_TOLERANCE_MS),
			cents: off(e.class) ? Math.round(e.medianCents) : null,
			class: worstClass(...issues.map((i) => i.class)),
			onMs: e.note.onMs,
			index,
			issues,
		})
	})
	return result
}

const CLASS_RANK = { na: 0, green: 1, yellow: 2, red: 3 }

/**
 * The worst of several classes; "not evaluable" only if nothing else was
 * evaluated.
 *
 * @param {...?string} classes
 * @return {'green'|'yellow'|'red'|'na'}
 */
export function worstClass(...classes) {
	return classes.reduce((worst, cls) => ((CLASS_RANK[cls] ?? 0) > CLASS_RANK[worst] ? cls : worst), 'na')
}

/**
 * „+38", „−12", „±0" - mit echtem Minuszeichen.
 *
 * @param {number} cents
 * @return {string}
 */
export function formatCents(cents) {
	const r = Math.round(cents)
	if (r === 0) {
		return '±0'
	}
	return r > 0 ? `+${r}` : `−${-r}`
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Von der bewerteten Note zum Notenkopf im Bild (M10): Segment aus
 * `timing.json` ueber den Einsatzzeitpunkt, Zeile aus der eigenen Stimme,
 * und im Divisi der Rang von oben.
 *
 * Eine Note, deren Einsatz auf kein Segment faellt (Vorschlagsnote,
 * gerundete Zeiten), bekommt keine Markierung statt einer falschen. Bei
 * einer Wiederholung (M7) gehoert dasselbe Segment mehreren Durchgaengen -
 * gezeigt wird der zuletzt bewertete.
 *
 * @param {Array<{note:object, class:string}>} evaluations
 * @param {Array<object>} notes alle Noten (fuer den Divisi-Rang)
 * @param {?Iterable<number>} myChannels
 * @param {Array<{timeMs:number, elid:number}>} events aus timing.json, nach Zeit sortiert
 * @param {number} staff Notenzeile der eigenen Stimme (`st-N`)
 * @param {number} [toleranceMs]
 * @return {Array<{elid:number, staff:number, rank:number, size:number, cls:string, index:number}>}
 */
export function noteMarks(evaluations, notes, myChannels, events, staff, toleranceMs = 40) {
	return noteMarksIn(evaluations, ownNotes(notes ?? [], myChannels ?? []), events, staff, toleranceMs)
}

/**
 * noteMarks() on an ownNotes() index - for the live marks, which are built
 * again on every note change and need not sort the part each time.
 *
 * @param {Array<{note:object, class:string}>} evaluations
 * @param {?{sorted: Array<object>}} index ownNotes()
 * @param {Array<{timeMs:number, elid:number}>} events
 * @param {number} staff
 * @param {number} [toleranceMs]
 * @return {Array<{elid:number, staff:number, rank:number, size:number, cls:string, index:number}>}
 */
export function noteMarksIn(evaluations, index, events, staff, toleranceMs = 40) {
	if (!events || events.length === 0 || staff === null || staff === undefined) {
		return []
	}
	// Sorted by onset once (ownNotes) instead of filtering all notes per
	// evaluation: over a whole score that was evaluations times notes
	// comparisons on the main thread.
	const eigene = index?.sorted ?? []
	const marks = []
	evaluations.forEach((e, i) => {
		const event = nearestEvent(events, e.note.onMs)
		if (!event || Math.abs(event.timeMs - e.note.onMs) > toleranceMs) {
			return
		}
		const akkord = chordAt(eigene, e.note.onMs)
			.sort((a, b) => b.pitch - a.pitch)
		const rank = Math.max(0, akkord.findIndex((n) => n.pitch === e.note.pitch))
		marks.push({ elid: event.elid, staff, rank, size: Math.max(1, akkord.length), cls: e.class, index: i })
	})
	return marks
}

/**
 * Die Noten, die mit `onMs` zusammen einsetzen (weniger als 5 ms daneben).
 *
 * @param {Array<object>} sorted nach `onMs` sortiert
 * @param {number} onMs
 * @return {Array<object>}
 */
function chordAt(sorted, onMs) {
	let lo = 0
	let hi = sorted.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (sorted[mid].onMs <= onMs - 5) {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	const akkord = []
	for (let i = lo; i < sorted.length && sorted[i].onMs < onMs + 5; i++) {
		akkord.push(sorted[i])
	}
	return akkord
}

function nearestEvent(events, timeMs) {
	let lo = 0
	let hi = events.length - 1
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (events[mid].timeMs < timeMs) {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	const a = events[lo]
	const b = lo > 0 ? events[lo - 1] : null
	return b && Math.abs(b.timeMs - timeMs) <= Math.abs(a.timeMs - timeMs) ? b : a
}

/**
 * Whether the live needle has to be redrawn. The microphone delivers a frame
 * every 20 ms, and setting the needle re-renders the whole viewer (measured:
 * 174 ms CPU per second and 60 style recalculations per second with the
 * needle on, even with no note under the cursor). A change below one cent is
 * invisible on the needle, so only a different rounded value or class counts.
 *
 * @param {?{cents: ?number, cls: string}} prev
 * @param {{cents: ?number, cls: string}} next
 * @return {boolean}
 */
export function needleChanged(prev, next) {
	if (!prev) {
		return true
	}
	if (prev.cls !== next.cls) {
		return true
	}
	const a = prev.cents === null || prev.cents === undefined ? null : Math.round(prev.cents)
	const b = next.cents === null || next.cents === undefined ? null : Math.round(next.cents)
	return a !== b
}
