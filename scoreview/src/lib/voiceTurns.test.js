import { describe, expect, it } from 'vitest'
import { snapToTurn, voiceTurnWindows } from './voiceTurns.js'

/** A line at 50 ms frames: sung (60) in the given [fromMs, toMs) spans, rest elsewhere. */
function line(totalMs, sung) {
	const out = new Float32Array(totalMs / 50).fill(NaN)
	for (const [from, to] of sung) {
		out.fill(60, from / 50, to / 50)
	}
	return out
}

describe('voiceTurnWindows', () => {
	it('turns in the own rest before a boundary, after the last note and at most 3 s early', () => {
		// Systems at 0, 10 s, 20 s. Own part sings 0-8.5 s, rests, enters again at 10.5 s.
		const windows = voiceTurnWindows(line(30000, [[0, 8500], [10500, 30000]]), 50, [0, 10000, 20000])
		expect(windows).toEqual([{ fromMs: 8800, toMs: 10000 }])
	})

	it('caps the turn in a long rest so the others can be counted on the old system', () => {
		const windows = voiceTurnWindows(line(30000, [[0, 2000], [12000, 30000]]), 50, [0, 10000, 20000])
		expect(windows).toEqual([{ fromMs: 7000, toMs: 10000 }])
	})

	it('leaves boundaries sung across, and rests too short to matter, to the lead', () => {
		expect(voiceTurnWindows(line(30000, [[0, 30000]]), 50, [0, 10000, 20000])).toEqual([])
		expect(voiceTurnWindows(line(30000, [[0, 9500], [10000, 30000]]), 50, [0, 10000, 20000])).toEqual([])
	})
})

describe('snapToTurn', () => {
	const windows = [{ fromMs: 8800, toMs: 10000 }, { fromMs: 18000, toMs: 20000 }]
	it('shows the next system inside a window and the time itself elsewhere', () => {
		expect(snapToTurn(windows, 8000)).toBe(8000)
		expect(snapToTurn(windows, 9000)).toBe(10000)
		expect(snapToTurn(windows, 10000)).toBe(10000)
		expect(snapToTurn(windows, 19999)).toBe(20000)
		expect(snapToTurn(windows, 25000)).toBe(25000)
		expect(snapToTurn([], 5)).toBe(5)
	})
})
