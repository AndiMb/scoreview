import { describe, expect, it } from 'vitest'
import { analyserSpectrum, fftSizeFor } from './chroma.js'
import { clearVoiceMidi, createVoicePitch, partLine, pitchClassDistance } from './voicePitch.js'

const RATE = 22050
const FFT = fftSizeFor(RATE)

/** A sung-like tone: a fundamental with decaying partials. */
function tone(hzList, { partials = 6, gains = [] } = {}) {
	const samples = new Float32Array(FFT)
	for (const [k, hz] of hzList.entries()) {
		for (let h = 1; h <= partials; h++) {
			for (let i = 0; i < FFT; i++) {
				samples[i] += ((gains[k] ?? 1) * 0.3 / h) * Math.sin((2 * Math.PI * hz * h * i) / RATE)
			}
		}
	}
	return analyserSpectrum(samples, FFT)
}

describe('createVoicePitch', () => {
	const estimate = createVoicePitch(RATE, FFT)

	it('finds a bass and a soprano within a quarter tone', () => {
		for (const hz of [98, 196, 523.25]) {
			const result = estimate(tone([hz]))
			expect(Math.abs(1200 * Math.log2(result.hz / hz))).toBeLessThan(50)
			expect(clearVoiceMidi(result)).not.toBeNull()
		}
	})

	it('hears the nearest voice in a chord as the one it names', () => {
		// The own voice next to the phone is louder than the neighbour a third up.
		const midi = clearVoiceMidi(estimate(tone([220, 277.18], { gains: [1, 0.4] })))
		expect(Math.abs(pitchClassDistance(midi, 57))).toBeLessThan(0.5)
	})

	it('names no pitch that nobody sings', () => {
		const midi = clearVoiceMidi(estimate(tone([220, 277.18])))
		if (midi !== null) {
			expect(Math.min(Math.abs(pitchClassDistance(midi, 57)), Math.abs(pitchClassDistance(midi, 61)))).toBeLessThan(0.5)
		}
	})

	it('says nothing in silence', () => {
		expect(estimate(new Float32Array(FFT / 2).fill(-Infinity))).toBeNull()
	})
})

describe('pitchClassDistance', () => {
	it('folds octaves and keeps the sign', () => {
		expect(pitchClassDistance(48, 60)).toBeCloseTo(0)
		expect(pitchClassDistance(61, 48)).toBe(1)
		expect(pitchClassDistance(59, 48)).toBe(-1)
		expect(pitchClassDistance(54.5, 48)).toBeCloseTo(-5.5)
	})
})

describe('partLine', () => {
	it('takes the highest note of the part and rests elsewhere', () => {
		const notes = [
			{ onMs: 0, offMs: 100, pitch: 48, channel: 0 },
			{ onMs: 0, offMs: 100, pitch: 52, channel: 0 },
			{ onMs: 0, offMs: 200, pitch: 72, channel: 1 },
		]
		const line = partLine(notes, [0], 4, 50)
		expect(Array.from(line.subarray(0, 2))).toEqual([52, 52])
		expect(Number.isNaN(line[2])).toBe(true)
	})
})
