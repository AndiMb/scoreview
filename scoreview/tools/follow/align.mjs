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

/**
 * Parse a plan: what was sung, in order, as the annotator heard it.
 *
 *   "46-60"              bars 46 to 60, first occurrences
 *   "1/2-8/2"            the second time through bars 1 to 8 (verse 2)
 *   "13-15x3"            three times
 *   "34-35*"             several times, how often is found by alignment
 *   "1-15; 1/2-8/2"      stretches separated by ';' (a pause or a restart in between)
 *   "1/3-end"            to the end of the piece
 *
 * A bar without a pass starts at its first occurrence; the end bar of a
 * range is its first occurrence at or after the start.
 *
 * @param {string} text
 * @param {Array<{measure:number, pass:number, timeMs:number}>} bars from recording.mjs barOccurrences()
 * @return {Array<{from:number, to:number, times:number|'*', label:string}>} occurrence indices into `bars`, inclusive
 */
export function parsePlan(text, bars) {
	const find = (ref, after) => {
		if (ref === 'end') {
			return bars.length - 1
		}
		const [measure, pass] = ref.split('/').map(Number)
		const i = bars.findIndex((b, k) => k >= after && b.measure === measure && (!pass || b.pass === pass))
		if (i < 0 || !Number.isFinite(measure)) {
			throw new Error(`bar ${ref} not found in the score`)
		}
		return i
	}
	return text.split(';').map((s) => s.trim()).filter(Boolean).map((label) => {
		const m = /^([\d/]+|end)(?:-([\d/]+|end))?(?:x(\d+)|(\*))?$/.exec(label.replace(/\s+/g, ''))
		if (!m) {
			throw new Error(`cannot read plan stretch "${label}"`)
		}
		const from = find(m[1], 0)
		const to = m[2] ? find(m[2], from) : from
		return { from, to, times: m[4] ? '*' : Number(m[3] ?? 1), label }
	})
}

/**
 * Marks for a recording whose content the annotator already knows (a plan
 * from parsePlan): the sung stretches are not searched in the whole piece
 * but laid along the recording in the given order. DTW with the score
 * stretches as the fully aligned side and free start and end in the
 * recording; between stretches a gap absorbs speech and pauses, inside a
 * stretch a "hold" step lets the score wait while the recording runs on
 * (a fermata, a stop in mid-phrase). Holds longer than `minPauseMs` become
 * stops, so the replay does not count a rehearsal break as following time.
 *
 * Still a draft: the plan fixes which bars, the alignment only when.
 *
 * @param {Array<{atMs:number, c36:?Float32Array, levelDb:number}>} frames from replay.mjs featureFrames()
 * @param {import('../../src/lib/followRef.js').FollowReference} reference
 * @param {Array<{measure:number, pass:number, timeMs:number}>} bars from recording.mjs barOccurrences()
 * @param {ReturnType<typeof parsePlan>} plan
 * @param {object} [options]
 * @param {number} [options.windowMs] analysis window; its centre is when a frame was heard
 * @param {number} [options.durationMs] end of the piece in score time
 * @param {number} [options.musicSimilarity] as in proposeMarks
 * @param {number} [options.holdCost] cost of one hold step inside a stretch
 * @param {number} [options.gapCost] cost of a gap frame that does not sound like the piece
 * @param {number} [options.gapMusicCost] cost of a gap frame that does - singing left out of the plan
 * @param {number} [options.minPauseMs] a hold at least this long is a stop
 * @param {number} [options.checkBelow] as in proposeMarks
 * @param {number} [options.maxTimes] most repeats tried for a '*' stretch
 * @return {{marks: object[], rotation:number, similarity:number, times:number[]}}
 */
