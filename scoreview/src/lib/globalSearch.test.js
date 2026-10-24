import { describe, expect, it } from 'vitest'
import { buildFollowReference } from './followRef.js'
import { buildQuery, rotateChroma, searchReference } from './globalSearch.js'

// Three distinct phrases, the first repeated note for note at the end:
// A B C A.
const phrases = [
	[60, 64, 67, 72, 67, 64, 60, 64],
	[62, 65, 69, 74, 69, 65, 62, 65],
	[57, 60, 64, 69, 71, 72, 74, 76],
]
const order = [0, 1, 2, 0]
const notes = []
order.forEach((phrase, n) => {
	phrases[phrase].forEach((pitch, i) => {
		notes.push({ onMs: n * 4000 + i * 500, offMs: n * 4000 + i * 500 + 480, pitch, channel: 0 })
		notes.push({ onMs: n * 4000 + i * 500, offMs: n * 4000 + i * 500 + 480, pitch: pitch - 12, channel: 0 })
	})
})
const reference = buildFollowReference(notes, [{ id: 'v', label: 'V', channels: [0], vocal: true }], { durationMs: 16000 })

/** Live taps (50 ms) from the reference between two score times. */
function taps(fromMs, toMs, rotation = 0) {
	const e = reference.ensembles[0]
	const out = []
	for (let ms = fromMs; ms < toMs; ms += 50) {
		const f = Math.floor(ms / 50)
		out.push(e.silent[f] ? null : rotateChroma(e.chroma.subarray(f * 12, f * 12 + 12), rotation))
	}
	return out
}

describe('rotateChroma', () => {
	it('moves pitch classes up', () => {
		const c = new Float32Array(12)
		c[11] = 1
		expect(rotateChroma(c, 1)[0]).toBe(1)
		expect(rotateChroma(c, -11)[0]).toBe(1)
	})
})

describe('buildQuery', () => {
	it('needs enough heard taps', () => {
		expect(buildQuery([null, null, null], 50, 200)).toBeNull()
		expect(buildQuery([], 50, 200)).toBeNull()
		expect(buildQuery(taps(4000, 8000), 50, 200).length).toBeGreaterThan(15)
	})
})

describe('searchReference', () => {
	it('finds a distinct phrase by a margin', () => {
		const result = searchReference(reference, buildQuery(taps(5000, 8000), 50, reference.censMs))
		expect(Math.abs(result.best.endMs - 8000)).toBeLessThan(600)
		expect(result.margin).toBeGreaterThan(0.05)
	})

	it('a repeated phrase has no margin - it must not be taken on sound alone (F10)', () => {
		const result = searchReference(reference, buildQuery(taps(1000, 3500), 50, reference.censMs))
		expect([3500, 15500].some((ms) => Math.abs(result.best.endMs - ms) < 600)).toBe(true)
		expect(result.margin).toBeLessThan(0.01)
	})

	it('finds a phrase sung a semitone low only when rotations are allowed (R8)', () => {
		const query = buildQuery(taps(9000, 12000, -1), 50, reference.censMs)
		const plain = searchReference(reference, query)
		const rotated = searchReference(reference, query, { rotations: [-1, 0, 1] })
		expect(rotated.best.rotation).toBe(-1)
		expect(Math.abs(rotated.best.endMs - 12000)).toBeLessThan(600)
		expect(rotated.best.raw).toBeGreaterThan(plain.best.raw)
	})

	it('reports the score near a given place', () => {
		const result = searchReference(reference, buildQuery(taps(5000, 8000), 50, reference.censMs))
		expect(result.scoreAt(8000)).toBeGreaterThan(result.scoreAt(12000))
	})
})
