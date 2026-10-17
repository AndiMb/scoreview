import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseMidiNotes } from './midiNotes.js'
import {
	engineMeasuresMatch,
	formatMeasureWithMark,
	fromArtifacts,
	keyAt,
	keyByElid,
	marksNeedMidi,
	meterOf,
	metersFromArtifacts,
	pitchAt,
	positionWithMark,
	resolveJumpTarget,
	tonicPitch,
} from './scoreFacts.js'
import { buildTimeline } from './scoreLayout.js'

// measures.json der Testpartitur m1-test (lokaler Weg): Takt 1-2, Wiederholung von
// Takt 1, dann 3, 4, 5. elid = Takt - 1.
const measuresTimeline = buildTimeline({
	events: [
		{ elid: 0, timeMs: 0 },
		{ elid: 1, timeMs: 2000 },
		{ elid: 0, timeMs: 4000 },
		{ elid: 2, timeMs: 6000 },
		{ elid: 3, timeMs: 8000 },
		{ elid: 4, timeMs: 10000 },
	],
	elements: {},
})
const midi = parseMidiNotes(readFileSync(new URL('./__fixtures__/m1-test.mid', import.meta.url)))

// So liefert es die erweiterte Engine fuer dieselbe Partitur (E12).
const engineMeta = {
	measures: 5,
	keySigs: [
		{ measure: 1, tick: 0, concertKey: -3, mode: 'minor' },
		{ measure: 4, tick: 5760, concertKey: 2, mode: 'major' },
	],
	rehearsalMarks: [
		{ measure: 1, tick: 0, text: 'A' },
		{ measure: 3, tick: 3840, text: 'B' },
		{ measure: 4, tick: 5760, text: 'C' },
	],
}

describe('fromArtifacts', () => {
	it('nimmt die Engine-Felder, wenn meta.json sie traegt', () => {
		expect(fromArtifacts(engineMeta, midi, measuresTimeline)).toEqual({
			keys: [
				{ measure: 1, concertKey: -3, mode: 'minor' },
				{ measure: 4, concertKey: 2, mode: 'major' },
			],
			marks: [
				{ measure: 1, text: 'A' },
				{ measure: 3, text: 'B' },
				{ measure: 4, text: 'C' },
			],
		})
	})

	it('faellt ohne Engine-Felder auf das MIDI zurueck, in derselben Form und ohne Modus', () => {
		// Sidecar-Fall: Stock-MuseScore kennt die Felder nicht.
		expect(fromArtifacts({ measures: 5 }, midi, measuresTimeline)).toEqual({
			keys: [
				{ measure: 1, concertKey: -3, mode: null },
				{ measure: 4, concertKey: 2, mode: null },
			],
			// "A" steht im MIDI zweimal (Wiederholung) - es zaehlt das erste.
			marks: [
				{ measure: 1, text: 'A' },
				{ measure: 3, text: 'B' },
				{ measure: 4, text: 'C' },
			],
		})
	})

	it('entscheidet je Feld: ein leeres Engine-Feld ist eine Aussage, kein Rueckfall', () => {
		const facts = fromArtifacts({ keySigs: engineMeta.keySigs, rehearsalMarks: [] }, midi, measuresTimeline)
		expect(facts.marks).toEqual([])
		expect(facts.keys[0].mode).toBe('minor')
	})

	it('ordnet einen Marker knapp vor dem Taktanfang noch dem neuen Takt zu', () => {
		const facts = fromArtifacts(null, { markers: [{ timeMs: 7999.9999, text: 'C' }], keySigs: [], durationMs: 12000 }, measuresTimeline)
		expect(facts.marks).toEqual([{ measure: 4, text: 'C' }])
	})

	it('wirft unbekannte Modi und leere Buchstaben weg', () => {
		const facts = fromArtifacts({
			keySigs: [{ measure: 1, concertKey: 0, mode: 'unknown' }, { measure: 2, concertKey: 0, mode: 'toString' }],
			rehearsalMarks: [{ measure: 2, text: '  ' }, { measure: 5, text: ' D ' }],
		}, null, null)
		expect(facts.keys).toEqual([{ measure: 1, concertKey: 0, mode: null }])
		expect(facts.marks).toEqual([{ measure: 5, text: 'D' }])
	})

	it('liefert ohne Artefakte leere Listen statt eines Fehlers', () => {
		expect(fromArtifacts(null, null, null)).toEqual({ keys: [], marks: [] })
		expect(fromArtifacts({}, midi, buildTimeline({ events: [] }))).toEqual({ keys: [], marks: [] })
	})
})

