import { describe, expect, it } from 'vitest'
import { resolveLoopRange } from './loopRange.js'

// Four measures at 0/1000/2000/3000 ms (elid = measure - 1), piece ends at 4000.
const MEASURES = {
	events: [0, 1, 2, 3].map((elid) => ({ elid, timeMs: elid * 1000 })),
	elements: {},
}

describe('resolveLoopRange', () => {
	it('ends at the start of the measure after "to"', () => {
		expect(resolveLoopRange(MEASURES, 2, 3, 4000)).toEqual({ from: 2, to: 3, startMs: 1000, endMs: 3000 })
	})

	it('ends at the piece end when "to" is the last measure', () => {
		expect(resolveLoopRange(MEASURES, 1, 4, 4000).endMs).toBe(4000)
	})

	it('reads string fields as numbers instead of concatenating', () => {
		// '2' + 1 would look up measure 21 and fall back to the piece end.
		expect(resolveLoopRange(MEASURES, '1', '2', 4000)).toEqual({ from: 1, to: 2, startMs: 0, endMs: 2000 })
	})

	it.each([
		['empty from', '', 2],
		['empty to', 1, ''],
		['backwards', 3, 2],
		['zero', 0, 2],
		['fraction', 1.5, 2],
		['unknown measure', 9, 10],
	])('rejects %s', (_, from, to) => {
		expect(resolveLoopRange(MEASURES, from, to, 4000)).toBeNull()
	})

	it('rejects a missing timeline', () => {
		expect(resolveLoopRange(null, 1, 2, 4000)).toBeNull()
	})
})
