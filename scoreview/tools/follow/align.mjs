// A first draft of marks.json for a recording, so that annotating a
// rehearsal means correcting bar times instead of finding them all by ear.
//
// Deliberately NOT the follower: the marks are the truth the follower is
// measured against, and a draft made by the follower itself would hide
// exactly its own mistakes. This is an offline alignment instead - it sees
// the whole recording at once, may look ahead and needs no causality:
// subsequence DTW (Müller, FMP 7.2) of every sung stretch against the whole
// reference, on CENS with steps (1,1), (2,1), (1,2), which bound the tempo
// to half and double. A stretch is one alignment; a jump inside a stretch
// without a pause is beyond it and shows up as low similarity, which is
// what `check` in the output is for.

import { createTuningState, fold12, similarity, toCens } from '../../src/lib/chroma.js'
import { rotateChroma } from '../../src/lib/globalSearch.js'
import { createLevelGate } from '../../src/lib/listenGates.js'

/**
 * @param {Array<{atMs:number, c36:?Float32Array, levelDb:number}>} frames from replay.mjs featureFrames()
 * @param {import('../../src/lib/followRef.js').FollowReference} reference
 * @param {Array<{measure:number, pass:number, timeMs:number}>} bars from recording.mjs barOccurrences()
 * @param {object} [options]
 * @param {number} [options.windowMs] analysis window; its centre is when a frame was heard
 * @param {number} [options.musicSimilarity] best similarity anywhere in the piece that counts as music
 *   (measured on synthetic cases: singing ≥ 0.86, speech around 0.67)
 * @param {number} [options.mergeGapMs] gaps shorter than this do not split a stretch
 * @param {number} [options.minStretchMs] shorter stretches are dropped
 * @param {number} [options.checkBelow] marks whose bar matched worse than this get `check: true`
 * @param {number} [options.splitBelow] a stretch is cut where the path's similarity
 *   stays below this for longer than `mergeGapMs`
 * @return {{marks: object[], stretches: Array<{fromMs:number, toMs:number, rotation:number, similarity:number}>}}
 */
export function proposeMarks(frames, reference, bars, {
	windowMs = 170,
	musicSimilarity = 0.8,
	mergeGapMs = 1500,
	minStretchMs = 3000,
	checkBelow = 0.75,
	splitBelow = 0.8,
} = {}) {
	if (frames.length === 0) {
		return { marks: [], stretches: [] }
	}
	const censMs = reference.censMs
	const hopMs = frames.length > 1 ? frames[1].atMs - frames[0].atMs : 50
	const tuning = createTuningState()
	const gate = createLevelGate()
	const chroma = frames.map((f) => {
		const music = f.c36 && gate.accept(f.levelDb, f.atMs)
		return music ? fold12(f.c36, tuning).chroma : null
	})
	const live = toCens(chroma, hopMs, { targetMs: censMs })
	const liveMs = (k) => frames[0].atMs - windowMs / 2 + k * censMs
	const rotations = [-1, 0, 1]
	const rotated = rotations.map((r) => live.map((v) => (r ? rotateChroma(v, r) : v)))

	// Pass 1: which CENS frames sound like anything in this piece at all.
	const musical = live.map((_, k) => {
		let best = 0
		for (const set of rotated) {
			best = Math.max(best, bestAnywhere(set[k], reference))
		}
		return best >= musicSimilarity
	})
	const stretches = []
	const gap = Math.round(mergeGapMs / censMs)
	let start = -1
	let lastOn = -Infinity
	for (let k = 0; k <= musical.length; k++) {
		if (k < musical.length && musical[k]) {
			if (start < 0 || k - lastOn > gap) {
				if (start >= 0) {
					stretches.push([start, lastOn])
				}
				start = k
			}
			lastOn = k
		}
	}
	if (start >= 0) {
		stretches.push([start, lastOn])
	}

	// Pass 2: align every stretch, keep the semitone rotation that fits (R8).
	// Speech can pass the first test - CENS is coarse enough that a spoken
	// stretch resembles some place of the piece - but along the alignment
	// path it falls apart; there the stretch is cut and both sides aligned
	// again.
	const marks = []
	const report = []
	const pending = stretches.filter(([from, to]) => (to - from + 1) * censMs >= minStretchMs)
	while (pending.length) {
		const [from, to] = pending.shift()
		let best = null
		for (const [i, rotation] of rotations.entries()) {
			const result = subsequenceDtw(rotated[i].slice(from, to + 1), reference)
			if (!best || result.meanSimilarity > best.meanSimilarity) {
				best = { ...result, rotation }
			}
		}
		const cut = weakestRun(best.path, to - from + 1, { below: splitBelow, minFrames: Math.round(mergeGapMs / censMs) })
		if (cut) {
			const parts = [[from, from + cut[0] - 1], [from + cut[1] + 1, to]]
				.filter(([a, b]) => (b - a + 1) * censMs >= minStretchMs)
			pending.unshift(...parts)
			continue
		}
		const toLive = (n) => liveMs(from + n)
		report.push({ fromMs: toLive(0), toMs: toLive(to - from), rotation: best.rotation, similarity: round(best.meanSimilarity) })
		marks.push(...barMarks(best.path, bars, censMs, toLive, checkBelow))
		marks.push({ type: 'stop', atMs: Math.round(toLive(to - from)) })
	}
	report.sort((a, b) => a.fromMs - b.fromMs)
	const stopsLast = (a, b) => a.atMs - b.atMs || (a.type ? 1 : 0) - (b.type ? 1 : 0)
	marks.sort(stopsLast)
	return { marks, stretches: report }
}

