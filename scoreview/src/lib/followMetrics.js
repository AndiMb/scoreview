// PARKED - part of the microphone score follower (automatic page turning),
// which is paused; no viewer code imports it. Kept and tested because
// tools/follow/replay.mjs measures it against recorded rehearsals, and the
// work resumes from here. The switch `feature_score_follower` exists but
// turns nothing on (docs/installation.md).
//
// Acceptance figures of the microphone follower, computed from a replay -
// pure, so they run the same in `npm test` (synthetic cases) and in
// tools/follow-replay.mjs (recorded rehearsals).
//
// The names follow the acceptance criteria of the follower plan: A1 share
// within ±1 bar, A2 wrong jumps and wrong turns, A3 time to find the place
// again, A4 lead of a turn, A6 turns while nobody sings, A9 punctual turns.
// "Turn" means the shown section (page, row, band window) changes; the
// replay passes in which section was shown at each frame.

/**
 * @typedef {object} ReplayFrame
 * @property {number} atMs performance time
 * @property {?number} truthMs where the music really is (score time), null while nobody sings
 * @property {?number} shownMs where the follower shows it (display time), null if it shows nothing
 * @property {boolean} [jumped] the follower jumped in this frame
 * @property {?number} [confirmedMs] the follower's confirmed position after the frame
 * @property {?number} [slice] index of the section shown after this frame
 */

/**
 * Index of the bar containing `ms` (binary search over bar starts).
 *
 * @param {number[]} measureStartsMs sorted
 * @param {number} ms
 * @return {number}
 */
