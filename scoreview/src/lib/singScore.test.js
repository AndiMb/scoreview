import { describe, expect, it } from 'vitest'
import { evaluateRecording } from './intonation.js'
import { evaluateRhythm } from './rhythm.js'
import {
	isContinuous,
	levelThresholds,
	levelWindow,
	MIN_WEIGHT_MS,
	practiceSpots,
	readyAtMs,
	scoreChord,
	scoreNote,
	summarizeRun,
	unitChords,
	unitNotes,
} from './singScore.js'

const hzOf = (pitch, cents = 0) => 440 * 2 ** ((pitch - 69 + cents / 100) / 12)

/**
 * Frames every 20 ms in score time. `sung` lists what is heard when; between
 * the segments it is silent.
 *
 * @param {Array<{onMs:number, offMs:number, pitch:number, cents?:number}>} sung
 * @param {number} lengthMs
 * @param {number} [tempoFactor] score ms per real ms
 */
function frames(sung, lengthMs, tempoFactor = 1) {
	const out = []
	for (let ms = 0; ms <= lengthMs; ms += 20 * tempoFactor) {
		const s = sung.find((x) => x.onMs <= ms && ms < x.offMs)
		out.push(s ? { scoreMs: ms, hz: hzOf(s.pitch, s.cents ?? 0), clarity: 0.95 } : { scoreMs: ms, hz: null, clarity: 0 })
	}
	return out
}

// Detached quarters on channel 1, a soprano on channel 0 that must not count.
const NOTES = [
	{ onMs: 500, offMs: 1300, pitch: 64, channel: 1 },
	{ onMs: 1500, offMs: 2300, pitch: 67, channel: 1 },
	{ onMs: 2500, offMs: 3300, pitch: 65, channel: 1 },
	{ onMs: 3500, offMs: 4300, pitch: 64, channel: 1 },
	{ onMs: 500, offMs: 4300, pitch: 76, channel: 0 },
]
const MINE = NOTES.filter((n) => n.channel === 1)
const ctx = (extra = {}) => ({ notes: NOTES, myChannels: [1], ...extra })
const exact = MINE.map((n) => ({ onMs: n.onMs, offMs: n.offMs, pitch: n.pitch }))

describe('levelThresholds', () => {
	it('has three levels and falls back to choir', () => {
		expect(levelThresholds('easy').pitch).toEqual({ green: 50, yellow: 100 })
		expect(levelThresholds('easy').onset).toEqual({ green: 120, yellow: 250 })
		expect(levelThresholds('choir').pitch).toEqual({ green: 25, yellow: 50 })
		expect(levelThresholds('strict').pitch).toEqual({ green: 15, yellow: 30 })
		expect(levelThresholds('strict').onset).toEqual({ green: 60, yellow: 100 })
		expect(levelThresholds('hard')).toBe(levelThresholds('choir'))
	})
})

describe('unitNotes and readyAtMs', () => {
	it('takes my notes inside the stretch', () => {
		expect(unitNotes(NOTES, [1], 1400, 3400).map((n) => n.onMs)).toEqual([1500, 2500])
		expect(unitNotes(NOTES, [1], 0, 10000)).toHaveLength(4)
		expect(unitNotes(NOTES, null, 0, 10000)).toEqual([])
	})

	it('judges a note SETTLE_MS of real time after its end', () => {
		expect(readyAtMs({ offMs: 1000 }, 1)).toBe(1250)
		expect(readyAtMs({ offMs: 1000 }, 0.5)).toBe(1125)
	})
})

