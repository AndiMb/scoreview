// The measuring rig of the microphone follower: a recording (or a
// synthetic case) is cut into the same frames the viewer taps from its
// AnalyserNode, turned into the same features, and fed frame by frame to a
// follower. Nothing here touches a browser - which is what makes the
// acceptance figures (lib/followMetrics.js) repeatable.

import { analyserSpectrum, chroma36, createTuningState, fold12, similarity, spectrumLevelDb } from '../../src/lib/chroma.js'
import { followMetrics } from '../../src/lib/followMetrics.js'
import { buildFollowReference } from '../../src/lib/followRef.js'
import { decideTurn, rowAt } from '../../src/lib/followTurn.js'
import { createScoreFollower } from '../../src/lib/scoreFollower.js'
import { generatePiece } from './piece.mjs'
import { renderPerformance, truthAt } from './synth.mjs'

/** Tapping interval, as in the viewer. */
export const HOP_MS = 50

/**
 * FFT size giving about the live window (8192 at 48 kHz = 170 ms) at any
 * sample rate - a power of two, as the AnalyserNode demands.
 *
 * @param {number} sampleRate
 * @return {number}
 */
export function fftSizeFor(sampleRate) {
	return 2 ** Math.round(Math.log2(0.17 * sampleRate))
}

/**
 * Feature frames of a recording, every HOP_MS: what the viewer would have
 * read from its AnalyserNode at that moment (the window ends at `atMs`).
 *
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @param {object} [options]
 * @param {number} [options.hopMs]
 * @param {number} [options.fftSize]
 * @return {Array<{atMs:number, c36:?Float32Array, levelDb:number}>}
 */
export function featureFrames(samples, sampleRate, { hopMs = HOP_MS, fftSize = fftSizeFor(sampleRate) } = {}) {
	const frames = []
	const hop = (hopMs / 1000) * sampleRate
	for (let end = fftSize; end <= samples.length; end += hop) {
		const at = Math.round(end)
		const db = analyserSpectrum(samples.subarray(at - fftSize, at), fftSize)
		frames.push({
			atMs: (at / sampleRate) * 1000,
			c36: chroma36(db, sampleRate, fftSize),
			levelDb: spectrumLevelDb(db, sampleRate, fftSize),
		})
	}
	return frames
}

/**
 * Feature quality before any follower exists: at each sung frame, how well
 * does the live chroma match the reference AT THE TRUE POSITION (best
 * ensemble), and how many reference positions elsewhere match better?
 * A follower can only be as good as this.
 *
 * @param {Array<{atMs:number, c36:?Float32Array}>} frames
 * @param {import('../../src/lib/followRef.js').FollowReference} reference
 * @param {Array<{atMs:number, scoreMs:?number}>} truth
 * @param {object} [options]
 * @param {number} [options.tuningCents] start value of the tuning estimate
 * @param {number} [options.windowMs] compare windows of this length, not single frames
 * @return {{rows: object[], medianSimilarity: number, shareBestNearTruth: number}}
 */
export function diagnose(frames, reference, truth, { tuningCents = 0, windowMs = 1000 } = {}) {
	const tuning = createTuningState({ initialCents: tuningCents })
	const live = frames.map((f) => (f.c36 ? fold12(f.c36, tuning).chroma : null))
	const span = Math.max(1, Math.round(windowMs / reference.frameMs))
	const rows = []
	const step = Math.max(1, Math.round(500 / HOP_MS))
	for (let i = span; i < frames.length; i += step) {
		const scoreMs = truthAt(truth, frames[i].atMs)
		if (scoreMs === null) {
			continue
		}
		const truthFrame = Math.min(reference.frames - 1, Math.floor(scoreMs / reference.frameMs))
		const scoreAt = (end) => windowScore(live, i, span, reference, end)
		const atTruth = scoreAt(truthFrame)
		let better = 0
		let best = -Infinity
		let bestFrame = -1
		for (let f = span; f < reference.frames; f++) {
			const s = scoreAt(f)
			if (s > atTruth + 1e-6) {
				better++
			}
			if (s > best) {
				best = s
				bestFrame = f
			}
		}
		rows.push({
			atMs: frames[i].atMs,
			truthMs: scoreMs,
			similarityAtTruth: atTruth,
			betterPositions: better,
			bestMs: bestFrame * reference.frameMs,
			tuningCents: tuning.cents,
		})
	}
	const sims = rows.map((r) => r.similarityAtTruth).sort((a, b) => a - b)
	return {
		rows,
		medianSimilarity: sims.length ? sims[Math.floor(sims.length / 2)] : null,
		shareBestNearTruth: rows.length ? rows.filter((r) => Math.abs(r.bestMs - r.truthMs) < 2000).length / rows.length : null,
	}
}