/**
 * The longest run of query frames whose similarity along the path (smoothed
 * over about a second) stays below `below`.
 *
 * @param {Array<{n:number, sim:number}>} path
 * @param {number} length query frames
 * @param {object} options
 * @param {number} options.below
 * @param {number} options.minFrames shorter runs do not count
 * @return {?number[]} [first, last] query frame of the run
 */
function weakestRun(path, length, { below, minFrames }) {
	const sum = new Float64Array(length)
	const count = new Uint16Array(length)
	for (const p of path) {
		sum[p.n] += p.sim
		count[p.n]++
	}
	// A (2,1) step skips a query frame; it has no similarity of its own and
	// must not count as a weak one.
	const smooth = Array.from(sum, (_, n) => {
		let s = 0
		let c = 0
		for (let k = Math.max(0, n - 2); k <= Math.min(length - 1, n + 2); k++) {
			s += sum[k]
			c += count[k]
		}
		return c ? s / c : 1
	})
	let best = null
	let start = -1
	for (let n = 0; n <= length; n++) {
		if (n < length && smooth[n] < below) {
			if (start < 0) {
				start = n
			}
		} else if (start >= 0) {
			if (n - start >= minFrames && (!best || n - start > best[1] - best[0] + 1)) {
				best = [start, n - 1]
			}
			start = -1
		}
	}
	return best
}

function bestAnywhere(v, reference) {
	let best = 0
	for (const cens of reference.cens) {
		for (const r of cens) {
			const s = similarity(v, r)
			if (s > best) {
				best = s
			}
		}
	}
	return best
}

/**
 * Subsequence DTW of a query against the whole reference (best ensemble per
 * cell). Free start and end in the reference, the whole query aligned.
 *
 * @param {Float32Array[]} query live CENS
 * @param {import('../../src/lib/followRef.js').FollowReference} reference
 * @return {{path: Array<{n:number, m:number, sim:number}>, meanSimilarity:number}}
 */
