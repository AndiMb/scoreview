import { describe, expect, it } from 'vitest'
import { evaluateRecording, problemList, worstClass } from './intonation.js'
import { trackPitch } from './pitchDetect.js'
import { recordingToScoreMs } from './recordingAlign.js'
import {
	classifyOnset,
	classifyRelease,
	evaluateRhythm,
	frameState,
	medianOnsetMs,
	MIN_ONSET_TOLERANCE_MS,
} from './rhythm.js'

const RATE = 16000
const hzOf = (pitch, cents = 0) => 440 * 2 ** ((pitch - 69 + cents / 100) / 12)

/**
 * A synthetic voice: harmonic tone with vibrato, one segment per sung note,
 * in REAL time. Consecutive segments without a gap share the phase, so a
 * legato pitch change has no click that would read as an onset.
 *
 * @param {Array<{onMs:number, offMs:number, pitch:number}>} sung
 * @param {number} lengthMs
 * @return {Float32Array}
 */
function voice(sung, lengthMs) {
	const out = new Float32Array(Math.round((lengthMs / 1000) * RATE))
	let phase = 0
	for (const s of sung) {
		for (let i = Math.round((s.onMs / 1000) * RATE); i < Math.round((s.offMs / 1000) * RATE) && i < out.length; i++) {
			const vib = 30 * Math.sin(2 * Math.PI * 5.5 * (i / RATE))
			phase += (2 * Math.PI * hzOf(s.pitch, vib)) / RATE
			for (let k = 1; k <= 5; k++) {
				out[i] += (0.25 / k) * Math.sin(k * phase)
			}
		}
	}
	return out
}

function frames(samples, recording = { scoreStartMs: 0, tempoFactor: 1 }) {
	return trackPitch(samples).map((f) => ({ scoreMs: recordingToScoreMs(recording, f.timeSec), hz: f.hz, clarity: f.clarity }))
}

function rhythmOf(sung, notes, { tempoFactor = 1, lengthMs = 6000 } = {}) {
	const f = frames(voice(sung, lengthMs), { scoreStartMs: 0, tempoFactor })
	const evaluations = evaluateRecording(f, notes, [1], { tempoFactor })
	return { evaluations, rhythm: evaluateRhythm(f, evaluations, notes, [1], { tempoFactor }) }
}

// Four quarters with a rest between them (detached), on channel 1, and a
// soprano on channel 0 that must not count.
const DETACHED = [
	{ onMs: 500, offMs: 1300, pitch: 64, channel: 1 },
	{ onMs: 1500, offMs: 2300, pitch: 67, channel: 1 },
	{ onMs: 2500, offMs: 3300, pitch: 65, channel: 1 },
	{ onMs: 3500, offMs: 4300, pitch: 64, channel: 1 },
	{ onMs: 500, offMs: 4300, pitch: 76, channel: 0 },
]
const mine = (notes) => notes.filter((n) => n.channel === 1)

describe('frameState', () => {
	it('tells the target from a neighbour a semitone away', () => {
		expect(frameState({ hz: hzOf(64), clarity: 1 }, 64, [63])).toBe('match')
		expect(frameState({ hz: hzOf(63, 20), clarity: 1 }, 64, [63])).toBe('other')
		expect(frameState({ hz: hzOf(52), clarity: 1 }, 64, [])).toBe('match')
		expect(frameState({ hz: null, clarity: 0 }, 64, [])).toBe('silent')
	})
})

describe('classifyOnset / classifyRelease', () => {
	it('never lets "green" fall below the measured latency offset', () => {
		expect(classifyOnset(50, { green: 20, yellow: 40 })).toBe('green')
		expect(classifyOnset(MIN_ONSET_TOLERANCE_MS + 1, { green: 20, yellow: 40 })).toBe('yellow')
		expect(classifyOnset(2 * MIN_ONSET_TOLERANCE_MS + 1, { green: 20, yellow: 40 })).toBe('red')
	})

	it('grades early and late alike, 60/120 ms by default', () => {
		expect(classifyOnset(-59)).toBe('green')
		expect(classifyOnset(90)).toBe('yellow')
		expect(classifyOnset(-130)).toBe('red')
		expect(classifyOnset(null)).toBe('na')
	})

	it('measures "too short" against the length of the note', () => {
		expect(classifyRelease(140, 400)).toBe('green')
		expect(classifyRelease(200, 400)).toBe('yellow')
		expect(classifyRelease(200, 2000)).toBe('green')
		expect(classifyRelease(600, 2000)).toBe('yellow')
		expect(classifyRelease(1100, 2000)).toBe('red')
	})
})