// Mehrtaktpausen: m1-test plus drei leere Takte vor einem Schlusstakt mit
// Buchstabe D, Mehrtaktpausen eingeschaltet, lokal konvertiert. measures.json
// kennt 6 Takte (die drei leeren sind EINER), die Engine zaehlt 8.
const mmRestTimeline = buildTimeline({
	events: [
		{ elid: 0, timeMs: 0 },
		{ elid: 1, timeMs: 2000 },
		{ elid: 0, timeMs: 4000 },
		{ elid: 2, timeMs: 6000 },
		{ elid: 3, timeMs: 8000 },
		{ elid: 4, timeMs: 10000 },
		{ elid: 5, timeMs: 16000 },
	],
	elements: Object.fromEntries([0, 1, 2, 3, 4, 5].map((id) => [String(id), { page: 0, x: id * 100, y: 0, w: 100, h: 50 }])),
})
const mmRestMidi = parseMidiNotes(readFileSync(new URL('./__fixtures__/mmrest-test.mid', import.meta.url)))
const mmRestMeta = {
	measures: 8,
	keySigs: engineMeta.keySigs,
	rehearsalMarks: [...engineMeta.rehearsalMarks, { measure: 8, tick: 13440, text: 'D' }],
}

describe('Mehrtaktpausen', () => {
	it('erkennt, ob die Engine wie der Viewer zaehlt', () => {
		expect(engineMeasuresMatch(mmRestMeta, mmRestTimeline)).toBe(false)
		expect(engineMeasuresMatch({ ...mmRestMeta, measures: 6 }, mmRestTimeline)).toBe(true)
		// Ohne Taktrechtecke oder Taktzahl gibt es nichts zu vergleichen.
		expect(engineMeasuresMatch(engineMeta, measuresTimeline)).toBe(true)
		expect(engineMeasuresMatch({}, mmRestTimeline)).toBe(true)
	})

	it('nimmt die Takte dann aus dem MIDI - D steht in der Zaehlung des Viewers', () => {
		const facts = fromArtifacts(mmRestMeta, mmRestMidi, mmRestTimeline)
		expect(facts.marks).toEqual([
			{ measure: 1, text: 'A' },
			{ measure: 3, text: 'B' },
			{ measure: 4, text: 'C' },
			{ measure: 6, text: 'D' },
		])
	})

	it('behaelt dabei den Modus aus der Engine, wo er eindeutig ist', () => {
		expect(fromArtifacts(mmRestMeta, mmRestMidi, mmRestTimeline).keys).toEqual([
			{ measure: 1, concertKey: -3, mode: 'minor' },
			{ measure: 4, concertKey: 2, mode: 'major' },
		])
		const zweideutig = {
			...mmRestMeta,
			keySigs: [...mmRestMeta.keySigs, { measure: 7, concertKey: -3, mode: 'major' }],
		}
		expect(fromArtifacts(zweideutig, mmRestMidi, mmRestTimeline).keys[0]).toEqual({ measure: 1, concertKey: -3, mode: null })
	})

	it('liest das MIDI nur, wenn die Buchstaben es brauchen', () => {
		expect(marksNeedMidi(engineMeta, measuresTimeline)).toBe(false)
		expect(marksNeedMidi(mmRestMeta, mmRestTimeline)).toBe(true)
		expect(marksNeedMidi({ measures: 5 }, measuresTimeline)).toBe(true)
	})
})

