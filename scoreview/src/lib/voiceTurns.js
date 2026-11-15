// When the follower moves on to the next system, by the singer's own part -
// pure, no DOM.
//
// The display hangs on one time (usePlayback.followTime): cursor, scrolling
// and the system band move to the next system when that time reaches it.
// Running a fixed lead ahead (lib/followerTime.js) is the right thing while
// the own part sings across the boundary - the singer reads the notes being
// sung. But where the own part rests before the boundary, the next system is
// what the singer needs: the next entry is there, and the rest is counted,
// not read. So in such a rest the time is moved to the start of the next
// system, as soon as the own last note has ended and the singer has let go
// of it - but not more than `maxEarlyMs` ahead: in a long rest the others
// sing on, and the singer follows them on the old system to count. Which
// part is the singer's comes from the warp (lib/onlineWarp.js), from the
// voice it hears.

/**
 * Where to snap ahead: per system boundary with a rest of the own part
 * before it, the score times from which the display shows the next system.
 *
 * @param {Float32Array} line the own part per reference frame, NaN where it rests (lib/voicePitch.js partLine)
 * @param {number} frameMs spacing of `line`
 * @param {number[]} systemStartsMs start of each system in score time, ascending
 * @param {object} [options]
 * @param {number} [options.releaseMs] after the last note ends, before the turn
 * @param {number} [options.maxEarlyMs] never earlier than this before the boundary
 * @param {number} [options.minGainMs] windows shorter than this change nothing worth a jump
 * @return {Array<{fromMs:number, toMs:number}>} ascending, toMs = the next system's start
 */
export function voiceTurnWindows(line, frameMs, systemStartsMs, { releaseMs = 300, maxEarlyMs = 3000, minGainMs = 600 } = {}) {
	const windows = []
	for (const boundary of systemStartsMs.slice(1)) {
		const j = Math.min(line.length, Math.floor(boundary / frameMs))
		if (j <= 0 || Number.isFinite(line[j - 1])) {
			// Sung across the boundary: the lead alone decides.
			continue
		}
		let k = j - 1
		while (k >= 0 && !Number.isFinite(line[k])) {
			k--
		}
		const lastEnd = k < 0 ? 0 : (k + 1) * frameMs
		const from = Math.max(lastEnd + releaseMs, boundary - maxEarlyMs)
		if (boundary - from >= minGainMs) {
			windows.push({ fromMs: from, toMs: boundary })
		}
	}
	return windows
}

/**
 * The time to show: the start of the next system inside a turn window, the
 * time itself elsewhere.
 *
 * @param {Array<{fromMs:number, toMs:number}>} windows voiceTurnWindows()
 * @param {number} ms
 * @return {number}
 */
export function snapToTurn(windows, ms) {
	let lo = 0
	let hi = windows.length - 1
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		if (ms < windows[mid].fromMs) {
			hi = mid - 1
		} else if (ms >= windows[mid].toMs) {
			lo = mid + 1
		} else {
			return windows[mid].toMs
		}
	}
	return ms
}
