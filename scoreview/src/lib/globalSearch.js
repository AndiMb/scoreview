// PARKED - part of the microphone score follower (automatic page turning),
// which is paused; no viewer code imports it. Kept and tested because
// tools/follow/replay.mjs measures it against recorded rehearsals, and the
// work resumes from here. The switch `feature_score_follower` exists but
// turns nothing on (docs/installation.md).
//
// Finding the place again anywhere in the piece - after a jump in
// rehearsal ("again from bar 40"), at a cold start, when the follower is
// lost. Pure, no DOM, no AudioContext.
//
// The query is the last few seconds of live chroma as CENS (lib/chroma.js):
// smoothed over about a second, it no longer cares where exactly the notes
// fell, only which harmonies followed each other. It is compared against
// every position of every ensemble, at three tempi, and the best match wins
// - but only by a margin over the best match elsewhere, because a piece
// that repeats itself must not be resolved by guessing (F10).
//
// Measured cost per search: positions × ensembles × tempi × query frames ×
// 12 - for 5 minutes at 5 Hz, 8 ensembles, 3 tempi, 20 query frames about
// 8.6 million multiplications. Once per second that is a few milliseconds.

import { similarity, toCens } from './chroma.js'

/** Tempo ratios tried: a rehearsal rarely restarts at the written tempo. */
export const SEARCH_RATES = Object.freeze([0.8, 1, 1.25])

/**
 * Rotate a 12-bin chroma by `semitones` (positive = up).
 *
 * @param {Float32Array} chroma
 * @param {number} semitones
 * @return {Float32Array}
 */
export function rotateChroma(chroma, semitones) {
	const out = new Float32Array(12)
	for (let pc = 0; pc < 12; pc++) {
		out[(((pc + semitones) % 12) + 12) % 12] = chroma[pc]
	}
	return out
}

/**
 * Build the query from recent live frames. The oldest frames are trimmed so
 * that the last CENS frame is centred on the newest tap - the query then
 * ends "now", like the reference position it is compared with.
 *
 * @param {Array<?Float32Array>} frames 12-bin chroma per tap, oldest first, null = nothing heard
 * @param {number} frameMs tap spacing
 * @param {number} censMs CENS spacing of the reference
 * @param {object} [options]
 * @param {number} [options.minShare] share of taps that must have heard something
 * @return {?Float32Array[]} null if too little music was heard
 */
export function buildQuery(frames, frameMs, censMs, { minShare = 0.5 } = {}) {
	const heard = frames.filter(Boolean).length
	if (frames.length === 0 || heard / frames.length < minShare) {
		return null
	}
	const step = Math.max(1, Math.round(censMs / frameMs))
	const trimmed = frames.slice((frames.length - 1) % step)
	return toCens(trimmed, frameMs, { targetMs: censMs, smoothMs: 1000 })
}

/**
 * @typedef {object} SearchCandidate
 * @property {number} endMs score time at the end of the query (= now)
 * @property {number} score mean similarity over the query (0..1, plus prior)
 * @property {number} raw the same without prior
 * @property {string} ensemble which ensemble fits
 * @property {number} rate tempo ratio of the match
 * @property {number} rotation semitones the live sound sits above the score
 */

/**
 * Search the whole reference.
 *
 * @param {import('./followRef.js').FollowReference} reference
 * @param {Float32Array[]} query CENS frames, oldest first
 * @param {object} [options]
 * @param {number[]} [options.rates]
 * @param {number[]} [options.rotations] semitone rotations to try (R8: ±1 at a cold start)
 * @param {number} [options.priorWeight] weight of the entry prior at the start of the query
 * @param {number} [options.neighbourMs] distance that counts as "elsewhere"
 * @return {?{best: SearchCandidate, second: ?SearchCandidate, margin: number, scoreAt: (endMs: number) => number}}
 */
export function searchReference(reference, query, options = {}) {
	const {
		rates = SEARCH_RATES,
		rotations = [0],
		priorWeight = 0,
		neighbourMs = 1500,
	} = options
	if (!query || query.length < 3) {
		return null
	}
	const censMs = reference.censMs
	const positions = reference.cens[0].length
	const q = query.length
	// Best score per end position, over ensembles, tempi and rotations.
	const bestAt = new Float32Array(positions).fill(-Infinity)
	const rawAt = new Float32Array(positions).fill(-Infinity)
	const meta = new Array(positions)
	for (const rotation of rotations) {
		const rotated = rotation === 0 ? query : query.map((frame) => rotateChroma(frame, -rotation))
		for (let e = 0; e < reference.cens.length; e++) {
			const cens = reference.cens[e]
			for (const rate of rates) {
				const span = Math.round((q - 1) * rate)
				for (let end = span; end < positions; end++) {
					let sum = 0
					for (let k = 0; k < q; k++) {
						const ref = cens[end - Math.round(k * rate)]
						sum += similarity(rotated[q - 1 - k], ref)
					}
					const raw = sum / q
					const score = raw + priorWeight * reference.entryPrior[end - span]
					if (score > bestAt[end]) {
						bestAt[end] = score
						rawAt[end] = raw
						meta[end] = { ensemble: reference.ensembles[e].id, rate, rotation }
					}
				}
			}
		}
	}
	let best = -1
	for (let i = 0; i < positions; i++) {
		if (best < 0 || bestAt[i] > bestAt[best]) {
			best = i
		}
	}
	if (best < 0 || !Number.isFinite(bestAt[best])) {
		return null
	}
	const neighbour = Math.round(neighbourMs / censMs)
	let second = -1
	for (let i = 0; i < positions; i++) {
		if (Math.abs(i - best) > neighbour && (second < 0 || bestAt[i] > bestAt[second])) {
			second = i
		}
	}
	// CENS frame i is centred on reference frame i·step, whose middle is
	// half a reference frame later.
	const candidate = (i) => ({ endMs: i * censMs + reference.frameMs / 2, score: bestAt[i], raw: rawAt[i], ...meta[i] })
	return {
		best: candidate(best),
		second: second >= 0 && Number.isFinite(bestAt[second]) ? candidate(second) : null,
		margin: second >= 0 && Number.isFinite(bestAt[second]) ? bestAt[best] - bestAt[second] : bestAt[best],
		// The score near a given place - for comparing the local follower's
		// place against the search result.
		scoreAt: (endMs) => {
			const centre = Math.round(endMs / censMs)
			let max = -Infinity
			for (let i = Math.max(0, centre - 2); i <= Math.min(positions - 1, centre + 2); i++) {
				max = Math.max(max, rawAt[i])
			}
			return max
		},
	}
}