export function subsequenceDtw(query, reference) {
	const N = query.length
	const M = reference.cens[0].length
	const sim = new Float32Array(N * M)
	for (let n = 0; n < N; n++) {
		for (let m = 0; m < M; m++) {
			let best = 0
			for (const cens of reference.cens) {
				const s = similarity(query[n], cens[m])
				if (s > best) {
					best = s
				}
			}
			sim[n * M + m] = best
		}
	}
	const cost = (n, m) => 1 - sim[n * M + m]
	const D = new Float64Array(N * M).fill(Infinity)
	// 0 = start, 1 = (1,1), 2 = (2,1), 3 = (1,2)
	const step = new Uint8Array(N * M)
	for (let m = 0; m < M; m++) {
		D[m] = cost(0, m)
	}
	for (let n = 1; n < N; n++) {
		for (let m = 1; m < M; m++) {
			let best = D[(n - 1) * M + m - 1]
			let choice = 1
			if (n >= 2 && D[(n - 2) * M + m - 1] < best) {
				best = D[(n - 2) * M + m - 1]
				choice = 2
			}
			if (m >= 2 && D[(n - 1) * M + m - 2] < best) {
				best = D[(n - 1) * M + m - 2]
				choice = 3
			}
			if (best < Infinity) {
				D[n * M + m] = cost(n, m) + best
				step[n * M + m] = choice
			}
		}
	}
	let end = 0
	for (let m = 1; m < M; m++) {
		if (D[(N - 1) * M + m] < D[(N - 1) * M + end]) {
			end = m
		}
	}
	const path = []
	let n = N - 1
	let m = end
	for (;;) {
		path.push({ n, m, sim: sim[n * M + m] })
		const choice = n === 0 ? 0 : step[n * M + m]
		if (choice === 0) {
			break
		}
		n -= choice === 2 ? 2 : 1
		m -= choice === 3 ? 2 : 1
	}
	path.reverse()
	const meanSimilarity = path.reduce((sum, p) => sum + p.sim, 0) / path.length
	return { path, meanSimilarity }
}

/**
 * Bar marks along an alignment path: when the path passes each bar start.
 *
 * @param {Array<{n:number, m:number, sim:number}>} path
 * @param {Array<{measure:number, pass:number, timeMs:number}>} bars
 * @param {number} censMs
 * @param {(n: number) => number} toLive query frame → recording time
 * @param {number} checkBelow
 * @return {object[]}
 */
function barMarks(path, bars, censMs, toLive, checkBelow) {
	const fromScore = path[0].m * censMs
	const toScore = path[path.length - 1].m * censMs
	const passes = new Map()
	for (const b of bars) {
		passes.set(b.measure, Math.max(passes.get(b.measure) ?? 0, b.pass))
	}
	// The smoothing of CENS lets a path start up to half a second after the
	// bar the singers began with; that bar still belongs to the stretch.
	const leadInMs = 600
	const inside = bars.filter((b) => b.timeMs >= fromScore - leadInMs && b.timeMs <= toScore)
	const marks = []
	let i = 0
	for (const [index, bar] of inside.entries()) {
		const target = bar.timeMs / censMs
		while (i + 1 < path.length && path[i + 1].m < target) {
			i++
		}
		const a = path[i]
		const b = path[Math.min(i + 1, path.length - 1)]
		const t = b.m > a.m ? (target - a.m) / (b.m - a.m) : 0
		// Before the path: back from its start at the score's own tempo.
		const atMs = target < a.m ? toLive(a.n) - (a.m - target) * censMs : toLive(a.n + t * (b.n - a.n))
		const nextTime = inside[index + 1]?.timeMs ?? toScore
		const within = path.filter((p) => p.m * censMs >= bar.timeMs && p.m * censMs < nextTime)
		const barSim = within.length ? within.reduce((s, p) => s + p.sim, 0) / within.length : a.sim
		const mark = { measure: bar.measure, atMs: Math.max(0, Math.round(atMs)) }
		if (passes.get(bar.measure) > 1) {
			mark.pass = bar.pass
		}
		mark.sim = round(barSim)
		if (barSim < checkBelow) {
			mark.check = true
		}
		marks.push(mark)
	}
	return marks
}

function round(v) {
	return Math.round(v * 100) / 100
}
