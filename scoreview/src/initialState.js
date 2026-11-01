import { loadState } from '@nextcloud/initial-state'

/**
 * Initial state of this app, or `fallback` when the page carries none.
 * `loadState` throws on a missing key - and missing it may be: the viewer
 * bundle also runs where nobody provided it (see useViewerPreferences.js).
 *
 * @param {string} key
 * @param {unknown} [fallback]
 * @return {unknown}
 */
export function readInitialState(key, fallback = null) {
	try {
		return loadState('scoreview', key)
	} catch {
		return fallback
	}
}
