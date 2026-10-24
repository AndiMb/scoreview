import { describe, expect, it } from 'vitest'
import { buildFollowReference } from './followRef.js'
import { createScoreFollower } from './scoreFollower.js'

const melody = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62, 64, 65, 67, 69]
const notes = melody.map((p, i) => ({ onMs: i * 500, offMs: i * 500 + 480, pitch: p, channel: 0 }))
const reference = buildFollowReference(notes, [{ id: 'v', label: 'Voice', channels: [0], vocal: true }], { durationMs: 10000 })

/** A live frame as the AnalyserNode chain would deliver it, from the reference at a score time. */
function frameAt(scoreMs, { cents = 0, levelDb = -10 } = {}) {
	const e = reference.ensembles[0]
	const f = Math.floor(scoreMs / reference.frameMs)
	if (e.silent[f]) {
		return { c36: null, levelDb: -Infinity }
	}
	const c36 = new Float32Array(36)
	for (let pc = 0; pc < 12; pc++) {
		// Put each class on its sub-bin, shifted by the detuning.
		const position = pc * 3 + 1 + cents / (100 / 3)
		const lower = Math.floor(position)
		const fraction = position - lower
		c36[(lower + 36) % 36] += e.chroma[f * 12 + pc] * (1 - fraction)
		c36[(lower + 37) % 36] += e.chroma[f * 12 + pc] * fraction
	}
	return { c36, levelDb }
}

describe('createScoreFollower', () => {
	it('searches until it gets an anchor', () => {
		const follower = createScoreFollower(reference, { windowMs: 0 })
		expect(follower.step(frameAt(1000), 0).phase).toBe('searching')
		expect(follower.shownMs(0)).toBeNull()
	})

	it('follows from an anchor and confirms the place', () => {
		const follower = createScoreFollower(reference, { windowMs: 0 })
		follower.anchor(0, 0)
		let state
		for (let at = 0; at < 6000; at += 50) {
			state = follower.step(frameAt(at), at)
		}
		expect(state.phase).toBe('following')
		expect(Math.abs(state.confirmedMs - 5975)).toBeLessThan(300)
		expect(state.confidence).toBeGreaterThan(0.8)
	})

	it('learns a detuning only from frames that matched', () => {
		const follower = createScoreFollower(reference, { windowMs: 0 })
		follower.anchor(0, 0)
		let state
		for (let at = 0; at < 9000; at += 50) {
			state = follower.step(frameAt(at, { cents: -30 }), at)
		}
		expect(state.tuningCents).toBeLessThan(-15)
	})

	it('becomes unsure on sound that fits nothing, and recovers', () => {
		const follower = createScoreFollower(reference, { windowMs: 0, unsureAfterMs: 1000 })
		follower.anchor(0, 0)
		for (let at = 0; at < 2000; at += 50) {
			follower.step(frameAt(at), at)
		}
		const flat = { c36: new Float32Array(36).fill(1 / 6), levelDb: -10 }
		let state
		for (let at = 2000; at < 3500; at += 50) {
			state = follower.step(flat, at)
		}
		expect(state.phase).toBe('unsure')
		const place = state.confirmedMs
		expect(place).toBeLessThan(2300)
		for (let at = 3500; at < 4000; at += 50) {
			state = follower.step(frameAt(at - 1500), at)
		}
		expect(state.phase).toBe('following')
	})
})
