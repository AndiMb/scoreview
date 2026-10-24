import { describe, expect, it } from 'vitest'
import { analyserSpectrum, chroma36, createTuningState, fold12, frameTuningCents, similarity, spectrumLevelDb, toCens } from './chroma.js'

const SR = 48000
const N = 8192

function tone(midis, { cents = 0, harmonics = [1, 0.5, 0.3], seconds = 0.2, sampleRate = SR } = {}) {
	const samples = new Float32Array(Math.round(seconds * sampleRate))
	for (const midi of midis) {
		const hz = 440 * 2 ** ((midi - 69 + cents / 100) / 12)
		harmonics.forEach((amp, h) => {
			for (let i = 0; i < samples.length; i++) {
				samples[i] += 0.1 * amp * Math.sin((2 * Math.PI * hz * (h + 1) * i) / sampleRate)
			}
		})
	}
	return samples
}

function chromaOf(midis, options) {
	const spectrum = analyserSpectrum(tone(midis, options), N)
	return chroma36(spectrum, SR, N)
}

function top(chroma, count) {
	return [...chroma].map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, count).map(([, i]) => i).sort((a, b) => a - b)
}

describe('analyserSpectrum', () => {
	it('puts a sine into its bin, scaled like the AnalyserNode', () => {
		// Exactly on bin 100: magnitude after Blackman is A·a0/2 = 0.5·0.42/2.
		const hz = (100 * SR) / N
		const samples = new Float32Array(N)
		for (let i = 0; i < N; i++) {
			samples[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SR)
		}
		const db = analyserSpectrum(samples, N)
		const peak = db.indexOf(Math.max(...db))
		expect(peak).toBe(100)
		expect(db[100]).toBeCloseTo(20 * Math.log10((0.5 * 0.42) / 2), 1)
	})

	it('uses only the last fftSize samples', () => {
		const long = new Float32Array(N * 2)
		long.set(tone([69], { seconds: N / SR }), N)
		const short = tone([69], { seconds: N / SR })
		expect(analyserSpectrum(long, N)).toEqual(analyserSpectrum(short, N))
	})
})

describe('chroma36 and fold12', () => {
	it('finds the three classes of a major triad', () => {
		const c = fold12(chromaOf([60, 64, 67]), createTuningState(), { learn: false }).chroma
		expect(top(c, 3)).toEqual([0, 4, 7])
	})

	it('reads a low bass note through its harmonics', () => {
		// E2, 82 Hz - closer to its neighbours than one FFT bin.
		const c = fold12(chromaOf([40]), createTuningState(), { learn: false }).chroma
		expect(top(c, 1)).toEqual([4])
	})

	it('returns null for silence', () => {
		const db = analyserSpectrum(new Float32Array(N), N)
		expect(chroma36(db, SR, N)).toBeNull()
		expect(spectrumLevelDb(db, SR, N)).toBe(-Infinity)
	})

	it('sees a detuning of a third of a semitone', () => {
		expect(frameTuningCents(chromaOf([60, 64, 67], { cents: 33 }))).toBeCloseTo(33, -1)
		expect(frameTuningCents(chromaOf([60, 64, 67], { cents: -20 }))).toBeCloseTo(-20, -1)
	})

	it('keeps a sinking choir in its key instead of wrapping', () => {
		// Sink in steps to -80 cents: unwrapped, the estimate follows, and C
		// major stays C major (wrapping would read it as B major at +20).
		const tuning = createTuningState({ smoothing: 0.5 })
		let result
		for (let cents = 0; cents >= -80; cents -= 10) {
			for (let i = 0; i < 4; i++) {
				result = fold12(chromaOf([60, 64, 67], { cents }), tuning)
			}
		}
		expect(result.tuningCents).toBeLessThan(-65)
		expect(top(result.chroma, 3)).toEqual([0, 4, 7])
	})

	it('without tuning a strongly detuned chord blurs, with it the chord stays clear', () => {
		const detuned = chromaOf([60, 64, 67], { cents: -45 })
		const fixed = fold12(detuned, createTuningState({ initialCents: -45 }), { learn: false }).chroma
		const naive = fold12(detuned, createTuningState(), { learn: false }).chroma
		const clean = fold12(chromaOf([60, 64, 67]), createTuningState(), { learn: false }).chroma
		expect(similarity(fixed, clean)).toBeGreaterThan(similarity(naive, clean))
	})
})

describe('toCens', () => {
	it('smooths, downsamples and normalises', () => {
		const c = new Float32Array(12)
		c[0] = 1
		const g = new Float32Array(12)
		g[7] = 1
		const frames = [...Array(40).fill(c), ...Array(40).fill(null), ...Array(40).fill(g)]
		const cens = toCens(frames, 50, { targetMs: 200, smoothMs: 1000 })
		expect(cens).toHaveLength(30)
		expect(top(cens[2], 1)).toEqual([0])
		expect(top(cens[27], 1)).toEqual([7])
		expect(Math.hypot(...cens[2])).toBeCloseTo(1, 5)
		// Deep in the silence there is nothing to normalise.
		expect(Math.max(...cens[15])).toBe(0)
	})
})
