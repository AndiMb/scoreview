// The last followed place of a score, kept on this device only (F28) -
// pure parts; the composable reads and writes localStorage.
//
// Only a hint: the follower takes it as a candidate for its search, never as
// a place that holds without hearing it (lib/scoreFollower.js anchors only
// what the music confirms). A different etag means a different conversion of
// the score - the old time may point anywhere.

/** Write at most this often while following (ms). */
export const SAVE_EVERY_MS = 5000

/** Older than this, the remembered place is no help any more (ms). */
export const MAX_AGE_MS = 12 * 60 * 60 * 1000

/**
 * @param {number|string} fileId
 * @return {string} the localStorage key
 */
export function memoryKey(fileId) {
	return `scoreview.follow.${fileId}`
}

/**
 * @param {string} etag
 * @param {number} timeMs
 * @param {number} nowMs
 * @return {string}
 */
export function encodeMemory(etag, timeMs, nowMs) {
	return JSON.stringify({ etag, timeMs: Math.round(timeMs), savedAt: nowMs })
}

/**
 * @param {?string} raw what localStorage holds
 * @param {string} etag the current conversion
 * @param {number} nowMs
 * @return {?number} the remembered score time, or null if unusable
 */
export function decodeMemory(raw, etag, nowMs) {
	if (!raw) {
		return null
	}
	let value
	try {
		value = JSON.parse(raw)
	} catch {
		return null
	}
	if (!value || value.etag !== etag || !Number.isFinite(value.timeMs) || value.timeMs < 0) {
		return null
	}
	if (!Number.isFinite(value.savedAt) || nowMs - value.savedAt > MAX_AGE_MS) {
		return null
	}
	return value.timeMs
}