export function alignPlan(frames, reference, bars, plan, {
	windowMs = 170,
	durationMs = Infinity,
	musicSimilarity = 0.8,
	holdCost = 0.3,
	gapCost = 0.1,
	gapMusicCost = 0.6,
	minPauseMs = 2000,
	checkBelow = 0.75,
	maxTimes = 8,
} = {}) {
	const censMs = reference.censMs
	const hopMs = frames.length > 1 ? frames[1].atMs - frames[0].atMs : 50
	const tuning = createTuningState()
	const gate = createLevelGate()
	const chroma = frames.map((f) => {
		const music = f.c36 && gate.accept(f.levelDb, f.atMs)
		return music ? fold12(f.c36, tuning).chroma : null
	})
	const live = toCens(chroma, hopMs, { targetMs: censMs })
	const toLive = (l) => frames[0].atMs - windowMs / 2 + l * censMs
	const M = reference.cens[0].length
	const endOf = (k) => Math.min(M, Math.round(Math.min(bars[k + 1]?.timeMs ?? durationMs, durationMs) / censMs))

	let best = null
	for (const rotation of [-1, 0, 1]) {
		const query = rotation ? live.map((v) => rotateChroma(v, rotation)) : live
		const musical = query.map((v) => bestAnywhere(v, reference) >= musicSimilarity)
		// Repeat counts for '*' stretches: each one tried on its own with the
		// others at one, then all at their best - enough for a plan with one or
		// two of them, which is what annotating by ear produces.
		const counts = plan.map((s) => (s.times === '*' ? 1 : s.times))
		const run = () => alignItems(query, musical, reference, planItems(plan, counts, bars, endOf, censMs), { holdCost, gapCost, gapMusicCost })
		let result = run()
		for (const [i, s] of plan.entries()) {
			if (s.times !== '*') {
				continue
			}
			let bestCount = counts[i]
			for (let n = 2; n <= maxTimes; n++) {
				counts[i] = n
				const r = run()
				if (r.score < result.score) {
					result = r
					bestCount = n
				}
			}
			counts[i] = bestCount
		}
		result = run()
		if (!best || result.similarity > best.similarity) {
			best = { ...result, rotation, times: [...counts] }
		}
	}

	const marks = []
	const minHold = Math.round(minPauseMs / censMs)
	const { path, items } = best
	let p = 0
	let passed = path[0].i - 1
	while (p < path.length) {
		const item = items[path[p].i]
		// Bar starts reached by the path: first point at or past their frame.
		// A (2,1) step can skip the very frame a bar opens with.
		const opened = []
		for (let i = passed + 1; i <= path[p].i; i++) {
			if (items[i].bar !== undefined) {
				opened.push(items[i])
			}
		}
		passed = Math.max(passed, path[p].i)
		if (item.gap) {
			// Entering the gap ends the stretch - also when a (2,1) step left
			// out its last frame, or a repeat followed without a pause.
			if (marks.at(-1)?.type !== 'stop') {
				marks.push({ type: 'stop', atMs: Math.round(toLive(path[p].l)) })
			}
			p++
			continue
		}
		for (const barItem of opened) {
			const bar = bars[barItem.bar]
			const within = path.filter((q) => items[q.i].copy === barItem.copy && (items[q.i].bar === barItem.bar || items[q.i].inBar === barItem.bar))
			const barSim = within.length ? within.reduce((s, q) => s + q.sim, 0) / within.length : path[p].sim
			const mark = { measure: bar.measure, atMs: Math.max(0, Math.round(toLive(path[p].l))) }
			if (bars.some((b) => b.measure === bar.measure && b.pass > 1)) {
				mark.pass = bar.pass
			}
			mark.sim = round(barSim)
			if (barSim < checkBelow) {
				mark.check = true
			}
			marks.push(mark)
		}
		// A long hold is a stop; the run resumes at the next bar mark.
		let q = p
		while (q + 1 < path.length && path[q + 1].i === path[p].i) {
			q++
		}
		if (q - p >= minHold || item.last) {
			marks.push({ type: 'stop', atMs: Math.round(toLive(path[p].l + 1)) })
		}
		p = q + 1
	}
	if (marks.at(-1)?.type !== 'stop') {
		marks.push({ type: 'stop', atMs: Math.round(toLive(path.at(-1).l + 1)) })
	}
	return { marks: dropOrphanStops(marks), rotation: best.rotation, similarity: round(best.similarity), times: best.times }
}

/**
 * Two stops in a row: the second says nothing the replay needs.
 *
 * @param {object[]} marks
 * @return {object[]}
 */
function dropOrphanStops(marks) {
	return marks.filter((m, k) => !(m.type === 'stop' && marks[k - 1]?.type === 'stop'))
}

/**
 * The score side of alignPlan: one item per CENS frame of every stretch,
 * a gap item between stretches. Items that open a bar carry its occurrence
 * index; `last` marks the final frame of a stretch.
 *
 * @param {ReturnType<typeof parsePlan>} plan
 * @param {number[]} counts how often each stretch was sung
 * @param {Array<{measure:number, pass:number, timeMs:number}>} bars
 * @param {(k: number) => number} endOf CENS frame after occurrence k
 * @param {number} censMs
 * @return {object[]}
 */