describe('meterOf', () => {
	it('counts simple metres by the numerator with halves between', () => {
		expect(meterOf(4, 4)).toMatchObject({ beats: 4, beatTicks: 480, subdivisions: 2, ticks: 1920, pickup: false })
		expect(meterOf(3, 4)).toMatchObject({ beats: 3, beatTicks: 480, subdivisions: 2 })
		expect(meterOf(2, 2)).toMatchObject({ beats: 2, beatTicks: 960, subdivisions: 2 })
		expect(meterOf(3, 8)).toMatchObject({ beats: 3, beatTicks: 240, subdivisions: 2 })
	})

	it('feels compound metres in dotted beats with three parts', () => {
		expect(meterOf(6, 8)).toMatchObject({ beats: 2, beatTicks: 720, subdivisions: 3, ticks: 1440 })
		expect(meterOf(9, 8)).toMatchObject({ beats: 3, beatTicks: 720, subdivisions: 3 })
		expect(meterOf(12, 16)).toMatchObject({ beats: 4, beatTicks: 360, subdivisions: 3 })
	})

	it('gives a pickup as many beats as fit, at least one', () => {
		expect(meterOf(4, 4, 480)).toMatchObject({ beats: 1, beatTicks: 480, pickup: true, ticks: 480 })
		expect(meterOf(4, 4, 1440)).toMatchObject({ beats: 3, pickup: true })
		expect(meterOf(6, 8, 240)).toMatchObject({ beats: 1, pickup: true })
		// An irregular measure longer than its signature.
		expect(meterOf(4, 4, 2400)).toMatchObject({ beats: 5, pickup: false })
	})

	it('rejects an unusable signature', () => {
		expect(meterOf(0, 4)).toBeNull()
		expect(meterOf(4, 0)).toBeNull()
	})
})

describe('metersFromArtifacts', () => {
	// The engine's measureFacts for a pickup, 4/4, 3/4, 6/8 (timesig-test.mscz).
	const timesigMeta = {
		measures: 4,
		measureFacts: [
			{ measure: 1, tick: 0, sigN: 4, sigD: 4, ticks: 480 },
			{ measure: 2, tick: 480, sigN: 4, sigD: 4, ticks: 1920 },
			{ measure: 3, tick: 2400, sigN: 3, sigD: 4, ticks: 1440 },
			{ measure: 4, tick: 3840, sigN: 6, sigD: 8, ticks: 1440 },
		],
	}
	const timesigTimeline = buildTimeline({
		events: [{ elid: 0, timeMs: 0 }, { elid: 1, timeMs: 500 }, { elid: 2, timeMs: 2500 }, { elid: 3, timeMs: 4000 }],
		elements: Object.fromEntries([0, 1, 2, 3].map((id) => [String(id), { page: 0, x: id * 100, y: 0, w: 100, h: 50 }])),
	})

	it('takes the engine facts, one meter per measure, pickup included', () => {
		const meters = metersFromArtifacts(timesigMeta, null, timesigTimeline)
		expect(meters.map((m) => [m.n, m.d, m.beats, m.subdivisions, m.tick, m.pickup, m.source])).toEqual([
			[4, 4, 1, 2, 0, true, 'engine'],
			[4, 4, 4, 2, 480, false, 'engine'],
			[3, 4, 3, 2, 2400, false, 'engine'],
			[6, 8, 2, 3, 3840, false, 'engine'],
		])
	})

	it('falls back to the MIDI time signatures without engine facts', () => {
		// m1-test: 4/4 at 0 ms and again at the second pass - no change.
		const meters = metersFromArtifacts({ measures: 5 }, midi, measuresTimeline)
		expect(meters).toHaveLength(5)
		expect(meters.every((m) => m.n === 4 && m.d === 4 && m.beats === 4 && m.source === 'midi')).toBe(true)
	})

	it('applies a MIDI change from its measure on, and keeps the first signature before any change', () => {
		const timeSigs = [{ timeMs: 0, n: 4, d: 4 }, { timeMs: 5999.9, n: 6, d: 8 }]
		const meters = metersFromArtifacts({ measures: 5 }, { timeSigs, durationMs: 12000 }, measuresTimeline)
		expect(meters.map((m) => `${m.n}/${m.d}:${m.beats}`)).toEqual(['4/4:4', '4/4:4', '6/8:2', '6/8:2', '6/8:2'])
	})

	it('uses the MIDI where the engine counts differently (multi-measure rests)', () => {
		const meta = { ...mmRestMeta, measureFacts: Array.from({ length: 8 }, (_, i) => ({ measure: i + 1, tick: i * 1920, sigN: 4, sigD: 4, ticks: 1920 })) }
		const meters = metersFromArtifacts(meta, mmRestMidi, mmRestTimeline)
		expect(meters).toHaveLength(6)
		expect(meters[0].source).toBe('midi')
	})

	it('is empty without any source, and on an unusable fact', () => {
		expect(metersFromArtifacts({ measures: 5 }, null, measuresTimeline)).toEqual([])
		expect(metersFromArtifacts({ measures: 5 }, { timeSigs: [], durationMs: 1 }, measuresTimeline)).toEqual([])
		expect(metersFromArtifacts({ measures: 5 }, midi, buildTimeline({ events: [] }))).toEqual([])
		expect(metersFromArtifacts({ measures: 1, measureFacts: [{ measure: 1, tick: 0, sigN: 0, sigD: 4, ticks: 1 }] }, null, buildTimeline({ events: [{ elid: 0, timeMs: 0 }], elements: { 0: {} } }))).toEqual([])
	})
})

