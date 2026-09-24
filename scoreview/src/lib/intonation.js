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
// **Referenz a' = 440 Hz fest.** Gegen eine abgesunkene
// Chorstimmung zu bewerten waere eine spaetere Erweiterung.

import { CLARITY_THRESHOLD } from './pitchDetect.js'

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
export function centsOff(hz, midiPitch, a4 = 440) {
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
	const channels = new Set(myChannels)
	const klingend = notes.filter((n) => channels.has(n.channel) && n.onMs <= scoreMs && scoreMs < n.offMs)
	if (klingend.length === 0) {
		return null
	}
	if (klingend.length === 1 || !Number.isFinite(hz)) {
		return klingend.reduce((a, b) => (b.pitch > a.pitch ? b : a))
	}
	return klingend.reduce((a, b) => (Math.abs(foldOctave(centsOff(hz, b.pitch))) < Math.abs(foldOctave(centsOff(hz, a.pitch))) ? b : a))
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
 * Die Problemstellen fuer die Liste „Takt 12, +38 Cent".
 *
 * @param {Array<{note:object, medianCents:?number, class:string}>} evaluations
 * @param {function(number): ?number} measureOf Partiturzeit → Taktnummer
 * @return {Array<{measure:?number, cents:number, class:string, onMs:number, index:number}>}
 */
export function problemList(evaluations, measureOf) {
	return evaluations
		.map((e, index) => ({ e, index }))
		.filter(({ e }) => e.class === 'yellow' || e.class === 'red')
		.map(({ e, index }) => ({
			measure: measureOf(e.note.onMs + ONSET_TOLERANCE_MS),
			cents: Math.round(e.medianCents),
			class: e.class,
			onMs: e.note.onMs,
			index,
		}))
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
	if (!events || events.length === 0 || staff === null || staff === undefined) {
		return []
	}
	const channels = new Set(myChannels ?? [])
	// Einmal nach Einsatz sortiert statt je Bewertung ueber alle Noten
	// gefiltert: Bei einer Aufnahme ueber eine ganze Partitur waren das
	// Bewertungen mal Noten Vergleiche im Hauptthread.
	const eigene = (notes ?? [])
		.filter((n) => channels.has(n.channel))
		.sort((a, b) => a.onMs - b.onMs)
	const marks = []
	evaluations.forEach((e, index) => {
		const event = nearestEvent(events, e.note.onMs)
		if (!event || Math.abs(event.timeMs - e.note.onMs) > toleranceMs) {
			return
		}
		const akkord = chordAt(eigene, e.note.onMs)
			.sort((a, b) => b.pitch - a.pitch)
		const rank = Math.max(0, akkord.findIndex((n) => n.pitch === e.note.pitch))
		marks.push({ elid: event.elid, staff, rank, size: Math.max(1, akkord.length), cls: e.class, index })
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
