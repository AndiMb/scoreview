/**
 * How often a viewer asks the server about "Folgt mir" (E10) - by role.
 *
 * Every poll wakes the radio (on LTE/5G it then stays in a high power state
 * for several seconds) and costs the server ~50 ms CPU. The full rate
 * `pollMs` (800 ms by default, FeatureConfig) is reserved for the one case
 * that needs it: a device that FOLLOWS a leader without push. There a jump of
 * the leader has to arrive like a jump (measured p95 under 1 s) - that is the
 * point of the feature, so this rate is deliberately not stretched, not even
 * while the leader stands still: standing still is exactly when the leader
 * says "from B".
 *
 * Everyone else polls slowly, because nothing they need is urgent:
 *
 * - **the leader's own device** learns the session state from the answers to
 *   its own changes (PATCH); polling only catches a second leader device.
 *   Measured before: ~70 polls a minute while standing still.
 * - **a detached device** ("following" off) only has to notice that the
 *   session ended or moved; returning to the leader polls at once.
 * - **without a session** the poll only discovers a start. Push does not help
 *   here: the server pushes only to devices that joined a running session
 *   (FollowService::members). Fast for a while after the viewer was opened,
 *   became visible or was used - that is when a rehearsal starts -, then slow.
 */

/** Without a session, in the background, next to push. */
export const IDLE_POLL_MS = 15000

/** The leader's own device: catches a second leader device within seconds. */
export const LEADER_POLL_MS = 5000

/** Without a session, once nobody has touched the viewer for a while. */
export const DISCOVERY_SLOW_POLL_MS = 60000

/** How long after opening, becoming visible or an interaction discovery stays at IDLE_POLL_MS. */
export const DISCOVERY_FAST_WINDOW_MS = 120000

/**
 * @param {object} s
 * @param {boolean} s.visible
 * @param {boolean} s.active a session runs
 * @param {boolean} s.mine this account leads it
 * @param {boolean} s.following this device follows (not detached)
 * @param {boolean} s.push joined to push and connected
 * @param {number} s.pollMs full rate from the server
 * @param {number} s.sinceAttentionMs time since opening, becoming visible or the last interaction
 * @return {number} delay until the next poll in ms
 */
export function followPollDelay({ visible, active, mine, following, push, pollMs, sinceAttentionMs }) {
	if (!active) {
		return sinceAttentionMs < DISCOVERY_FAST_WINDOW_MS ? IDLE_POLL_MS : DISCOVERY_SLOW_POLL_MS
	}
	if (!visible || push) {
		return IDLE_POLL_MS
	}
	if (mine) {
		return LEADER_POLL_MS
	}
	if (!following) {
		return IDLE_POLL_MS
	}
	return pollMs
}