/**
 * Mean of the best-ensemble similarity over `span` live frames ending at `liveEnd`, aligned to reference frames ending at `refEnd`.
 *
 * @param live
 * @param liveEnd
 * @param span
 * @param reference
 * @param refEnd
 */
function windowScore(live, liveEnd, span, reference, refEnd) {
	let sum = 0
	let count = 0
	for (let k = 0; k < span; k++) {
		const l = live[liveEnd - k]
		const r = refEnd - k
		if (!l || r < 0) {
			continue
		}
		let best = 0
		for (const ensemble of reference.ensembles) {
			if (ensemble.silent[r]) {
				continue
			}
			const s = similarity(l, ensemble.chroma.subarray(r * 12, r * 12 + 12))
			if (s > best) {
				best = s
			}
		}
		sum += best
		count++
	}
	return count ? sum / count : 0
}

/**
 * Run a follower over feature frames and collect what the metrics need.
 *
 * @param {Array<{atMs:number, c36:?Float32Array, levelDb:number}>} frames
 * @param {{step: (frame: object) => {shownMs:?number, confirmedMs?:?number, jumped?:boolean, slice?:?number}}} follower
 * @param {Array<{atMs:number, scoreMs:?number}>} truth
 * @return {import('../../src/lib/followMetrics.js').ReplayFrame[]}
 */
export function runFollower(frames, follower, truth) {
	return frames.map((frame) => ({
		atMs: frame.atMs,
		truthMs: truthAt(truth, frame.atMs),
		...follower.step(frame),
	}))
}

/**
 * The named synthetic cases on the generated piece (tools/follow/piece.mjs).
 *
 * @param {ReturnType<typeof generatePiece>} piece
 * @return {Object<string, {script: object[], options: object}>}
 */
export function syntheticCases(piece) {
	const bar = (n) => n * piece.barMs
	const end = piece.durationMs
	const { soprano, alto, tenor, bass, piano } = piece.channels
	const voices = [soprano, alto, tenor, bass]
	const common = { pianoChannels: [piano] }
	return {
		straight: { script: [{ type: 'play', fromMs: 0, toMs: end }], options: common },
		tempo: {
			script: [
				{ type: 'play', fromMs: 0, toMs: bar(16), rate: 0.85, wobble: 0.08 },
				{ type: 'play', fromMs: bar(16), toMs: end, rate: 1.15, wobble: 0.08 },
			],
			options: common,
		},
		acappellaDrift: {
			script: [{ type: 'play', fromMs: bar(2), toMs: end, channels: voices }],
			options: { ...common, tuningCents: -10, driftCents: -70 },
		},
		partial: {
			script: [
				{ type: 'play', fromMs: bar(2), toMs: bar(6), channels: [tenor] },
				{ type: 'play', fromMs: bar(6), toMs: bar(10), channels: [piano, soprano] },
				{ type: 'play', fromMs: bar(10), toMs: bar(14), channels: voices },
				{ type: 'play', fromMs: bar(14), toMs: bar(18), channels: [piano] },
				{ type: 'play', fromMs: bar(18), toMs: bar(22), channels: [bass] },
			],
			options: common,
		},
		rehearsal: {
			script: [
				{ type: 'play', fromMs: bar(2), toMs: bar(9), rate: 0.95 },
				{ type: 'speech', durMs: 5000 },
				{ type: 'play', fromMs: bar(16), toMs: bar(21), channels: voices },
				{ type: 'silence', durMs: 2000 },
				{ type: 'grips', durMs: 1500 },
				{ type: 'play', fromMs: bar(10), toMs: bar(14), channels: [tenor] },
				{ type: 'speech', durMs: 3000 },
				{ type: 'play', fromMs: bar(24), toMs: end, rate: 1.05 },
			],
			options: common,
		},
		room: {
			script: [{ type: 'play', fromMs: 0, toMs: end }],
			options: { ...common, reverb: 0.4, noise: 0.02 },
		},
		// R8: a whole ensemble almost a semitone flat from the start
		// (baroque pitch a' = 415 Hz is -100 cents).
		lowPitch: {
			script: [{ type: 'play', fromMs: bar(2), toMs: end }],
			options: { ...common, tuningCents: -95 },
		},
		ownVoiceLoud: {
			script: [{ type: 'play', fromMs: 0, toMs: end, gains: { [alto]: 5 } }],
			options: common,
		},
	}
}

