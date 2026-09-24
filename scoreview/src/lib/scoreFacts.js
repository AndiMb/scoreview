// Partiturfakten: Tonhoehe meiner Stimme, Tonart, Grundton und
// Studierbuchstaben - rein, ohne DOM und ohne Player.
//
// Zwei Quellen, EINE Form (E3): Die Engine des lokalen Wegs schreibt
// `keySigs`/`rehearsalMarks` in meta.json, Stock-MuseScore auf dem Sidecar
// nicht. Entschieden wird am INHALT des Artefakts, nie am
// Konvertierungsweg - dasselbe Muster wie bei den M10-Klassen. Fehlt ein
// Feld, kommt es aus dem MIDI, das beide Wege erzeugen: Studierbuchstaben aus
// den Markern (FF 06), Tonarten aus FF 59 - dort ohne Modus, weil MuseScore
// das Moll-Byte gemessen immer auf 0 setzt.
//
// Mehrtaktpausen: Die Engine zaehlt Takte in der notierten Kette, der Viewer
// (measures.json, Notizen, Takteingabe) in der Kette, die MuseScore
// darstellt - dort ist eine Mehrtaktpause EIN Takt. Gemessen an einer
// Partitur mit drei leeren Takten vor Buchstabe D: Engine "D in Takt 8",
// measures.json kennt nur 6 Takte, D steht dort in Takt 6. Die Engine-Felder
// gelten deshalb nur, wenn beide Zaehlungen nachweislich dieselben sind
// (engineMeasuresMatch); sonst kommt die Lage aus dem MIDI, das ueber die
// Zeit auf measures.json abgebildet wird und damit von selbst in der
// Zaehlung des Viewers landet.

import { resolveMeasurePosition } from './scoreLayout.js'

/**
 * @typedef {{measure:number, concertKey:number, mode:?string}} KeyFact
 * @typedef {{measure:number, text:string}} MarkFact
 * @typedef {{keys:KeyFact[], marks:MarkFact[]}} ScoreFacts
 */

/**
 * Abstand der Tonika vom Dur-Grundton derselben Vorzeichen, in Halbtoenen.
 * Die Namen sind MuseScores `KeyMode`; `unknown`/`none` fehlen bewusst und
 * gelten als "kein Modus".
 */
const MODE_OFFSETS = {
	major: 0,
	ionian: 0,
	dorian: 2,
	phrygian: 4,
	lydian: 5,
	mixolydian: 7,
	minor: 9,
	aeolian: 9,
	locrian: 11,
}

/**
 * Ein MIDI-Marker liegt gerechnet oft einen Bruchteil einer Millisekunde VOR
 * dem Taktanfang (Gleitkomma aus der Tempokarte), measures.json dagegen auf
 * ganzen Millisekunden. Ohne diese Zugabe landete ein Buchstabe gelegentlich
 * im Takt davor. Ein Takt ist um Groessenordnungen laenger.
 */
const MARKER_EPSILON_MS = 1

/**
 * Der Ton meiner Stimme zur Partiturzeit t: der gerade klingende, sonst der
 * naechste Einsatz (zwischen zwei Phrasen will man den Ton hoeren, mit
 * dem es weitergeht, nicht den verklungenen).
 *
 * Klingen mehrere Noten (Akkord, divisi), gilt die zuletzt begonnene, bei
 * Gleichstand die hoechste - fuer eine Singstimme ist das die Melodienote.
 *
 * @param {Array<{onMs:number, offMs:number, pitch:number, channel:number}>} notes aus midiNotes.js
 * @param {?Iterable<number>} channels Kanaele meiner Stimme; null = alle
 * @param {number} tMs Partiturzeit
 * @return {?{pitch:number, onMs:number}}
 */
export function pitchAt(notes, channels, tMs) {
	const allowed = channels === null || channels === undefined ? null : new Set(channels)
	let sounding = null
	let next = null
	for (const note of notes ?? []) {
		if (allowed !== null && !allowed.has(note.channel)) {
			continue
		}
		if (note.onMs <= tMs && tMs < note.offMs) {
			if (sounding === null || note.onMs > sounding.onMs
				|| (note.onMs === sounding.onMs && note.pitch > sounding.pitch)) {
				sounding = note
			}
		} else if (note.onMs > tMs) {
			if (next === null || note.onMs < next.onMs
				|| (note.onMs === next.onMs && note.pitch > next.pitch)) {
				next = note
			}
		}
	}
	const hit = sounding ?? next
	return hit === null ? null : { pitch: hit.pitch, onMs: hit.onMs }
}