describe('keyAt / tonicPitch', () => {
	const keys = fromArtifacts(engineMeta, midi, measuresTimeline).keys

	it('findet die Tonart am Takt, auch nach einer Modulation', () => {
		expect(keyAt(keys, 1)).toEqual({ concertKey: -3, mode: 'minor' })
		expect(keyAt(keys, 3)).toEqual({ concertKey: -3, mode: 'minor' })
		expect(keyAt(keys, 4)).toEqual({ concertKey: 2, mode: 'major' })
		expect(keyAt(keys, 99)).toEqual({ concertKey: 2, mode: 'major' })
	})

	it('nimmt vor der ersten Vorzeichnung die erste, ohne jede Tonart null', () => {
		expect(keyAt([{ measure: 2, concertKey: 1, mode: null }], 1)).toEqual({ concertKey: 1, mode: null })
		expect(keyAt([], 1)).toBeNull()
	})

	it('unterscheidet Moll und Dur bei denselben Vorzeichen', () => {
		// 3 b: Es-Dur (63) oder c-Moll (60)
		expect(tonicPitch({ concertKey: -3, mode: 'major' })).toBe(63)
		expect(tonicPitch({ concertKey: -3, mode: 'minor' })).toBe(60)
		// 2 #: D-Dur, h-Moll
		expect(tonicPitch({ concertKey: 2, mode: 'major' })).toBe(62)
		expect(tonicPitch({ concertKey: 2, mode: 'minor' })).toBe(71)
	})

	it('nimmt ohne Modus die Dur-Tonika', () => {
		expect(tonicPitch({ concertKey: -3, mode: null })).toBe(63)
		expect(tonicPitch({ concertKey: 0, mode: null })).toBe(60)
		expect(tonicPitch({ concertKey: 7, mode: null })).toBe(61) // Cis-Dur
		expect(tonicPitch({ concertKey: -7, mode: null })).toBe(71) // Ces-Dur, enharmonisch H
	})

	it('verschiebt die Oktave', () => {
		expect(tonicPitch({ concertKey: 0, mode: null }, 3)).toBe(48)
	})
})

describe('pitchAt', () => {
	const notes = [
		{ onMs: 0, offMs: 500, pitch: 60, channel: 0 },
		{ onMs: 0, offMs: 500, pitch: 67, channel: 1 },
		{ onMs: 1000, offMs: 1500, pitch: 62, channel: 0 },
		{ onMs: 1000, offMs: 1500, pitch: 69, channel: 1 },
		{ onMs: 1000, offMs: 1500, pitch: 72, channel: 1 },
	]

	it('liefert den klingenden Ton meiner Stimme', () => {
		expect(pitchAt(notes, [0], 250)).toEqual({ pitch: 60, onMs: 0 })
		expect(pitchAt(notes, [1], 250)).toEqual({ pitch: 67, onMs: 0 })
	})

	it('liefert zwischen zwei Noten den naechsten Einsatz', () => {
		expect(pitchAt(notes, [0], 700)).toEqual({ pitch: 62, onMs: 1000 })
		// Genau am Notenende klingt sie nicht mehr.
		expect(pitchAt(notes, [0], 500)).toEqual({ pitch: 62, onMs: 1000 })
	})

	it('nimmt bei geteilter Stimme die hoechste Note', () => {
		expect(pitchAt(notes, [1], 1200)).toEqual({ pitch: 72, onMs: 1000 })
	})

	it('liefert nach der letzten Note null', () => {
		expect(pitchAt(notes, [0], 2000)).toBeNull()
	})

	it('nimmt ohne Kanalangabe alle Stimmen', () => {
		expect(pitchAt(notes, null, 250)).toEqual({ pitch: 67, onMs: 0 })
	})

	it('arbeitet mit den echten Noten der Testpartitur', () => {
		// Takt 3 beginnt bei 6000 ms mit d' (62).
		expect(pitchAt(midi.notes, [0], 6100)).toEqual({ pitch: 62, onMs: 6000 })
	})
})