/**
 * Render one synthetic case and build everything a replay needs.
 *
 * @param {string} name
 * @param {object} [options]
 * @param {number} [options.seed]
 * @param {number} [options.sampleRate]
 * @return {object}
 */
export function syntheticCase(name, { seed = 7, sampleRate = 22050 } = {}) {
	const piece = generatePiece({ seed })
	const spec = syntheticCases(piece)[name]
	if (!spec) {
		throw new Error(`Unknown case ${name}`)
	}
	const performance = renderPerformance(piece.notes, spec.script, { ...spec.options, sampleRate, seed })
	const reference = buildFollowReference(piece.notes, piece.parts, {
		durationMs: piece.durationMs,
		markersMs: piece.markersMs,
		measureStartsMs: piece.measureStartsMs,
		systemStartsMs: piece.slices.map((s) => s.fromMs),
	})
	return { name, piece, performance, reference }
}

/**
 * Metrics of a follower run on a synthetic case.
 *
 * @param {object} kase from syntheticCase()
 * @param {import('../../src/lib/followMetrics.js').ReplayFrame[]} replay
 * @return {object}
 */
export function caseMetrics(kase, replay) {
	return followMetrics(replay, { measureStartsMs: kase.piece.measureStartsMs, slices: kase.piece.slices })
}

/**
 * Run the score follower over a synthetic case, with the turn policy of
 * lib/followTurn.js on rows of four bars, two rows on screen.
 *
 * @param {object} kase from syntheticCase()
 * @param {object} [options] options of lib/scoreFollower.js, plus:
 * @param {boolean} [options.anchored] start at an anchor where the performance
 *   begins (a bar entered by hand) instead of searching from cold
 * @param {number} [options.visibleRows]
 * @return {{replay: import('../../src/lib/followMetrics.js').ReplayFrame[], metrics: object}}
 */
export function followCase(kase, { anchored = false, visibleRows = 2, ...options } = {}) {
	const { samples, sampleRate, truth } = kase.performance
	const fftSize = fftSizeFor(sampleRate)
	const frames = featureFrames(samples, sampleRate, { fftSize })
	const follower = createScoreFollower(kase.reference, { windowMs: (fftSize / sampleRate) * 1000, ...options })
	const start = truth.find((t) => t.scoreMs !== null)
	if (anchored) {
		follower.anchor(start.scoreMs, start.atMs)
	}
	const rows = kase.piece.slices
	let first = rowAt(rows, start.scoreMs)
	const replay = frames.map((frame) => {
		const state = follower.step(frame, frame.atMs)
		const next = decideTurn({ first, visible: visibleRows, rows, state })
		if (next !== null) {
			first = next
		}
		return {
			atMs: frame.atMs,
			truthMs: truthAt(truth, frame.atMs),
			shownMs: follower.shownMs(frame.atMs),
			confirmedMs: state.confirmedMs,
			jumped: state.jumped,
			phase: state.phase,
			ensemble: state.ensemble,
			tuningCents: state.tuningCents,
			slice: first,
		}
	})
	return { replay, metrics: followMetrics(replay, { measureStartsMs: kase.piece.measureStartsMs, slices: rows, visibleRows }) }
}