/**
 * Die Tonart am notierten Takt: die letzte Vorzeichnung bis einschliesslich
 * dieses Takts. Vor der ersten (Auftakt ohne eigene Vorzeichnung) gilt die
 * erste - ein Stueck beginnt nicht in einer anderen Tonart als seiner ersten.
 *
 * @param {KeyFact[]} keys nach Takt sortiert (fromArtifacts)
 * @param {number} measureNumber 1-basiert
 * @return {?{concertKey:number, mode:?string}} null ohne jede Tonart
 */
export function keyAt(keys, measureNumber) {
	if (!keys || keys.length === 0) {
		return null
	}
	let found = keys[0]
	for (const key of keys) {
		if (key.measure <= measureNumber) {
			found = key
		} else {
			break
		}
	}
	return { concertKey: found.concertKey, mode: found.mode ?? null }
}

/**
 * Der Grundton als MIDI-Tonhoehe. Ohne Modus gilt die Dur-Tonika:
 * Auf dem Sidecar-Weg ist Moll nicht erkennbar, und ein falsches Dur ist
 * dort die ehrliche Naeherung - der Ton liegt immerhin in der Tonleiter.
 *
 * @param {{concertKey:number, mode:?string}} key
 * @param {number} refOctave Oktave nach wissenschaftlicher Zaehlung, 4 = c'
 * @return {number}
 */
export function tonicPitch({ concertKey, mode }, refOctave = 4) {
	// Quintenzirkel: jedes Kreuz eine Quinte (7 Halbtoene) hoeher.
	const majorClass = ((concertKey * 7) % 12 + 12) % 12
	const offset = Object.hasOwn(MODE_OFFSETS, mode ?? '') ? MODE_OFFSETS[mode] : 0
	return (refOctave + 1) * 12 + (majorClass + offset) % 12
}

/**
 * Eingabe der Taktnavigation → Zieltakt. Nimmt "47", einen Studierbuchstaben
 * ("C") und die Form der Taktanzeige ("C+3") an, damit sich eine abgelesene
 * Angabe unveraendert eintippen laesst.
 *
 * Gross/klein zaehlt zuerst genau und erst dann ohne - Partituren mit "a" und
 * "A" als verschiedenen Buchstaben gibt es, aber selten.
 *
 * @param {string|number} input
 * @param {MarkFact[]} marks
 * @param {?number} totalMeasures obere Grenze, wenn bekannt
 * @return {?{measure:number, mark:?string}}
 */
export function resolveJumpTarget(input, marks, totalMeasures = null) {
	const text = String(input ?? '').trim()
	if (text === '') {
		return null
	}
	const inRange = (measure) => measure >= 1 && (totalMeasures === null || totalMeasures === undefined || measure <= totalMeasures)

	if (/^\d+$/.test(text)) {
		const measure = Number(text)
		return inRange(measure) ? { measure, mark: null } : null
	}

	const match = /^(.+?)\s*(?:\+\s*(\d+))?$/.exec(text)
	const name = match[1]
	const plus = match[2] ? Number(match[2]) : 0
	const list = marks ?? []
	const mark = list.find((m) => m.text === name)
		?? list.find((m) => m.text.toLowerCase() === name.toLowerCase())
	if (!mark) {
		return null
	}
	const measure = mark.measure + plus
	return inRange(measure) ? { measure, mark: mark.text } : null
}

/**
 * Taktanzeige mit Studierbuchstaben, "47 (C+3)" bzw. "44 (C)". Vor dem
 * ersten Buchstaben bleibt es bei der Zahl.
 *
 * @param {number} measure
 * @param {MarkFact[]} marks nach Takt sortiert
 * @return {string}
 */
export function formatMeasureWithMark(measure, marks) {
	let governing = null
	for (const mark of marks ?? []) {
		if (mark.measure <= measure) {
			governing = mark
		} else {
			break
		}
	}
	if (governing === null) {
		return String(measure)
	}
	const distance = measure - governing.measure
	return distance === 0
		? `${measure} (${governing.text})`
		: `${measure} (${governing.text}+${distance})`
}