describe('resolveJumpTarget', () => {
	const marks = [
		{ measure: 1, text: 'A' },
		{ measure: 17, text: 'B' },
		{ measure: 44, text: 'C' },
		{ measure: 60, text: 'Coda' },
	]

	it('nimmt eine Taktnummer', () => {
		expect(resolveJumpTarget('47', marks)).toEqual({ measure: 47, mark: null })
		expect(resolveJumpTarget(12, marks)).toEqual({ measure: 12, mark: null })
	})

	it('nimmt einen Studierbuchstaben, auch klein geschrieben', () => {
		expect(resolveJumpTarget('C', marks)).toEqual({ measure: 44, mark: 'C' })
		expect(resolveJumpTarget(' c ', marks)).toEqual({ measure: 44, mark: 'C' })
		expect(resolveJumpTarget('Coda', marks)).toEqual({ measure: 60, mark: 'Coda' })
	})

	it('nimmt die Form der Taktanzeige', () => {
		expect(resolveJumpTarget('C+3', marks)).toEqual({ measure: 47, mark: 'C' })
		expect(resolveJumpTarget('B + 2', marks)).toEqual({ measure: 19, mark: 'B' })
	})

	it('lehnt Unbekanntes und Ausserhalb ab', () => {
		expect(resolveJumpTarget('X', marks)).toBeNull()
		expect(resolveJumpTarget('', marks)).toBeNull()
		expect(resolveJumpTarget('0', marks)).toBeNull()
		expect(resolveJumpTarget('61', marks, 60)).toBeNull()
		expect(resolveJumpTarget('Coda+1', marks, 60)).toBeNull()
		expect(resolveJumpTarget('A', null)).toBeNull()
	})
})

describe('formatMeasureWithMark', () => {
	const marks = [{ measure: 17, text: 'B' }, { measure: 44, text: 'C' }]

	it('zeigt den Abstand zum vorangehenden Buchstaben', () => {
		expect(formatMeasureWithMark(47, marks)).toBe('47 (C+3)')
		expect(formatMeasureWithMark(44, marks)).toBe('44 (C)')
		expect(formatMeasureWithMark(20, marks)).toBe('20 (B+3)')
	})

	it('bleibt vor dem ersten Buchstaben bei der Zahl', () => {
		expect(formatMeasureWithMark(3, marks)).toBe('3')
		expect(formatMeasureWithMark(3, [])).toBe('3')
	})
})

describe('positionWithMark', () => {
	const marks = [{ measure: 17, text: 'B' }, { measure: 44, text: 'C' }]

	it('nennt den Buchstaben nur auf genau seinem Takt', () => {
		expect(positionWithMark(44, marks)).toEqual({ measure: 44, mark: 'C' })
		expect(positionWithMark(47, marks)).toEqual({ measure: 47, mark: null })
	})

	it('liefert ohne Takt keine Stelle', () => {
		expect(positionWithMark(null, marks)).toBeNull()
		expect(positionWithMark(0, marks)).toBeNull()
	})

	it('kommt ohne Buchstaben aus', () => {
		expect(positionWithMark(3, [])).toEqual({ measure: 3, mark: null })
	})
})

describe('keyByElid', () => {
	const measures = measuresTimeline
	const timeline = { events: [{ elid: 7, timeMs: 500 }, { elid: 8, timeMs: 2500 }, { elid: 7, timeMs: 2600 }] }
	const keys = [{ measure: 1, concertKey: 2 }, { measure: 2, concertKey: -3 }]

	it('liest die Tonart am ersten Erklingen des Segments', () => {
		const lookup = keyByElid(timeline, keys, measures, 6000)
		expect(lookup(7)).toBe(2)
		expect(lookup(8)).toBe(-3)
	})

	it('nimmt fuer Unbekanntes die erste Tonart und ohne Tonart 0', () => {
		expect(keyByElid(timeline, keys, measures, 6000)(99)).toBe(2)
		expect(keyByElid(timeline, [], measures, 6000)(7)).toBe(0)
	})
})
