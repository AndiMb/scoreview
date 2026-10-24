import { describe, expect, it } from 'vitest'
import {
	createMatchRun,
	frameMatches,
	heldNotes,
	MIN_WAIT_NOTE_MS,
	msUntilStop,
	nextWait,
	WAIT_LEAD_MS,
	waitableChords,
} from './waitMode.js'

const hzOf = (pitch, cents = 0) => 440 * 2 ** ((pitch - 69 + cents / 100) / 12)

// Alto on channel 1 with a divisi and a grace note; soprano on channel 0.
const NOTES = [
	{ onMs: 0, offMs: 1000, pitch: 64, channel: 1, velocity: 90 },
	{ onMs: 1000, offMs: 1100, pitch: 65, channel: 1, velocity: 90 },
	{ onMs: 1100, offMs: 2000, pitch: 67, channel: 1, velocity: 90 },
	{ onMs: 2000, offMs: 3000, pitch: 62, channel: 1, velocity: 90 },
	{ onMs: 2002, offMs: 3000, pitch: 65, channel: 1, velocity: 90 },
	{ onMs: 0, offMs: 2500, pitch: 72, channel: 0, velocity: 70 },
	{ onMs: 2500, offMs: 3000, pitch: 74, channel: 0, velocity: 70 },
]

describe('waitableChords', () => {
	it('groups a divisi into one chord and passes over notes shorter than the threshold', () => {
		expect(waitableChords(NOTES, [1])).toEqual([
			{ onMs: 0, pitches: [64] },
			{ onMs: 1100, pitches: [67] },
			{ onMs: 2000, pitches: [62, 65] },
		])
	})

	it('judges the length in real time: at double speed a 300 ms note is too short', () => {
		const notes = [{ onMs: 0, offMs: 300, pitch: 64, channel: 1 }]
		expect(waitableChords(notes, [1], 1)).toHaveLength(1)
		expect(waitableChords(notes, [1], 2)).toHaveLength(0)
		expect(300 / 2).toBeLessThan(MIN_WAIT_NOTE_MS)
	})

	it('without my part there is nothing to wait for', () => {
		expect(waitableChords(NOTES, null)).toEqual([])
	})
})

describe('nextWait / msUntilStop', () => {
	const chords = waitableChords(NOTES, [1])

	it('finds the next stopping point ahead of the position', () => {
		expect(nextWait(chords, -100, WAIT_LEAD_MS).onMs).toBe(0)
		expect(nextWait(chords, 500, WAIT_LEAD_MS).onMs).toBe(1100)
		// Inside the lead window of a chord: that one is too close, the next counts.
		expect(nextWait(chords, 1100 - WAIT_LEAD_MS + 1, WAIT_LEAD_MS).onMs).toBe(2000)
		expect(nextWait(chords, 2500, WAIT_LEAD_MS)).toBeNull()
	})

	it('never waits twice for the same chord, even if the clock reads a little early', () => {
		expect(nextWait(chords, 1100 - WAIT_LEAD_MS - 3, WAIT_LEAD_MS, 1100).onMs).toBe(2000)
	})

	it('converts the distance to real time and stops WAIT_LEAD_MS before the onset', () => {
		expect(msUntilStop(500, { onMs: 1100 }, 1)).toBe(1100 - WAIT_LEAD_MS - 500)
		// Half tempo: 600 score ms are 1200 real ms, the lead stays 30 real ms.
		expect(msUntilStop(500, { onMs: 1100 }, 0.5)).toBeCloseTo((1100 - WAIT_LEAD_MS * 0.5 - 500) / 0.5)
		expect(msUntilStop(1200, { onMs: 1100 }, 1)).toBe(0)
	})
})

describe('frameMatches / createMatchRun', () => {
	it('accepts ±50 cents, any octave, any pitch of a divisi', () => {
		expect(frameMatches({ hz: hzOf(64, 45), clarity: 0.9 }, [64])).toBe(true)
		expect(frameMatches({ hz: hzOf(64, 60), clarity: 0.9 }, [64])).toBe(false)
		expect(frameMatches({ hz: hzOf(52), clarity: 0.9 }, [64])).toBe(true)
		expect(frameMatches({ hz: hzOf(65), clarity: 0.9 }, [62, 65])).toBe(true)
	})

	it('rejects an unvoiced or unclear frame', () => {
		expect(frameMatches({ hz: null, clarity: 0 }, [64])).toBe(false)
		expect(frameMatches({ hz: hzOf(64), clarity: 0.3 }, [64])).toBe(false)
	})

	it('needs three matching frames in a row; one miss starts over', () => {
		const run = createMatchRun()
		expect([true, true, false, true, true].map((m) => run.push(m))).toEqual([false, false, false, false, false])
		expect(run.push(true)).toBe(true)
		run.reset()
		expect(run.push(true)).toBe(false)
	})
})

describe('heldNotes', () => {
	it('holds what the accompaniment plays at that moment, never my part', () => {
		expect(heldNotes(NOTES, [1], 1070)).toEqual([{ channel: 0, pitch: 72, velocity: 70 }])
		expect(heldNotes(NOTES, [1], 2700)).toEqual([{ channel: 0, pitch: 74, velocity: 70 }])
	})

	it('leaves out notes that start only at the onset waited for', () => {
		// Stopped 30 ms before 2500: the soprano's next note has not started.
		expect(heldNotes(NOTES, [1], 2470)).toEqual([{ channel: 0, pitch: 72, velocity: 70 }])
	})

	it('holds each channel and pitch once', () => {
		const doubled = [...NOTES, { onMs: 0, offMs: 2500, pitch: 72, channel: 0, velocity: 70 }]
		expect(heldNotes(doubled, [1], 100)).toHaveLength(1)
	})
})