describe('C1 with synthetic voices', () => {
	it('on time after a rest: every onset green, within the frame raster', () => {
		const { rhythm } = rhythmOf(mine(DETACHED), DETACHED)
		expect(rhythm).toHaveLength(4)
		for (const r of rhythm) {
			expect(r.onset.class).toBe('green')
			expect(Math.abs(r.onset.devMs)).toBeLessThan(20)
		}
	})

	it('100 ms late and 160 ms early are found where they were sung', () => {
		const sung = mine(DETACHED).map((n) => {
			const shift = n.onMs === 1500 ? 100 : n.onMs === 2500 ? -160 : 0
			return { ...n, onMs: n.onMs + shift }
		})
		const { rhythm } = rhythmOf(sung, DETACHED)
		expect(rhythm[0].onset.class).toBe('green')
		expect(rhythm[1].onset.class).toBe('yellow')
		expect(rhythm[1].onset.devMs).toBeGreaterThan(80)
		expect(rhythm[1].onset.devMs).toBeLessThan(120)
		expect(rhythm[2].onset.class).toBe('red')
		expect(rhythm[2].onset.devMs).toBeLessThan(-140)
		expect(rhythm[3].onset.class).toBe('green')
	})

	it('a legato change of pitch is an onset; a tie to the same pitch is not evaluable', () => {
		const notes = [
			{ onMs: 500, offMs: 1300, pitch: 64, channel: 1 },
			{ onMs: 1300, offMs: 2100, pitch: 67, channel: 1 },
			{ onMs: 2100, offMs: 2900, pitch: 67, channel: 1 },
		]
		const { rhythm } = rhythmOf([
			{ onMs: 500, offMs: 1300, pitch: 64 },
			{ onMs: 1300, offMs: 2900, pitch: 67 },
		], notes)
		expect(rhythm[1].onset.class).toBe('green')
		expect(Math.abs(rhythm[1].onset.devMs)).toBeLessThan(25)
		expect(rhythm[2].onset).toMatchObject({ class: 'na', reason: 'samePitch' })
	})

	it('at half tempo the deviation is reported in real milliseconds', () => {
		// tempoFactor 0.5: one real second covers 500 score ms, so the note at
		// score 1500 is due at real 3000 and sung 100 ms late at 3100.
		const notes = [
			{ onMs: 500, offMs: 1300, pitch: 64, channel: 1 },
			{ onMs: 1500, offMs: 2300, pitch: 67, channel: 1 },
		]
		const sung = [
			{ onMs: 1000, offMs: 2600, pitch: 64 },
			{ onMs: 3100, offMs: 4600, pitch: 67 },
		]
		const { rhythm } = rhythmOf(sung, notes, { tempoFactor: 0.5, lengthMs: 5500 })
		expect(rhythm[0].onset.class).toBe('green')
		expect(rhythm[1].onset.devMs).toBeGreaterThan(80)
		expect(rhythm[1].onset.devMs).toBeLessThan(120)
	})

	it('an end before a rest: held is green, cut by 350 ms of 800 is yellow', () => {
		const sung = mine(DETACHED).map((n) => (n.onMs === 2500 ? { ...n, offMs: n.offMs - 350 } : n))
		const { rhythm } = rhythmOf(sung, DETACHED)
		expect(rhythm[0].release.class).toBe('green')
		expect(rhythm[0].release.shortMs).toBeLessThan(40)
		expect(rhythm[2].release.class).toBe('yellow')
		expect(rhythm[2].release.shortMs).toBeGreaterThan(300)
		expect(rhythm[2].release.shortMs).toBeLessThan(400)
	})

	it('no end is judged where the next note follows directly', () => {
		const notes = [
			{ onMs: 500, offMs: 1300, pitch: 64, channel: 1 },
			{ onMs: 1300, offMs: 2100, pitch: 67, channel: 1 },
		]
		const { rhythm } = rhythmOf([{ onMs: 500, offMs: 1300, pitch: 64 }, { onMs: 1300, offMs: 2100, pitch: 67 }], notes, { lengthMs: 3000 })
		expect(rhythm[0].release).toBeNull()
		expect(rhythm[1].release.class).toBe('green')
	})

	it('a note the recording begins inside of has no onset at all', () => {
		const f = frames(voice([{ onMs: 0, offMs: 900, pitch: 64 }], 1500), { scoreStartMs: 600, tempoFactor: 1 })
		const notes = [{ onMs: 500, offMs: 1500, pitch: 64, channel: 1 }]
		const evaluations = evaluateRecording(f, notes, [1])
		expect(evaluateRhythm(f, evaluations, notes, [1])[0].onset).toBeNull()
	})
})

describe('problemList with rhythm', () => {
	it('lists each note once, with every quantity that is off, and the worst class', () => {
		const evaluations = [
			{ note: { onMs: 0 }, medianCents: 5, class: 'green' },
			{ note: { onMs: 2000 }, medianCents: 40, class: 'yellow' },
			{ note: { onMs: 4000 }, medianCents: 2, class: 'green' },
		]
		const rhythm = [
			{ onset: { devMs: 10, class: 'green' }, release: null },
			{ onset: { devMs: -150, class: 'red' }, release: { shortMs: 20, class: 'green' } },
			{ onset: { devMs: null, class: 'na' }, release: { shortMs: 600, class: 'yellow' } },
		]
		const list = problemList(evaluations, (ms) => Math.floor(ms / 2000) + 1, rhythm)
		expect(list).toHaveLength(2)
		expect(list[0]).toMatchObject({ measure: 2, class: 'red', cents: 40 })
		expect(list[0].issues.map((i) => i.kind)).toEqual(['pitch', 'onset'])
		expect(list[1]).toMatchObject({ measure: 3, class: 'yellow', cents: null })
		expect(list[1].issues).toEqual([{ kind: 'release', value: 600, class: 'yellow' }])
	})

	it('worstClass ignores "not evaluable" unless nothing else is there', () => {
		expect(worstClass('green', 'na', 'yellow')).toBe('yellow')
		expect(worstClass('na', undefined, null)).toBe('na')
		expect(worstClass('na', 'green')).toBe('green')
	})

	it('medianOnsetMs skips notes without a measured onset', () => {
		expect(medianOnsetMs([{ onset: { devMs: 30 } }, { onset: null }, { onset: { devMs: 50 } }, { onset: { devMs: null } }])).toBe(40)
		expect(medianOnsetMs([{ onset: null }])).toBeNull()
	})
})
