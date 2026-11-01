// PARKED - part of the microphone score follower (automatic page turning),
// which is paused; no viewer code imports it. Kept and tested because
// tools/follow/replay.mjs measures it against recorded rehearsals, and the
// work resumes from here. The switch `feature_score_follower` exists but
// turns nothing on (docs/installation.md).
//
// When the microphone follower turns - pure, no DOM.
//
// The view shows `visible` consecutive rows (systems; a page is the same
// with more rows). The music one second ahead must be on screen together
// with the place being sung (F18, A4 ≥ 1 s). So the view moves once the row
// one second ahead is no longer shown - early at a fast tempo, late at a
// slow one: a time rule instead of the fixed "halfway into the last system"
// of the page-turning literature.
//
// Safety for A2 = 0: only the CONFIRMED place counts (lib/followerTime.js),
// never the coasting display time; only while following; and only with
// evidence - most of the last second must have matched. Measured on
// synthetic speech: single speech frames match the score by chance (14 %),
// in runs of up to five taps, and moved the confirmed place by ±200 ms.
// Backwards only after a jump: the follower never turns back on its own
// unless the place itself jumped there.

/**
 * Row containing a score time.
 *
 * @param {Array<{fromMs:number, toMs:number}>} rows
 * @param {number} ms
 * @return {number} index, clamped to the rows
 */
export function rowAt(rows, ms) {
	for (let i = 0; i < rows.length; i++) {
		if (ms < rows[i].toMs) {
			return i
		}
	}
	return rows.length - 1
}

/**
 * @param {object} input
 * @param {number} input.first first row shown now
 * @param {number} input.visible how many rows fit
 * @param {Array<{fromMs:number, toMs:number}>} input.rows
 * @param {?object} input.state FollowerState from lib/scoreFollower.js
 * @param {number} [input.leadMs] how far ahead must be visible
 * @param {number} [input.minEvidence] share of matched taps in the last second
 * @return {?number} the new first row, or null to stay
 */
export function decideTurn({ first, visible, rows, state, leadMs = 1500, minEvidence = 0.6 }) {
	if (!state || state.confirmedMs === null || rows.length === 0) {
		return null
	}
	const here = rowAt(rows, state.confirmedMs)
	const last = first + Math.max(1, visible) - 1
	if (state.jumped && (here < first || here > last)) {
		// A jump puts the place at the top - the rows before it do not matter.
		return Math.min(here, Math.max(0, rows.length - visible))
	}
	if (state.phase !== 'following' || state.evidence < minEvidence) {
		return null
	}
	const ahead = rowAt(rows, state.confirmedMs + leadMs * state.tempoRatio)
	if (ahead <= last) {
		return null
	}
	// Show the row ahead as the last one, but never push the sung row out.
	const next = Math.min(here, ahead - Math.max(1, visible) + 1)
	return next > first ? next : null
}