describe('scoreNote', () => {
	const f = frames(exact, 5000)

	it('a note sung on pitch and on time, held to its rest, is perfect', () => {
		const r = scoreNote(f, MINE[1], ctx())
		expect(r.pitch.class).toBe('green')
		expect(r.onset.class).toBe('green')
		expect(r.release.class).toBe('green')
		expect(r.score).toBe(1)
		expect(r.label.kind).toBe('perfect')
		expect(r.cls).toBe('green')
	})

	it('40 cents low is yellow for the choir, green for beginners', () => {
		const low = frames(exact.map((s) => ({ ...s, cents: -40 })), 5000)
		const choir = scoreNote(low, MINE[1], ctx())
		expect(choir.pitch.class).toBe('yellow')
		expect(choir.label.kind).toBe('low')
		expect(choir.label.value).toBeCloseTo(-40, 0)
		expect(choir.score).toBeCloseTo((0.6 * 0.5 + 0.25 + 0.15) / 1, 5)
		expect(scoreNote(low, MINE[1], ctx({ level: 'easy' })).pitch.class).toBe('green')
	})

	it('a note cut off by the end of the frames leaves its length unjudged', () => {
		const cut = f.filter((x) => x.scoreMs < MINE[1].offMs - 200)
		const r = scoreNote(cut, MINE[1], ctx())
		expect(r.release).toBeNull()
		expect(r.label.kind).toBe('perfect')
		expect(r.score).toBe(1)
	})

	it('a note let go early is "too short", its pitch still counts - not "not heard"', () => {
		// Sung for 40 % of its 800 ms: most frames are silent.
		const early = frames(exact.map((s) => ({ ...s, offMs: s.onMs + (s.offMs - s.onMs) * 0.4 })), 5000)
		const r = scoreNote(early, MINE[1], ctx())
		expect(r.pitch.class).toBe('green')
		expect(r.release.class).not.toBe('green')
		expect(r.label.kind).toBe('short')
		expect(r.score).toBeGreaterThan(0.5)
	})

	it('a few voiced frames are still "not heard"', () => {
		const blip = frames([{ onMs: 1500, offMs: 1640, pitch: 67 }], 5000)
		expect(scoreNote(blip, MINE[1], ctx()).label.kind).toBe('notHeard')
	})

	it('silence is "not heard" and scores 0, not 100', () => {
		const r = scoreNote(frames([], 5000), MINE[1], ctx())
		expect(r.pitch.class).toBe('na')
		expect(r.label.kind).toBe('notHeard')
		expect(r.score).toBe(0)
		expect(r.onset).toBeNull()
		expect(r.cls).toBe('red')
	})

	it('a late onset after silence is red and named', () => {
		const late = frames(exact.map((s, i) => (i === 1 ? { ...s, onMs: s.onMs + 170 } : s)), 5000)
		const r = scoreNote(late, MINE[1], ctx())
		expect(r.onset.class).toBe('red')
		expect(r.label.kind).toBe('late')
		expect(r.label.value).toBeGreaterThan(120)
	})

	it('a note tied to the same pitch has no onset; its weight goes to the rest', () => {
		const tied = [
			{ onMs: 500, offMs: 1000, pitch: 64, channel: 1 },
			{ onMs: 1000, offMs: 1600, pitch: 64, channel: 1 },
		]
		const sung = frames([{ onMs: 500, offMs: 1600, pitch: 64, cents: -40 }], 2500)
		const r = scoreNote(sung, tied[1], { notes: tied, myChannels: [1] })
		expect(r.onset).toBeNull()
		expect(r.release.class).toBe('green')
		expect(r.score).toBeCloseTo((0.6 * 0.5 + 0.15) / 0.75, 5)
	})

	it('pitch is named before onset when both are yellow', () => {
		const both = frames(exact.map((s, i) => (i === 1 ? { ...s, onMs: s.onMs + 95, cents: 35 } : s)), 5000)
		const r = scoreNote(both, MINE[1], ctx())
		expect(r.pitch.class).toBe('yellow')
		expect(r.onset.class).toBe('yellow')
		expect(r.label.kind).toBe('high')
	})

	it('returns null where the frames do not cover the note', () => {
		expect(scoreNote(frames(exact, 400), MINE[1], ctx())).toBeNull()
	})

	it('weighs real time, at least MIN_WEIGHT_MS', () => {
		const r = scoreNote(f, MINE[1], ctx())
		expect(r.weightMs).toBe(800)
		const slow = scoreNote(frames(exact, 5000, 0.5), MINE[1], ctx({ tempoFactor: 0.5 }))
		expect(slow.weightMs).toBe(1600)
		const quick = [{ onMs: 500, offMs: 600, pitch: 64, channel: 1 }]
		const short = scoreNote(frames([{ onMs: 500, offMs: 600, pitch: 64 }], 1200), quick[0], { notes: quick, myChannels: [1], level: 'choir' })
		expect(short?.weightMs ?? MIN_WEIGHT_MS).toBe(MIN_WEIGHT_MS)
	})

	it('judges as the analysis of a recording does (one truth)', () => {
		const sung = frames(exact.map((s, i) => ({ ...s, onMs: s.onMs + [0, 90, 170, -40][i], cents: [0, -30, 55, 10][i] })), 5000)
		const evaluations = evaluateRecording(sung, NOTES, [1])
		const rhythm = evaluateRhythm(sung, evaluations, NOTES, [1])
		expect(evaluations).toHaveLength(4)
		expect(new Set(rhythm.map((x) => x.onset?.class)).size).toBeGreaterThan(1)
		evaluations.forEach((e, i) => {
			const r = scoreNote(sung, e.note, ctx())
			expect(r.pitch.class).toBe(e.class)
			expect(r.onset?.class ?? 'na').toBe(rhythm[i].onset?.class ?? 'na')
			expect(r.release?.class ?? 'na').toBe(rhythm[i].release?.class ?? 'na')
		})
	})
})

