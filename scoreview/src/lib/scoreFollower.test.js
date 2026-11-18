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

	it('a pause between two odd frames is no second of sound that fits nothing', () => {
		const follower = createScoreFollower(reference, { windowMs: 0, unsureAfterMs: 1000 })
		follower.anchor(0, 0)
		for (let at = 0; at < 2000; at += 50) {
			follower.step(frameAt(at), at)
		}
		const flat = { c36: new Float32Array(36).fill(1 / 6), levelDb: -10 }
		follower.step(flat, 2000)
		for (let at = 2050; at < 4000; at += 50) {
			follower.step({ c36: null, levelDb: -Infinity }, at)
		}
		expect(follower.step(flat, 4000).phase).toBe('following')
	})

	// A B C A B, the repeats note for note the same and printed twice: by
	// sound alone the second A B cannot be told from the first (F10).
	function coldStart(view) {
		const phrases = [[60, 64, 67, 72, 67, 64, 60, 64], [62, 65, 69, 74, 69, 65, 62, 65], [57, 60, 64, 69, 71, 72, 74, 76]]
		const abcab = [0, 1, 2, 0, 1].flatMap((phrase, n) => phrases[phrase].map((pitch, i) => ({
			onMs: n * 4000 + i * 500,
			offMs: n * 4000 + i * 500 + 480,
			pitch,
			channel: 0,
		})))
		const song = buildFollowReference(abcab, [{ id: 'v', label: 'Voice', channels: [0], vocal: true }], { durationMs: 20000 })
		const e = song.ensembles[0]
		const follower = createScoreFollower(song, { windowMs: 0 })
		follower.setView(view)
		let state
		for (let at = 0; at < 7900; at += 50) {
			const f = Math.floor((12000 + at) / song.frameMs)
			const c36 = new Float32Array(36)
			for (let pc = 0; pc < 12; pc++) {
				c36[pc * 3 + 1] = e.chroma[f * 12 + pc]
			}
			state = follower.step(e.silent[f] ? { c36: null, levelDb: -Infinity } : { c36, levelDb: -10 }, at)
		}
		return state
	}

	it('a repeated phrase at a cold start: no place without a hint', () => {
		expect(coldStart(null).phase).toBe('searching')
	})

	it('the page on screen settles it', () => {
		const state = coldStart([{ fromMs: 12000, toMs: 20000 }])
		expect(state.phase).toBe('following')
		expect(Math.abs(state.confirmedMs - 19900)).toBeLessThan(600)
	})
})

describe('createScoreFollower at a tap', () => {
	// A minute of melody that does not repeat, so every few seconds of it
	// fit one place only.
	const pitches = []
	let seed = 7
	for (let i = 0; i < 120; i++) {
		seed = (seed * 1103515245 + 12345) % 2147483648
		pitches.push(55 + (seed % 19))
	}
	const long = buildFollowReference(
		pitches.map((pitch, i) => ({ onMs: i * 500, offMs: i * 500 + 480, pitch, channel: 0 })),
		[{ id: 'v', label: 'Voice', channels: [0], vocal: true }],
		{ durationMs: 60000 },
	)
	const e = long.ensembles[0]
	const sing = (scoreMs) => {
		const f = Math.floor(scoreMs / long.frameMs)
		if (e.silent[f]) {
			return { c36: null, levelDb: -Infinity }
		}
		const c36 = new Float32Array(36)
		for (let pc = 0; pc < 12; pc++) {
			c36[pc * 3 + 1] = e.chroma[f * 12 + pc]
		}
		return { c36, levelDb: -10 }
	}

	for (const before of ['following', 'searching']) {
		it(`forgets what it heard before the tap (${before} there): no jump back`, () => {
			const follower = createScoreFollower(long, { windowMs: 0 })
			if (before === 'following') {
				follower.anchor(30000, 0)
			}
			for (let at = 0; at < 6000; at += 50) {
				follower.step(sing(30000 + at), at)
			}
			follower.anchor(5000, 6000)
			let state
			for (let at = 6000; at < 12000; at += 50) {
				state = follower.step(sing(5000 + at - 6000), at)
				expect(state.jumped).toBe(false)
				expect(state.confirmedMs).toBeLessThan(15000)
			}
			expect(state.phase).toBe('following')
			expect(Math.abs(state.confirmedMs - 11000)).toBeLessThan(1000)
		})
	}
})
