import { describe, expect, it } from 'vitest'
import { alignPlan, parsePlan, proposeMarks } from './align.mjs'
import { featureFrames, fftSizeFor, syntheticCase } from './replay.mjs'
import { truthAt } from './synth.mjs'

/** Draft marks of a synthetic case, each with the score time it really had. */
function draft(name) {
	const kase = syntheticCase(name)
	const { samples, sampleRate, truth } = kase.performance
	const fftSize = fftSizeFor(sampleRate)
	const frames = featureFrames(samples, sampleRate, { fftSize })
	const bars = kase.piece.measureStartsMs.map((timeMs, i) => ({ measure: i + 1, pass: 1, timeMs }))
	const result = proposeMarks(frames, kase.reference, bars, { windowMs: (fftSize / sampleRate) * 1000 })
	const barMarks = result.marks.filter((m) => m.measure)
	const errors = barMarks.map((m) => {
		// Look a little after the mark: at the exact downbeat the truth may
		// still be null when the singing starts on it.
		const real = truthAt(truth, m.atMs + 100)
		return real === null ? Infinity : Math.abs(real - 100 - bars[m.measure - 1].timeMs)
	})
	return { ...result, barMarks, errors, barMs: kase.piece.barMs }
}

// Rendering and aligning a whole case takes seconds; with the whole suite
// running in parallel it outlasts the default 5 s.
describe('proposeMarks', { timeout: 30000 }, () => {
	it('drafts the bars of a straight performance within a quarter bar', () => {
		const { barMarks, errors, barMs, stretches } = draft('tempo')
		expect(stretches).toHaveLength(1)
		expect(barMarks.length).toBeGreaterThanOrEqual(30)
		expect(errors.filter((e) => e < barMs / 4).length / errors.length).toBeGreaterThanOrEqual(0.9)
	})

	it('splits a rehearsal at speech and pauses and finds each restart', () => {
		const { marks, errors, barMs } = draft('rehearsal')
		// Four sung stretches in the script, each closed by a stop.
		expect(marks.filter((m) => m.type === 'stop').length).toBe(4)
		expect(errors.filter((e) => e < barMs / 2).length / errors.length).toBeGreaterThanOrEqual(0.9)
	})
})

describe('parsePlan', () => {
	// Bars 1 2 3 2 3 4: bars 2-3 repeated.
	const bars = [1, 2, 3, 2, 3, 4].map((measure, i, all) => ({
		measure,
		pass: all.slice(0, i).filter((m) => m === measure).length + 1,
		timeMs: i * 1000,
	}))

	it('reads ranges, passes, repeats and the end', () => {
		expect(parsePlan('1-3; 2/2-end', bars)).toEqual([
			{ from: 0, to: 2, times: 1, label: '1-3' },
			{ from: 3, to: 5, times: 1, label: '2/2-end' },
		])
		expect(parsePlan('2-3x3', bars)[0]).toMatchObject({ from: 1, to: 2, times: 3 })
		expect(parsePlan('2-3*', bars)[0].times).toBe('*')
	})

	it('takes the end bar at or after the start', () => {
		// "3-2" cannot mean the first bar 2; the second one follows bar 3.
		expect(parsePlan('3-2', bars)[0]).toMatchObject({ from: 2, to: 3 })
	})

	it('names what it cannot read', () => {
		expect(() => parsePlan('9-10', bars)).toThrow(/bar 9/)
		expect(() => parsePlan('a-b', bars)).toThrow(/cannot read/)
	})
})

describe('alignPlan', { timeout: 30000 }, () => {
	it('places the bars of a known straight performance within a quarter bar', () => {
		const kase = syntheticCase('tempo')
		const { samples, sampleRate, truth } = kase.performance
		const fftSize = fftSizeFor(sampleRate)
		const frames = featureFrames(samples, sampleRate, { fftSize })
		const bars = kase.piece.measureStartsMs.map((timeMs, i) => ({ measure: i + 1, pass: 1, timeMs }))
		const result = alignPlan(frames, kase.reference, bars, parsePlan('1-end', bars), {
			windowMs: (fftSize / sampleRate) * 1000,
			durationMs: kase.reference.durationMs,
		})
		const barMarks = result.marks.filter((m) => m.measure)
		expect(barMarks).toHaveLength(bars.length)
		expect(barMarks.map((m) => m.measure)).toEqual(bars.map((b) => b.measure))
		const errors = barMarks.map((m) => {
			const real = truthAt(truth, m.atMs + 100)
			return real === null ? Infinity : Math.abs(real - 100 - bars[m.measure - 1].timeMs)
		})
		expect(errors.filter((e) => e < kase.piece.barMs / 4).length / errors.length).toBeGreaterThanOrEqual(0.9)
		expect(result.marks.at(-1).type).toBe('stop')
	})
})