/**
 * Eine Stelle, wie die Leitung sie ansagt: der Takt, und der
 * Studierbuchstabe nur, wenn der Takt genau einer ist („C" statt „C+3" -
 * „alle zu C" ist ein Ziel, „C+3" eine Rechnung).
 *
 * @param {?number} measure Taktnummer, 1-basiert; null/0 = keine Stelle
 * @param {MarkFact[]} marks
 * @return {?{measure:number, mark:?string}}
 */
export function positionWithMark(measure, marks) {
	if (!measure) {
		return null
	}
	const mark = (marks ?? []).find((m) => m.measure === measure)
	return { measure, mark: mark ? mark.text : null }
}

/**
 * Ob die Taktnummern der Engine-Felder die des Viewers sind.
 *
 * `meta.measures` zaehlt die notierten Takte, measures.json die
 * dargestellten; beide sind genau dann gleich lang, wenn es keine
 * Mehrtaktpause gibt (eine Mehrtaktpause fasst immer mindestens zwei Takte
 * zusammen). Ohne Taktrechtecke laesst sich nichts vergleichen - dann gibt
 * es auch nichts, wohin navigiert wuerde, und die Engine gilt.
 *
 * Fehlen measures.json am Ende Takte (nie gelayoutet), faellt das ebenfalls
 * hierher - harmlos, denn der MIDI-Weg ist auch dann richtig, nur ohne Modus.
 *
 * @param {?object} meta meta.json
 * @param {?object} measuresTimeline
 * @return {boolean}
 */
export function engineMeasuresMatch(meta, measuresTimeline) {
	const notated = Number(meta?.measures)
	const ids = Object.keys(measuresTimeline?.elements ?? {}).map(Number).filter(Number.isFinite)
	if (!Number.isFinite(notated) || ids.length === 0) {
		return true
	}
	return Math.max(...ids) + 1 === notated
}

/**
 * Ob die Studierbuchstaben das MIDI brauchen. Eigene Frage, damit der
 * Viewer das MIDI nur dann liest, wenn es die Buchstaben wirklich traegt
 * (wer keine Buchstaben hat oder die Engine-Felder nutzen kann, bezahlt
 * nichts dafuer).
 *
 * @param {?object} meta
 * @param {?object} measuresTimeline
 * @return {boolean}
 */
export function marksNeedMidi(meta, measuresTimeline) {
	return !Array.isArray(meta?.rehearsalMarks) || !engineMeasuresMatch(meta, measuresTimeline)
}

/**
 * Tonarten und Studierbuchstaben aus den Artefakten, in beiden Faellen in
 * derselben Form. Jedes Feld wird fuer sich entschieden: Liefert die Engine
 * es, gilt es - auch leer, denn "keine Buchstaben" ist dann eine Aussage und
 * kein fehlendes Feld. Ausnahme: Zaehlt die Engine anders als der Viewer
 * (Mehrtaktpausen, engineMeasuresMatch), kommen die Takte aus dem MIDI; den
 * Modus einer Tonart uebernimmt der Rueckfall dann aus der Engine, wo er
 * eindeutig ist.
 *
 * @param {?object} meta meta.json
 * @param {?{markers:Array<{timeMs:number,text:string}>, keySigs:Array<{timeMs:number,sf:number}>, durationMs:number}} midi aus midiNotes.js
 * @param {?{events:Array, times:number[]}} measuresTimeline measures.json als Timeline (scoreLayout.buildTimeline)
 * @return {ScoreFacts}
 */
