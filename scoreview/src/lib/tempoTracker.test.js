import { describe, expect, it } from 'vitest'
import { buildFollowReference } from './followRef.js'
import { createTempoTracker } from './tempoTracker.js'

// A melody of quarter notes (500 ms) for voice over held piano chords, as
// in onlineWarp.test.js, but long enough for tempo to matter.
const melody = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62]
const notes = []
for (let round = 0; round < 3; round++) {
	melody.forEach((p, i) => notes.push({ onMs: round * 8000 + i * 500, offMs: round * 8000 + i * 500 + 480, pitch: p + 2 * round, channel: 0 }))
}
for (let bar = 0; bar < 12; bar++) {
	notes.push({ onMs: bar * 2000, offMs: bar * 2000 + 1900, pitch: [48, 53, 55, 48, 50][bar % 5], channel: 1 })
}
const parts = [
	{ id: 'v', label: 'Voice', channels: [0], vocal: true },
	{ id: 'p', label: 'Piano', channels: [1], vocal: false },
]
const reference = buildFollowReference(notes, parts, { durationMs: 24000 })

/** The tutti reference chroma at a score time, as a live frame. */
function liveAt(scoreMs) {
	const e = reference.ensembles[0]
	const f = Math.floor(scoreMs / reference.frameMs)
	return e.silent[f] ? null : Float32Array.from(e.chroma.subarray(f * 12, f * 12 + 12))
}

describe('createTempoTracker', () => {
	it('learns a tempo the score does not have and keeps up', () => {
		for (const rate of [0.9, 1.15]) {
			const tracker = createTempoTracker(reference, { particles: 300 })
			tracker.anchor(0)
			let last = null
			for (let tap = 0; tap * 50 * rate < 18000; tap++) {
				last = { r: tracker.step(liveAt(tap * 50 * rate)), scoreMs: tap * 50 * rate }
			}
			expect(tracker.tempoRatio()).toBeGreaterThan(rate - 0.08)
			expect(tracker.tempoRatio()).toBeLessThan(rate + 0.08)
			expect(Math.abs(last.r.position * 50 - last.scoreMs)).toBeLessThan(500)
		}
	})

	it('stands still while sound that fits nothing is heard', () => {
		const tracker = createTempoTracker(reference, { particles: 300 })
		tracker.anchor(0)
		for (let tap = 0; tap < 100; tap++) {
			tracker.step(liveAt(tap * 50))
		}
		const before = tracker.position()
		// Talking: sound in pitch classes the opening does not use (Eb, Ab, Bb).
		const talk = new Float32Array(12)
		talk[3] = talk[8] = talk[10] = 1 / Math.sqrt(3)
		let result = null
		for (let tap = 0; tap < 60; tap++) {
			result = tracker.step(talk)
		}
		expect(result.matched).toBe(false)
		expect(Math.abs(tracker.position() - before)).toBeLessThan(10)
	})

	it('repeats itself for the same seed', () => {
		const run = () => {
			const tracker = createTempoTracker(reference, { particles: 100, seed: 3 })
			tracker.anchor(0)
			const positions = []
			for (let tap = 0; tap < 80; tap++) {
				positions.push(tracker.step(liveAt(tap * 55)).position)
			}
			return positions
		}
		expect(run()).toEqual(run())
	})
})
