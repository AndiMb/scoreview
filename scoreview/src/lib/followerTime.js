// The follower's two times - pure, no DOM, no AudioContext.
//
// - **confirmed**: the last place the sound actually matched. Only this one
//   may turn a page or count as a jump (A2 = 0: never turn on a guess).
// - **shown**: what the cursor displays - confirmed plus the time since,
//   at the measured tempo, pulled smoothly towards each new confirmation.
//   Without the second time the cursor would tick at 20 Hz in steps of
//   50 ms against a 60 Hz display.
//
// In a pause the shown time runs on at most `coastMs` (fermatas and general
// pauses are music) and then stands. A real jump moves it at once.

/**
 * @param {object} [options]
 * @param {number} [options.coastMs] how far to run on without confirmation
 * @param {number} [options.jumpMs] a correction larger than this is shown at once
 * @param {number} [options.pullPerSecond] share of the gap closed per second
 * @return {object}
 */
export function createFollowerTime({ coastMs = 1500, jumpMs = 400, pullPerSecond = 4 } = {}) {
	let confirmedMs = null
	let confirmedAt = null
	let tempo = 1
	let shown = null
	let shownAt = null

	/**
	 * A new confirmation from the follower.
	 *
	 * @param {number} scoreMs confirmed place
	 * @param {number} atMs when (performance/wall time)
	 * @param {number} tempoRatio performance tempo relative to the score
	 */
	function confirm(scoreMs, atMs, tempoRatio) {
		confirmedMs = scoreMs
		confirmedAt = atMs
		tempo = tempoRatio
	}

	/** Forget everything - the next confirmation is shown at once. */
	function reset() {
		confirmedMs = null
		confirmedAt = null
		shown = null
		shownAt = null
	}

	/**
	 * Where the shown time should be at `nowMs`, without smoothing.
	 *
	 * @param {number} nowMs
	 * @return {?number}
	 */
	function target(nowMs) {
		if (confirmedMs === null) {
			return null
		}
		const since = Math.min(Math.max(0, nowMs - confirmedAt), coastMs)
		return confirmedMs + since * tempo
	}

	/**
	 * The shown time at `nowMs`; call once per display frame.
	 *
	 * @param {number} nowMs
	 * @return {?number}
	 */
	function shownMs(nowMs) {
		const goal = target(nowMs)
		if (goal === null) {
			return null
		}
		if (shown === null || Math.abs(goal - shown) > jumpMs) {
			shown = goal
		} else {
			const dt = Math.max(0, nowMs - shownAt) / 1000
			// Advance with the music, then close part of the remaining gap.
			const advanced = shown + dt * 1000 * (nowMs - confirmedAt < coastMs ? tempo : 0)
			const share = Math.min(1, dt * pullPerSecond)
			shown = advanced + (goal - advanced) * share
		}
		shownAt = nowMs
		return shown
	}

	return { confirm, reset, shownMs, confirmedMs: () => confirmedMs, target }
}