export function measureAt(measureStartsMs, ms) {
	let lo = 0
	let hi = measureStartsMs.length - 1
	if (hi < 0 || ms < measureStartsMs[0]) {
		return 0
	}
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1
		if (measureStartsMs[mid] <= ms) {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	return lo
}

/**
 * @param {ReplayFrame[]} frames in time order
 * @param {object} context
 * @param {number[]} context.measureStartsMs
 * @param {Array<{fromMs:number, toMs:number}>} [context.slices] score time covered by each section
 * @param {number} [context.leadMs] required lead for a turn (A4)
 * @param {number} [context.visibleRows] sections on screen at once; `slice`
 *   of a frame is the first of them
 * @return {object}
 */
export function followMetrics(frames, { measureStartsMs, slices = null, leadMs = 1000, visibleRows = 1 }) {
	const bar = (ms) => measureAt(measureStartsMs, ms)
	const sung = frames.filter((f) => f.truthMs !== null)
	const errors = []
	let within = 0
	for (const f of sung) {
		if (f.shownMs !== null && Math.abs(bar(f.shownMs) - bar(f.truthMs)) <= 1) {
			within++
		}
		errors.push(f.shownMs === null ? Infinity : Math.abs(f.shownMs - f.truthMs))
	}
	const result = {
		frames: frames.length,
		sungFrames: sung.length,
		a1WithinOneBar: sung.length ? within / sung.length : null,
		errorMs: summary(errors),
		a2WrongJumps: wrongJumps(frames, bar),
		a3Refind: refindTimes(frames, bar),
	}
	// Turn figures only if the replay says which section was shown -
	// without a turn policy there is nothing to judge.
	if (slices && frames.some((f) => f.slice !== undefined && f.slice !== null)) {
		Object.assign(result, turnFigures(frames, slices, leadMs, visibleRows))
	}
	return result
}

/**
 * Jumps of the follower that land more than one bar away from the truth -
 * judged one second later, so a jump that lands slightly early on a
 * restart counts as right. A jump while nobody sings is always wrong.
 *
 * @param {ReplayFrame[]} frames
 * @param {(ms: number) => number} bar
 * @return {number}
 */
function wrongJumps(frames, bar) {
	let wrong = 0
	for (let i = 0; i < frames.length; i++) {
		const f = frames[i]
		if (!f.jumped) {
			continue
		}
		const later = frames.find((g) => g.atMs >= f.atMs + 1000) ?? frames[frames.length - 1]
		if (later.truthMs === null || later.confirmedMs === null || later.confirmedMs === undefined
			|| Math.abs(bar(later.confirmedMs) - bar(later.truthMs)) > 1) {
			wrong++
		}
	}
	return wrong
}

/**
 * For each jump in the truth (a discontinuity of more than one bar): how
 * long until the shown position is within one bar and stays there for a
 * second, in seconds and in bars sung meanwhile.
 *
 * @param {ReplayFrame[]} frames
 * @param {(ms: number) => number} bar
 * @return {Array<{seconds:number, bars:number}>}
 */
function refindTimes(frames, bar) {
	const results = []
	let previous = null
	for (let i = 0; i < frames.length; i++) {
		const f = frames[i]
		if (f.truthMs === null) {
			continue
		}
		if (previous !== null && Math.abs(bar(f.truthMs) - bar(previous)) > 1) {
			results.push(refindFrom(frames, i, bar))
		}
		previous = f.truthMs
	}
	return results
}

function refindFrom(frames, start, bar) {
	const startMs = frames[start].atMs
	const startBar = bar(frames[start].truthMs)
	let okSince = null
	for (let i = start; i < frames.length; i++) {
		const f = frames[i]
		if (f.truthMs === null) {
			continue
		}
		const ok = f.shownMs !== null && Math.abs(bar(f.shownMs) - bar(f.truthMs)) <= 1
		if (ok && okSince === null) {
			okSince = i
		} else if (!ok) {
			okSince = null
		}
		if (okSince !== null && f.atMs - frames[okSince].atMs >= 1000) {
			const at = frames[okSince]
			return { seconds: (at.atMs - startMs) / 1000, bars: bar(at.truthMs) - startBar }
		}
	}
	return { seconds: Infinity, bars: Infinity }
}

/**
 * Turn figures: A9 share of sections that were on screen before their first
 * sung note, A4 lead of those, A6 turns while nobody sang, and wrong turns -
 * to a view that holds none of the next two seconds of music.
 *
 * @param {ReplayFrame[]} frames
 * @param {Array<{fromMs:number, toMs:number}>} slices
 * @param {number} leadMs
 * @param {number} visible sections on screen at once
 * @return {object}
 */
function turnFigures(frames, slices, leadMs, visible) {
	const sliceOf = (ms) => slices.findIndex((s) => ms >= s.fromMs && ms < s.toMs)
	const shows = (first, s) => first !== null && first !== undefined && s >= first && s < first + visible
	let turnsWhileSilent = 0
	let wrongTurns = 0
	let turns = 0
	let shown = null
	for (let i = 0; i < frames.length; i++) {
		const f = frames[i]
		if (f.slice === undefined || f.slice === null || f.slice === shown) {
			continue
		}
		if (shown !== null) {
			turns++
			if (f.truthMs === null) {
				turnsWhileSilent++
			}
			const ahead = frames.filter((g) => g.atMs >= f.atMs && g.atMs <= f.atMs + 2000 && g.truthMs !== null)
			if (ahead.length > 0 && !ahead.some((g) => shows(f.slice, sliceOf(g.truthMs)))) {
				wrongTurns++
			}
		}
		shown = f.slice
	}
	// Each section the music entered while singing: was it on screen?
	const entries = []
	let current = null
	for (const f of frames) {
		if (f.truthMs === null) {
			continue
		}
		const s = sliceOf(f.truthMs)
		if (s !== current) {
			if (current !== null) {
				entries.push({ slice: s, atMs: f.atMs, onScreen: shows(f.slice, s) })
			}
			current = s
		}
	}
	const punctual = entries.filter((e) => e.onScreen)
	const leads = []
	for (const e of punctual) {
		const since = visibleSince(frames, e.slice, e.atMs, shows)
		if (since !== null) {
			leads.push(e.atMs - since)
		}
	}
	return {
		turns,
		a2WrongTurns: wrongTurns,
		a6TurnsWhileSilent: turnsWhileSilent,
		a9Punctual: entries.length ? punctual.length / entries.length : null,
		a4LeadMs: summary(leads),
		leadShortfalls: leads.filter((l) => l < leadMs).length,
	}
}

/**
 * Since when section `slice` has been on screen without a break, before `beforeMs`.
 *
 * @param {ReplayFrame[]} frames
 * @param {number} slice
 * @param {number} beforeMs
 * @param {(first: ?number, s: number) => boolean} shows
 * @return {?number}
 */
function visibleSince(frames, slice, beforeMs, shows) {
	let since = null
	for (const f of frames) {
		if (f.atMs > beforeMs) {
			break
		}
		if (shows(f.slice, slice)) {
			since ??= f.atMs
		} else {
			since = null
		}
	}
	return since
}

/**
 * @param {number[]} values
 * @return {?{median:number, p95:number, max:number, mean:number}}
 */
export function summary(values) {
	if (values.length === 0) {
		return null
	}
	const sorted = [...values].sort((a, b) => a - b)
	const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
	const finite = sorted.filter(Number.isFinite)
	return {
		median: pick(0.5),
		p95: pick(0.95),
		max: sorted[sorted.length - 1],
		mean: finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : Infinity,
	}
}
