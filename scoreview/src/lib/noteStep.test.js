import { describe, expect, it } from 'vitest'
import { MAX_STEP_PITCHES, stepTarget } from './noteStep.js'

const n = (onMs, pitch, channel = 0) => ({ onMs, offMs: onMs + 400, pitch, channel })

// Two parts: channel 0 plays at 0/500/1000, channel 1 at 0 and 750 only,
// drums (channel 9) on every 250 ms.
const NOTES = [
	n(0, 60),
	n(500, 62),
	n(1000, 64),
	n(0, 48, 1),
	n(750, 50, 1),
	n(0, 36, 9),
	n(250, 38, 9),
	n(500, 36, 9),
	n(750, 38, 9),
	n(1000, 36, 9),
]

describe('noteStep.stepTarget', () => {
	it('steps forward to the next onset of any melodic part, with its chord', () => {
		expect(stepTarget(NOTES, { fromMs: 0, direction: 1 })).toEqual({ timeMs: 500, pitches: [62] })
		expect(stepTarget(NOTES, { fromMs: 500, direction: 1 })).toEqual({ timeMs: 750, pitches: [50] })
	})

	it('ignores the drums when no part is chosen, so a drum stroke is no step', () => {
		// 250 holds only a drum note
		expect(stepTarget(NOTES, { fromMs: 0, direction: 1 }).timeMs).toBe(500)
	})

	it('keeps to my part and skips where it rests', () => {
		expect(stepTarget(NOTES, { fromMs: 0, direction: 1, channels: [1] })).toEqual({ timeMs: 750, pitches: [50] })
		expect(stepTarget(NOTES, { fromMs: 750, direction: 1, channels: [1] })).toBeNull()
	})

	it('sounds every melodic note starting at the target', () => {
		expect(stepTarget(NOTES, { fromMs: 500, direction: -1 })).toEqual({ timeMs: 0, pitches: [48, 60] })
	})

	it('steps back from the middle of a note to its start', () => {
		expect(stepTarget(NOTES, { fromMs: 600, direction: -1 }).timeMs).toBe(500)
	})

	it('does not stay put when the clock stands just before the onset', () => {
		// measured after a seek: 499.9 for an event at 500
		expect(stepTarget(NOTES, { fromMs: 499.9, direction: 1 }).timeMs).toBe(750)
		expect(stepTarget(NOTES, { fromMs: 499.9, direction: -1 }).timeMs).toBe(0)
	})

	it('returns null at either end and without notes', () => {
		expect(stepTarget(NOTES, { fromMs: 1000, direction: 1 })).toBeNull()
		expect(stepTarget(NOTES, { fromMs: 0, direction: -1 })).toBeNull()
		expect(stepTarget(null, { fromMs: 0, direction: 1 })).toBeNull()
	})

	it('follows the played form: a repeated note is a step of its own', () => {
		const repeated = [n(0, 60), n(500, 62), n(1000, 60), n(1500, 62)]
		expect(stepTarget(repeated, { fromMs: 500, direction: 1 }).timeMs).toBe(1000)
	})

	it('thins a large chord to its outer voices', () => {
		const tutti = Array.from({ length: 20 }, (_, i) => n(100, 40 + i * 2, i === 9 ? 10 : i % 16))
		const { pitches } = stepTarget(tutti, { fromMs: 0, direction: 1 })
		expect(pitches).toHaveLength(MAX_STEP_PITCHES)
		expect(pitches[0]).toBe(40)
		expect(pitches.at(-1)).toBe(78)
		expect([...pitches].sort((a, b) => a - b)).toEqual(pitches)
	})

	it('folds a doubled pitch into one', () => {
		expect(stepTarget([n(0, 60), n(0, 60, 1)], { fromMs: -100, direction: 1 }).pitches).toEqual([60])
	})
})
