import { describe, expect, it } from 'vitest'
import { followMetrics, measureAt, summary } from './followMetrics.js'

// Bars of 2 s; a replay at 10 frames per second.
const measureStartsMs = Array.from({ length: 20 }, (_, i) => i * 2000)

function frames(from, to, map) {
	const out = []
	for (let at = from; at < to; at += 100) {
		out.push({ atMs: at, ...map(at) })
	}
	return out
}

describe('measureAt', () => {
	it('finds the bar', () => {
		expect(measureAt(measureStartsMs, 0)).toBe(0)
		expect(measureAt(measureStartsMs, 3999)).toBe(1)
		expect(measureAt(measureStartsMs, 4000)).toBe(2)
		expect(measureAt([], 500)).toBe(0)
	})
})

describe('followMetrics', () => {
	it('a perfect follower scores 1 and has no wrong jumps', () => {
		const m = followMetrics(frames(0, 20000, (at) => ({ truthMs: at, shownMs: at, confirmedMs: at })), { measureStartsMs })
		expect(m.a1WithinOneBar).toBe(1)
		expect(m.a2WrongJumps).toBe(0)
		expect(m.errorMs.max).toBe(0)
	})

	it('counts a follower two bars behind as outside', () => {
		const m = followMetrics(frames(0, 20000, (at) => ({ truthMs: at, shownMs: Math.max(0, at - 4500) })), { measureStartsMs })
		expect(m.a1WithinOneBar).toBeLessThan(0.3)
	})

	it('ignores frames where nobody sings, and counts showing nothing as a miss', () => {
		const m = followMetrics([
			...frames(0, 1000, (at) => ({ truthMs: at, shownMs: at })),
			...frames(1000, 2000, () => ({ truthMs: null, shownMs: 999 })),
			...frames(2000, 3000, () => ({ truthMs: 2000, shownMs: null })),
		], { measureStartsMs })
		expect(m.sungFrames).toBe(20)
		expect(m.a1WithinOneBar).toBe(0.5)
	})

	it('a jump to the wrong place counts, one to the right place does not', () => {
		const truth = (at) => (at < 10000 ? at : at - 8000)
		const right = frames(0, 20000, (at) => ({ truthMs: truth(at), shownMs: truth(at), confirmedMs: truth(at), jumped: at === 10500 }))
		const wrong = frames(0, 20000, (at) => ({ truthMs: truth(at), shownMs: at, confirmedMs: at, jumped: at === 10500 }))
		expect(followMetrics(right, { measureStartsMs }).a2WrongJumps).toBe(0)
		expect(followMetrics(wrong, { measureStartsMs }).a2WrongJumps).toBe(1)
	})

	it('measures how long finding the place again takes', () => {
		// Jump back from 10 s to 2 s; the follower needs 3 s to get there.
		const truth = (at) => (at < 10000 ? at : at - 8000)
		const shown = (at) => (at < 13000 ? at : truth(at))
		const m = followMetrics(frames(0, 20000, (at) => ({ truthMs: truth(at), shownMs: shown(at) })), { measureStartsMs })
		expect(m.a3Refind).toHaveLength(1)
		expect(m.a3Refind[0].seconds).toBeCloseTo(3, 0)
		expect(m.a3Refind[0].bars).toBe(1)
	})

	it('turn figures: punctual, lead, silent and wrong turns', () => {
		const slices = [{ fromMs: 0, toMs: 8000 }, { fromMs: 8000, toMs: 16000 }, { fromMs: 16000, toMs: 40000 }]
		// Turns 1.5 s before each new section; one extra wrong turn at 3 s
		// back to the right section 0.2 s later; a turn during silence.
		const sliceAt = (at) => {
			if (at >= 3000 && at < 3200) {
				return 2
			}
			if (at >= 14500) {
				return 2
			}
			if (at >= 6500) {
				return 1
			}
			return 0
		}
		const m = followMetrics(frames(0, 20000, (at) => ({ truthMs: at, shownMs: at, slice: sliceAt(at) })), { measureStartsMs, slices })
		expect(m.a9Punctual).toBe(1)
		expect(m.a4LeadMs.median).toBe(1500)
		expect(m.a2WrongTurns).toBe(1)
		expect(m.a6TurnsWhileSilent).toBe(0)

		const late = followMetrics(frames(0, 20000, (at) => ({ truthMs: at, shownMs: at, slice: at < 8500 ? 0 : 1 })), { measureStartsMs, slices })
		expect(late.a9Punctual).toBe(0)

		const silent = followMetrics([
			...frames(0, 1000, (at) => ({ truthMs: at, shownMs: at, slice: 0 })),
			...frames(1000, 2000, () => ({ truthMs: null, shownMs: 1000, slice: 1 })),
		], { measureStartsMs, slices })
		expect(silent.a6TurnsWhileSilent).toBe(1)
	})
})

describe('summary', () => {
	it('median, p95, max', () => {
		const s = summary([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
		expect(s.median).toBe(6)
		expect(s.max).toBe(10)
		expect(summary([])).toBeNull()
	})
})
