import { describe, expect, it } from 'vitest'
import { detectPitch, FRAME_SIZE } from './pitchDetect.js'
import { createDownsampler } from './resample.js'

/**
 * Wie im Worklet: Bloecke zu 128 Samples.
 *
 * @param {Float32Array} input
 * @param {number} inRate
 * @return {Float32Array}
 */
function inBloecken(input, inRate) {
	const ds = createDownsampler(inRate, 16000)
	const teile = []
	for (let i = 0; i < input.length; i += 128) {
		teile.push(ds.process(input.subarray(i, i + 128)))
	}
	const out = new Float32Array(teile.reduce((s, t) => s + t.length, 0))
	let o = 0
	for (const t of teile) {
		out.set(t, o)
		o += t.length
	}
	return out
}

function sinus(hz, rate, sekunden, amplitude = 0.5) {
	return new Float32Array(Math.round(rate * sekunden)).map((_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate))
}

function rms(x) {
	return Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
}

describe('createDownsampler', () => {
	it.each([48000, 44100])('liefert bei %i Hz ein Drittel bzw. den Bruchteil an Samples', (rate) => {
		const out = inBloecken(sinus(440, rate, 1), rate)
		expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(2)
	})

	it.each([48000, 44100])('behaelt bei %i Hz Tonhoehe und Pegel eines Tons im Band', (rate) => {
		const out = inBloecken(sinus(440, rate, 0.5), rate)
		const frame = out.subarray(2000, 2000 + FRAME_SIZE)
		const { hz } = detectPitch(frame)
		expect(1200 * Math.log2(hz / 440)).toBeCloseTo(0, 0)
		expect(rms(out.subarray(2000))).toBeCloseTo(0.5 / Math.SQRT2, 1)
	})

	it('daempft, was sich sonst ins Band falten wuerde', () => {
		// 12 kHz faltete sich bei 16 kHz auf 4 kHz - ohne Tiefpass mit vollem Pegel.
		const out = inBloecken(sinus(12000, 48000, 0.5), 48000)
		expect(rms(out.subarray(1000))).toBeLessThan(0.02)
	})

	it('nennt die Eingabeposition jedes Ausgabesamples', () => {
		const ds = createDownsampler(48000, 16000)
		expect(ds.inputPositionOf(10)).toBe(30)
	})
})