export function fromArtifacts(meta, midi, measuresTimeline) {
	const trustEngine = engineMeasuresMatch(meta, measuresTimeline)
	const engineKeys = Array.isArray(meta?.keySigs)
		? meta.keySigs.map((k) => ({
				measure: Number(k.measure),
				concertKey: Number(k.concertKey),
				mode: Object.hasOwn(MODE_OFFSETS, k.mode ?? '') ? k.mode : null,
			}))
		: null
	const modeOf = engineModeLookup(engineKeys)
	const keys = engineKeys !== null && trustEngine
		? normalizeKeys(engineKeys)
		: normalizeKeys(midiToMeasures(midi?.keySigs, midi, measuresTimeline)
				.map(({ measure, event }) => ({ measure, concertKey: event.sf, mode: modeOf(event.sf) })))

	const marks = Array.isArray(meta?.rehearsalMarks) && trustEngine
		? firstPerText(meta.rehearsalMarks
				.map((m) => ({ measure: Number(m.measure), text: String(m.text ?? '').trim() })))
		: firstPerText(midiToMeasures(midi?.markers, midi, measuresTimeline)
				.map(({ measure, event }) => ({ measure, text: event.text })))

	return { keys, marks }
}

/**
 * Der Modus zu einer Vorzeichenzahl aus den Engine-Tonarten - nur, wenn er
 * dort eindeutig ist. Steht dieselbe Vorzeichnung einmal als Dur und einmal
 * als Moll in der Partitur, laesst sich ohne Taktbezug nicht sagen, welche
 * gemeint ist; dann lieber kein Modus (Dur-Tonika) als ein geratener.
 *
 * @param {?KeyFact[]} engineKeys
 * @return {(concertKey:number) => ?string}
 */
function engineModeLookup(engineKeys) {
	const modes = new Map()
	for (const key of engineKeys ?? []) {
		const seen = modes.get(key.concertKey)
		modes.set(key.concertKey, seen === undefined || seen === key.mode ? key.mode : null)
	}
	return (concertKey) => modes.get(concertKey) ?? null
}

/**
 * MIDI-Ereignisse (Partiturzeit, ausgerollt) auf notierte Takte. Die
 * Reihenfolge der Zeit bleibt erhalten - "erstes Vorkommen" heisst damit
 * "zuerst gespielt", und das ist bei Wiederholungen der erste Durchgang.
 *
 * @param {?Array<{timeMs:number}>} events
 * @param {?object} midi
 * @param {?object} measuresTimeline
 * @return {Array<{measure:number, event:object}>}
 */
function midiToMeasures(events, midi, measuresTimeline) {
	if (!events || !measuresTimeline || measuresTimeline.events.length === 0) {
		return []
	}
	const lastEvent = measuresTimeline.events[measuresTimeline.events.length - 1]
	const durationMs = midi?.durationMs ?? lastEvent.timeMs
	const result = []
	for (const event of events) {
		const position = resolveMeasurePosition(measuresTimeline, event.timeMs + MARKER_EPSILON_MS, durationMs)
		if (position) {
			result.push({ measure: position.measureNumber, event })
		}
	}
	return result
}

/**
 * Je Buchstabe das erste Vorkommen, nach Takt sortiert. Leere Texte (ein
 * Studierbuchstabe, der nur aus Formatierung bestand) fallen weg - sie
 * waeren weder anklickbar noch eintippbar.
 *
 * @param {MarkFact[]} marks
 * @return {MarkFact[]}
 */
function firstPerText(marks) {
	const seen = new Set()
	const result = []
	for (const mark of marks) {
		if (mark.text === '' || !Number.isFinite(mark.measure) || seen.has(mark.text)) {
			continue
		}
		seen.add(mark.text)
		result.push(mark)
	}
	return result.sort((a, b) => a.measure - b.measure)
}

/**
 * Nach Takt sortiert, je Takt die zuerst gespielte Vorzeichnung, und ohne
 * Wiederholungen derselben Tonart - MuseScore schreibt sie am Beginn jedes
 * Wiederholungsdurchgangs erneut ins MIDI, sie ist dort kein Wechsel.
 *
 * @param {KeyFact[]} keys
 * @return {KeyFact[]}
 */
function normalizeKeys(keys) {
	const perMeasure = new Map()
	for (const key of keys) {
		if (Number.isFinite(key.measure) && Number.isFinite(key.concertKey) && !perMeasure.has(key.measure)) {
			perMeasure.set(key.measure, key)
		}
	}
	const sorted = [...perMeasure.values()].sort((a, b) => a.measure - b.measure)
	return sorted.filter((key, i) => i === 0
		|| key.concertKey !== sorted[i - 1].concertKey
		|| key.mode !== sorted[i - 1].mode)
}
