// Where a visitor of a public link keeps what a member keeps on the server:
// display settings, "my part" and the practice settings of each score. In
// this browser only, through lib/storage.js - a visitor has no account to
// store them in, and a private window or a full quota must not break the
// viewer (reads give null, writes do nothing then).
//
// JSON, because the values are objects and ids; what does not parse reads as
// nothing stored, like a value from an older version of the page would.

import { readStored, writeStored } from './storage.js'

/** The keys, one place for their shape. */
export const GUEST_KEYS = Object.freeze({
	prefs: 'scoreview.guest.prefs',
	myPart: (fileId) => `scoreview.guest.myPart.${fileId}`,
	practice: (fileId) => `scoreview.guest.practice.${fileId}`,
})

/**
 * @param {string} key
 * @return {unknown} the stored value, or null
 */
export function readGuest(key) {
	const raw = readStored(key)
	if (raw === null) {
		return null
	}
	try {
		return JSON.parse(raw)
	} catch {
		return null
	}
}

/**
 * @param {string} key
 * @param {unknown} value null removes the entry
 */
export function writeGuest(key, value) {
	writeStored(key, value === null || value === undefined ? null : JSON.stringify(value))
}
