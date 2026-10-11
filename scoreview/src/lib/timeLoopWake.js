/**
 * When the viewer's single time loop (useScoreSession.js) may sleep.
 *
 * The loop used to run every frame for as long as the viewer was open - on a
 * tablet showing a paused score through a whole rehearsal that is 60 wakeups
 * a second for nothing (measured: 60 rAF/s and ~22 ms CPU per second with an
 * unchanged page). It now runs only while there is a reason:
 *
 * - **playing**: the cursor moves.
 * - **following**: the display hangs on the leader's extrapolated time
 *   ("Folgt mir", usePlayback.followTime) - it moves without own playback.
 * - **a settle window after every wake**: the clock announces play, pause,
 *   seek and tempo changes (`wake` event on player.js/silentClock.js). The
 *   window exists because a seek in the spessasynth sequencer does not take
 *   effect synchronously - the time read right after it is still the old one,
 *   and only a few frames later (or with `timechange`) the new one arrives.
 *   Without the window the cursor would stay at the old position after a
 *   jump while stopped.
 *
 * The end of a piece needs no special case: the sequencer pauses itself, the
 * next step sees `playing === false`, writes the final state, and the loop
 * runs out with the window.
 */

/** Long enough for an asynchronous seek; short enough to be invisible in the battery. */
export const SETTLE_MS = 1000

/**
 * @param {number} [settleMs]
 * @return {{wake: (nowMs: number) => void, shouldRun: (state: {playing: boolean, following: boolean, nowMs: number}) => boolean}}
 */
export function createWakeWindow(settleMs = SETTLE_MS) {
	let until = -Infinity
	return {
		wake(nowMs) {
			until = Math.max(until, nowMs + settleMs)
		},
		shouldRun({ playing, following, nowMs }) {
			return Boolean(playing) || Boolean(following) || nowMs < until
		},
	}
}
