import { describe, expect, it } from 'vitest'
import { buildFollowReference } from './followRef.js'
import { createOnlineWarp } from './onlineWarp.js'

// A melody of quarter notes (500 ms) for voice (channel 0) over held piano
// chords (channel 1), with a two-bar rest of the voice in the middle.
const melody = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62]
const notes = []
melody.forEach((p, i) => notes.push({ onMs: i * 500, offMs: i * 500 + 480, pitch: p, channel: 0 }))
melody.forEach((p, i) => notes.push({ onMs: 12000 + i * 500, offMs: 12000 + i * 500 + 480, pitch: p + 5, channel: 0 }))
for (let bar = 0; bar < 10; bar++) {
	const root = [48, 53, 55, 48, 50][bar % 5]
	notes.push({ onMs: bar * 2000, offMs: bar * 2000 + 1900, pitch: root, channel: 1 })
}
const parts = [
	{ id: 'v', label: 'Voice', channels: [0], vocal: true },
	{ id: 'p', label: 'Piano', channels: [1], vocal: false },
]
const reference = buildFollowReference(notes, parts, { durationMs: 20000 })

/** The reference chroma of an ensemble at a score time, as a live frame. */
function liveAt(ensembleId, scoreMs) {
	const e = reference.ensembles.find((x) => x.id === ensembleId)
	const f = Math.floor(scoreMs / reference.frameMs)
	return e.silent[f] ? null : Float32Array.from(e.chroma.subarray(f * 12, f * 12 + 12))
}

function follow(warp, ensembleId, fromMs, toMs, rate) {
	const errors = []
	for (let perf = 0; fromMs + perf * rate < toMs; perf += 50) {
		const scoreMs = fromMs + perf * rate
		const r = warp.step(liveAt(ensembleId, scoreMs))
		if (r.matched) {
			errors.push(Math.abs(r.position * 50 - scoreMs))
		}
	}
	return errors
}

describe('createOnlineWarp', () => {
	it('follows at 0.8x and 1.25x within a frame or two', () => {
		for (const rate of [0.8, 1.25]) {
			const warp = createOnlineWarp(reference)
			warp.anchor(0)
			const errors = follow(warp, 'tutti', 0, 8000, rate)
			errors.sort((a, b) => a - b)
			expect(errors[Math.floor(errors.length / 2)]).toBeLessThanOrEqual(100)
			expect(warp.tempoRatio()).toBeCloseTo(rate, 1)
		}
	})

	it('follows the voice alone and names the ensemble (F24)', () => {
		const warp = createOnlineWarp(reference)
		warp.anchor(0)
		const errors = follow(warp, 'voices', 0, 7900, 1)
		expect(Math.max(...errors.slice(10))).toBeLessThanOrEqual(150)
		// Ensembles here: tutti, accompaniment, voices (the one voice);
		// the voice alone fits best.
		expect(warp.step(liveAt('voices', 7950)).ensemble).toBe('voices')
	})

	it('stands still while nothing is heard in a sung passage', () => {
		const warp = createOnlineWarp(reference)
		warp.anchor(0)
		follow(warp, 'tutti', 0, 3000, 1)
		const before = warp.position()
		for (let i = 0; i < 40; i++) {
			warp.step(null)
		}
		expect(warp.position()).toBe(before)
	})

	it('runs through the rest of the performing ensemble in silence', () => {
		// Voice alone up to its rest at 8 s; 4 s of silence; it resumes at
		// 12 s - the piano interlude is no rest for the tutti, but it is
		// for the voice that is being heard.
		const warp = createOnlineWarp(reference)
		warp.anchor(0)
		follow(warp, 'voices', 0, 7950, 1)
		for (let i = 0; i < 80; i++) {
			warp.step(null)
		}
		expect(warp.position() * 50).toBeGreaterThan(11000)
	})

	it('treats a frame that fits nothing nearby as a pause', () => {
		const warp = createOnlineWarp(reference)
		warp.anchor(0)
		follow(warp, 'tutti', 0, 2000, 1)
		const before = warp.position()
		const noise = new Float32Array(12).fill(1 / Math.sqrt(12))
		for (let i = 0; i < 20; i++) {
			expect(warp.step(noise).matched).toBe(false)
		}
		expect(Math.abs(warp.position() - before)).toBeLessThanOrEqual(1)
	})

	it('does nothing before an anchor', () => {
		const warp = createOnlineWarp(reference)
		expect(warp.step(liveAt('tutti', 0)).position).toBeNull()
	})
})
