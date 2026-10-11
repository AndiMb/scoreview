/**
 * Delay between two status polls while the server converts a score.
 *
 * The first polls stay at 2 s: the local conversion path takes 0.7-2.9 s
 * (docs/limits.md), and slowing down early would delay exactly the common
 * case. After that the delay doubles up to 15 s - a long wait is a sidecar
 * converting many pages (~5.4 s per page) or a missing cron, both minutes
 * long, where 15 s more do not matter but 2 s polling over half an hour
 * would be ~900 requests.
 */

export const STATUS_POLL_STEPS_MS = Object.freeze([2000, 2000, 2000, 4000, 8000])
export const STATUS_POLL_MAX_MS = 15000

/**
 * @param {number} attempt how many polls have been answered with "not yet" (0 = first wait)
 * @return {number}
 */
export function nextStatusDelay(attempt) {
	const n = Math.max(0, Math.floor(Number(attempt) || 0))
	return n < STATUS_POLL_STEPS_MS.length ? STATUS_POLL_STEPS_MS[n] : STATUS_POLL_MAX_MS
}
