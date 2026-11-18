// Small numeric helpers shared by the score follower's parts (lib/onlineWarp.js,
// lib/tempoTracker.js) - one copy instead of one per file. Pure.

/**
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @return {number} v limited to [min, max]
 */
export function clamp(v, min, max) {
	return Math.min(max, Math.max(min, v))
}

/**
 * Binary search in an ascending array.
 *
 * @param {ArrayLike<number>} sorted ascending
 * @param {number} value
 * @return {number} the first index whose entry is >= value (sorted.length if none)
 */
export function lowerBound(sorted, value) {
	let lo = 0
	let hi = sorted.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (sorted[mid] < value) {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	return lo
}
