import { describe, expect, it } from 'vitest'
import { proposeMarks } from './align.mjs'
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
