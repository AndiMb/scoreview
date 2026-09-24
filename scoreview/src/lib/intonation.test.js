import { describe, expect, it } from 'vitest'
import {
	centsOff,
	classify,
	evaluateNote,
	evaluateRecording,
	foldOctave,
	formatCents,
	noteMarks,
	problemList,
	targetAt,
} from './intonation.js'
import { trackPitch } from './pitchDetect.js'
import { recordingToScoreMs } from './recordingAlign.js'

const RATE = 16000
const hzOf = (pitch, cents = 0) => 440 * 2 ** ((pitch - 69 + cents / 100) / 12)

/**
 * Eine synthetische Aufnahme: je Note ein obertonreicher Ton mit Vibrato,
 * optional um `cents` verstimmt und mit einem Einsatz von unten.
 *
 * @param {Array<{onMs:number, offMs:number, pitch:number, cents?:number, second?:number}>} plan
 * @param {number} lengthMs
 * @return {Float32Array}
 */
function aufnahme(plan, lengthMs) {
	const out = new Float32Array(Math.round((lengthMs / 1000) * RATE))
	for (const n of plan) {
		const tone = (pitch, cents, amp) => {
			let phase = 0
			for (let i = Math.round((n.onMs / 1000) * RATE); i < Math.round((n.offMs / 1000) * RATE) && i < out.length; i++) {
				const t = i / RATE - n.onMs / 1000
				// 60 ms Einsatz von unten (-80 Cent), danach Vibrato ±20 Cent.
				const scoop = t < 0.06 ? -80 * (1 - t / 0.06) : 0
				const vib = 20 * Math.sin(2 * Math.PI * 5.5 * t)
				phase += (2 * Math.PI * hzOf(pitch, cents + scoop + vib)) / RATE
				for (let k = 1; k <= 5; k++) {
					out[i] += (amp / k) * Math.sin(k * phase)
				}
			}
		}
		tone(n.pitch, n.cents ?? 0, 0.25)
		if (n.second !== undefined) {
			tone(n.second, 0, 0.25)
		}
	}
	return out
}

/** Takt i (1-basiert) zu 2000 ms, Viertel = 500 ms. */
const measureOf = (ms) => Math.floor(ms / 2000) + 1

// Eine Altstimme ueber vier Takte, je eine halbe Note, auf Kanal 1; dazu
// ein Sopran auf Kanal 0, der nicht bewertet werden darf.
const ALT = [
	{ onMs: 0, offMs: 1000, pitch: 64, channel: 1 },
	{ onMs: 1000, offMs: 2000, pitch: 65, channel: 1 },
	{ onMs: 2000, offMs: 3000, pitch: 67, channel: 1 },
	{ onMs: 3000, offMs: 4000, pitch: 65, channel: 1 },
	{ onMs: 4000, offMs: 5000, pitch: 64, channel: 1 },
	{ onMs: 5000, offMs: 6000, pitch: 62, channel: 1 },
	{ onMs: 6000, offMs: 7000, pitch: 60, channel: 1 },
]
const SOPRAN = ALT.map((n) => ({ ...n, pitch: n.pitch + 4, channel: 0 }))
const NOTES = [...SOPRAN, ...ALT].sort((a, b) => a.onMs - b.onMs)

function frames(signal, recording = { scoreStartMs: 0, tempoFactor: 1 }) {
	return trackPitch(signal).map((f) => ({ scoreMs: recordingToScoreMs(recording, f.timeSec), hz: f.hz, clarity: f.clarity }))
}

describe('centsOff / foldOctave / classify', () => {
	it('rechnet gegen a\' = 440 Hz', () => {
		expect(centsOff(440, 69)).toBeCloseTo(0)
		expect(centsOff(hzOf(60, 38), 60)).toBeCloseTo(38)
	})

	it('faltet Oktaven weg', () => {
		expect(foldOctave(1200 + 30)).toBeCloseTo(30)
		expect(foldOctave(-1200 - 20)).toBeCloseTo(-20)
	})

	it('drei Stufen 25/50, ohne Wert „nicht auswertbar"', () => {
		expect(classify(25)).toBe('green')
		expect(classify(-26)).toBe('yellow')
		expect(classify(50)).toBe('yellow')
		expect(classify(51)).toBe('red')
		expect(classify(null)).toBe('na')
		expect(classify(30, { green: 35, yellow: 60 })).toBe('green')
	})

	it('schreibt Cent mit echtem Minus', () => {
		expect(formatCents(38.4)).toBe('+38')
		expect(formatCents(-12)).toBe('−12')
		expect(formatCents(0.2)).toBe('±0')
	})
})

describe('targetAt', () => {
	it('findet die Note der eigenen Stimme, in der Pause nichts', () => {
		expect(targetAt(NOTES, [1], 2500).pitch).toBe(67)
		expect(targetAt(NOTES, [0], 2500).pitch).toBe(71)
		expect(targetAt(NOTES, [1], 7500)).toBeNull()
		expect(targetAt(NOTES, null, 2500)).toBeNull()
	})

	it('nimmt im Divisi die Note, die gesungen wird', () => {
		const divisi = [{ onMs: 0, offMs: 1000, pitch: 64, channel: 1 }, { onMs: 0, offMs: 1000, pitch: 60, channel: 1 }]
		expect(targetAt(divisi, [1], 500, hzOf(60, 10)).pitch).toBe(60)
		expect(targetAt(divisi, [1], 500).pitch).toBe(64)
	})
})