describe('unitChords and scoreChord', () => {
	const divisi = [
		{ onMs: 500, offMs: 1300, pitch: 67, channel: 1 },
		{ onMs: 501, offMs: 1300, pitch: 60, channel: 1 },
		{ onMs: 1500, offMs: 2300, pitch: 64, channel: 1 },
	]

	it('groups notes starting together', () => {
		expect(unitChords(divisi).map((c) => c.map((n) => n.pitch))).toEqual([[67, 60], [64]])
	})

	it('judges the note of a divisi that was sung', () => {
		const sung = frames([{ onMs: 500, offMs: 1300, pitch: 60 }], 2500)
		const r = scoreChord(sung, unitChords(divisi)[0], { notes: divisi, myChannels: [1] })
		expect(r.note.pitch).toBe(60)
		expect(r.pitch.class).toBe('green')
	})
})

describe('summarizeRun', () => {
	const result = (score, weightMs, extra = {}) => ({
		note: { onMs: 0 },
		pitch: { class: score === 1 ? 'green' : 'red' },
		onset: null,
		release: null,
		score,
		weightMs,
		label: { kind: score === 1 ? 'perfect' : 'low' },
		...extra,
	})

	it('weighs notes by their duration', () => {
		const s = summarizeRun([result(1, 1000), result(0, 250)])
		expect(s.totalPct).toBe(80)
		expect(s.pitchPct).toBe(80)
		expect(s.onsetPct).toBeNull()
		expect(s.notesScored).toBe(2)
	})

	it('a run of silence is 0 %', () => {
		const silent = scoreNote(frames([], 5000), MINE[0], ctx())
		expect(summarizeRun([silent]).totalPct).toBe(0)
		expect(summarizeRun([silent]).pitchPct).toBe(0)
	})

	it('an empty run has nothing', () => {
		expect(summarizeRun([])).toEqual({ totalPct: null, pitchPct: null, onsetPct: null, releasePct: null, notesScored: 0 })
	})

	it('scores a whole sung run', () => {
		const f = frames(exact, 5000)
		const s = summarizeRun(MINE.map((n) => scoreNote(f, n, ctx())))
		expect(s).toEqual({ totalPct: 100, pitchPct: 100, onsetPct: 100, releasePct: 100, notesScored: 4 })
	})
})

describe('practiceSpots', () => {
	const r = (onMs, score, kind) => ({ note: { onMs }, score, label: { kind, value: null } })

	it('worst first, once per measure, perfect ones left out', () => {
		const measureOf = (ms) => Math.floor(ms / 1000) + 1
		const spots = practiceSpots([r(100, 0.5, 'low'), r(600, 0.2, 'late'), r(1100, 1, 'perfect'), r(2100, 0, 'notHeard')], measureOf)
		expect(spots.map((s) => s.measure)).toEqual([3, 1])
		expect(spots[1].label.kind).toBe('late')
	})

	it('at most max', () => {
		const list = Array.from({ length: 9 }, (_, i) => r(i * 1000, 0, 'low'))
		expect(practiceSpots(list, (ms) => ms / 1000 + 1, 5)).toHaveLength(5)
	})
})

describe('levelWindow', () => {
	it('turns live points into the envelope rhythm.js reads', () => {
		const points = Array.from({ length: 10 }, (_, i) => ({ scoreMs: 1000 + i * 5, db: -60 + i }))
		const w = levelWindow(points, 1010, 1030, 1)
		expect(w.t0Ms).toBe(1010)
		expect(w.stepMs).toBe(5)
		expect(Array.from(w.db)).toEqual([-58, -57, -56, -55, -54])
		expect(levelWindow(points, 2000, 3000, 1)).toBeNull()
		expect(levelWindow(points, 1000, 1100, 0.5).stepMs).toBe(2.5)
	})
})

describe('isContinuous', () => {
	it('tells playing on from seeking', () => {
		expect(isContinuous(1000, 1020, 20, 1)).toBe(true)
		expect(isContinuous(1000, 1010, 20, 0.5)).toBe(true)
		expect(isContinuous(5000, 1000, 20, 1)).toBe(false)
		expect(isContinuous(1000, 3000, 20, 1)).toBe(false)
	})
})
