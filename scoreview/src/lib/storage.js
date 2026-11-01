/**
 * localStorage behind one guard. It throws in private windows, with storage
 * disabled by policy and when the quota is full - and a preference that
 * cannot be remembered must never break the viewer. Reading returns null,
 * writing just does nothing then.
 */

/**
 * @param {string} key
 * @return {?string}
 */
export function readStored(key) {
	try {
		return globalThis.localStorage?.getItem(key) ?? null
	} catch {
		return null
	}
}

/**
 * @param {string} key
 * @param {?string} value null removes the entry
 */
export function writeStored(key, value) {
	try {
		if (value === null || value === undefined) {
			globalThis.localStorage?.removeItem(key)
		} else {
			globalThis.localStorage?.setItem(key, String(value))
		}
	} catch {
		// Not remembered - the setting still holds for this page.
	}
}