function planItems(plan, counts, bars, endOf, censMs) {
	const items = []
	let copy = 0
	for (const [i, s] of plan.entries()) {
		for (let n = 0; n < counts[i]; n++) {
			if (items.length) {
				items.push({ gap: true })
			}
			copy++
			const fromM = Math.round(bars[s.from].timeMs / censMs)
			const toM = endOf(s.to)
			let k = s.from
			for (let m = fromM; m < toM; m++) {
				const item = { m, copy }
				while (k + 1 <= s.to && Math.round(bars[k + 1].timeMs / censMs) <= m) {
					k++
				}
				if (m === Math.round(bars[k].timeMs / censMs) && (k === s.from || m > fromM)) {
					item.bar = k
				} else {
					item.inBar = k
				}
				items.push(item)
			}
			if (items.length && !items[items.length - 1].gap) {
				items[items.length - 1].last = true
			}
		}
	}
	return items
}

/**
 * DTW of plan items (fully aligned) against the recording (free start and
 * end). Steps: (1,1), (2,1) and (1,2) bound the tempo to half and double as
 * in subsequenceDtw; (0,1) holds an item while the recording runs on.
 * `score` adds the musical recording frames the path leaves out, so that a
 * repeat count which explains more of the singing wins.
 *
 * @param {Float32Array[]} query live CENS
 * @param {boolean[]} musical per live frame: sounds like the piece at all
 * @param {import('../../src/lib/followRef.js').FollowReference} reference
 * @param {object[]} items from planItems
 * @param {object} costs
 * @param {number} costs.holdCost
 * @param {number} costs.gapCost
 * @param {number} costs.gapMusicCost
 * @return {{path: Array<{i:number, l:number, sim:number}>, items: object[], similarity: number, score: number}}
 */
function alignItems(query, musical, reference, items, { holdCost, gapCost, gapMusicCost }) {
	const Q = items.length
	const L = query.length
	const simAt = (i, l) => {
		const item = items[i]
		if (item.gap) {
			return null
		}
		let best = 0
		for (const cens of reference.cens) {
			const s = similarity(query[l], cens[item.m])
			if (s > best) {
				best = s
			}
		}
		return best
	}
	const sim = new Float32Array(Q * L)
	const cost = new Float32Array(Q * L)
	for (let i = 0; i < Q; i++) {
		for (let l = 0; l < L; l++) {
			const s = simAt(i, l)
			sim[i * L + l] = s ?? 0
			cost[i * L + l] = s === null ? (musical[l] ? gapMusicCost : gapCost) : 1 - s
		}
	}
	const D = new Float64Array(Q * L).fill(Infinity)
	// 0 = start, 1 = (1,1), 2 = (2,1) skips an item, 3 = (1,2), 4 = hold
	const step = new Uint8Array(Q * L)
	for (let l = 0; l < L; l++) {
		D[l] = cost[l]
	}
	for (let i = 0; i < Q; i++) {
		for (let l = 1; l < L; l++) {
			const c = cost[i * L + l]
			let best = D[i * L + l]
			let choice = 0
			if (i >= 1 && D[(i - 1) * L + l - 1] + c < best) {
				best = D[(i - 1) * L + l - 1] + c
				choice = 1
			}
			// The tempo steps pay for the cell they pass over as well: unweighted,
			// a path that races through the score at double tempo costs half and
			// wins against the true one.
			// Never skip over a gap: it is where a stop is read off.
			if (i >= 2 && !items[i - 1].gap) {
				const d = D[(i - 2) * L + l - 1] + c + cost[(i - 1) * L + l]
				if (d < best) {
					best = d
					choice = 2
				}
			}
			if (i >= 1 && l >= 2) {
				const d = D[(i - 1) * L + l - 2] + c + cost[i * L + l - 1]
				if (d < best) {
					best = d
					choice = 3
				}
			}
			const hold = items[i].gap ? c : holdCost
			if (D[i * L + l - 1] + hold < best) {
				best = D[i * L + l - 1] + hold
				choice = 4
			}
			D[i * L + l] = best
			step[i * L + l] = choice
		}
	}
	let end = 0
	for (let l = 1; l < L; l++) {
		if (D[(Q - 1) * L + l] < D[(Q - 1) * L + end]) {
			end = l
		}
	}
	const path = []
	let i = Q - 1
	let l = end
	for (;;) {
		path.push({ i, l, sim: sim[i * L + l] })
		const choice = step[i * L + l]
		if (choice === 0) {
			break
		}
		i -= choice === 2 ? 2 : choice === 4 ? 0 : 1
		l -= choice === 3 ? 2 : 1
	}
	path.reverse()
	const sung = path.filter((q) => !items[q.i].gap)
	const similarityMean = sung.reduce((s, q) => s + q.sim, 0) / sung.length
	let left = 0
	for (let k = 0; k < L; k++) {
		if (musical[k] && (k < path[0].l || k > path[path.length - 1].l)) {
			left++
		}
	}
	return { path, items, similarity: similarityMean, score: D[(Q - 1) * L + end] + gapMusicCost * left }
}

function round(v) {
	return Math.round(v * 100) / 100
}