describe('Abnahme D2 mit synthetischen Signalen', () => {
	it('+50 Cent in Takt 2 werden genau dort als zu hoch markiert, der Rest ist gruen', () => {
		// Takt 2 = 2000-4000 ms: die Note ab 2000 ms ist verstimmt.
		const plan = ALT.map((n) => ({ ...n, cents: n.onMs === 2000 ? 50 : 0 }))
		const bewertet = evaluateRecording(frames(aufnahme(plan, 7000)), NOTES, [1])
		expect(bewertet).toHaveLength(7)
		const faul = bewertet.filter((e) => e.class !== 'green')
		expect(faul).toHaveLength(1)
		expect(faul[0].note.onMs).toBe(2000)
		expect(['yellow', 'red']).toContain(faul[0].class)
		expect(faul[0].medianCents).toBeGreaterThan(42)
		expect(faul[0].medianCents).toBeLessThan(58)

		const liste = problemList(bewertet, measureOf)
		expect(liste).toHaveLength(1)
		expect(liste[0].measure).toBe(2)
		expect(liste[0].cents).toBeGreaterThan(42)
	})

	it('ein Einsatz knapp vor dem Taktstrich (MIDI-Rundung) zaehlt zum neuen Takt', () => {
		const bewertet = [{ note: { onMs: 1999.992 }, medianCents: 50, class: 'yellow' }]
		expect(problemList(bewertet, measureOf)[0].measure).toBe(2)
	})

	it('ein zweistimmiges Signal ergibt „nicht auswertbar" statt erfundener Werte', () => {
		const plan = ALT.map((n) => ({ ...n, second: n.pitch + 4 }))
		const bewertet = evaluateRecording(frames(aufnahme(plan, 7000)), NOTES, [1])
		expect(bewertet.length).toBeGreaterThan(0)
		expect(bewertet.every((e) => e.class === 'na')).toBe(true)
		expect(problemList(bewertet, measureOf)).toEqual([])
	})

	it('der Einsatz von unten faerbt nicht (Median nach 100 ms)', () => {
		const e = evaluateNote(frames(aufnahme([ALT[0]], 1200)), ALT[0])
		expect(e.class).toBe('green')
		// ... ist aber in der Kurve zu sehen (D2-F3a).
		expect(Math.min(...e.curve.filter((p) => p.cents !== null).map((p) => p.cents))).toBeLessThan(-20)
	})

	it('eine Oktave tiefer gesungen ist richtig gesungen', () => {
		const plan = [{ ...ALT[2], pitch: ALT[2].pitch - 12 }]
		const e = evaluateNote(frames(aufnahme(plan, 3200)), ALT[2])
		expect(e.class).toBe('green')
	})

	it('eine verschobene Aufnahme wird ueber scoreStartMs richtig zugeordnet', () => {
		// Aufgenommen ab Partiturzeit 2000 ms, bei 80 % Tempo: Die Note ab 2000
		// ms liegt in der Aufnahme bei 0 ms, die ab 3000 ms bei 1250 ms.
		const plan = [
			{ onMs: 0, offMs: 1250, pitch: 67, cents: 40 },
			{ onMs: 1250, offMs: 2500, pitch: 65 },
		]
		const bewertet = evaluateRecording(frames(aufnahme(plan, 2600), { scoreStartMs: 2000, tempoFactor: 0.8 }), NOTES, [1], { tempoFactor: 0.8 })
		expect(bewertet.map((e) => [e.note.onMs, e.class])).toEqual([[2000, 'yellow'], [3000, 'green']])
	})

	it('Stille in der Note ist „nicht auswertbar", nicht gruen', () => {
		const e = evaluateNote(frames(new Float32Array(RATE)), ALT[0])
		expect(e.class).toBe('na')
		expect(e.medianCents).toBeNull()
	})

	it('eine Note ausserhalb der Aufnahme wird nicht bewertet', () => {
		expect(evaluateNote(frames(aufnahme([ALT[0]], 1000)), ALT[6])).toBeNull()
	})
})

describe('noteMarks', () => {
	const events = [{ timeMs: 0, elid: 10 }, { timeMs: 1000, elid: 11 }, { timeMs: 2003, elid: 12 }, { timeMs: 3000, elid: 13 }]

	it('findet das Segment am Einsatz und die Zeile der eigenen Stimme', () => {
		const bewertet = [{ note: ALT[2], class: 'red' }, { note: ALT[0], class: 'green' }]
		expect(noteMarks(bewertet, NOTES, [1], events, 1)).toEqual([
			{ elid: 12, staff: 1, rank: 0, size: 1, cls: 'red', index: 0 },
			{ elid: 10, staff: 1, rank: 0, size: 1, cls: 'green', index: 1 },
		])
	})

	it('kennt im Divisi den Rang von oben', () => {
		const divisi = [{ onMs: 0, offMs: 1000, pitch: 64, channel: 1 }, { onMs: 0, offMs: 1000, pitch: 60, channel: 1 }]
		const marks = noteMarks([{ note: divisi[1], class: 'green' }], divisi, [1], events, 1)
		expect(marks[0]).toMatchObject({ rank: 1, size: 2 })
	})

	it('laesst Noten ohne passendes Segment aus, statt falsch zu markieren', () => {
		expect(noteMarks([{ note: { onMs: 500, pitch: 60, channel: 1 }, class: 'red' }], NOTES, [1], events, 1)).toEqual([])
		expect(noteMarks([{ note: ALT[0], class: 'red' }], NOTES, [1], [], 1)).toEqual([])
		expect(noteMarks([{ note: ALT[0], class: 'red' }], NOTES, [1], events, null)).toEqual([])
	})
})
