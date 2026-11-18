import { createLru } from '../lib/lruCache.js'
import { findStaffBands } from '../lib/staffBands.js'

// Sanitized pages, shared by all ScorePages. Page URLs carry the conversion
// version (`?v=`), so an entry never goes stale. A few pages are enough: the
// system band mounts several frames of the same page and re-mounts them when
// they scroll back into reach (SystemBand.vue), and the page view unloads a
// page 2,400 px away and loads it again on the way back. Each entry holds
// the text and the parsed nodes (lib/svgSanitizer.js#sanitizeSvgPage) - up
// to some 17,000 nodes a page.
//
// Module state, so it outlives a viewer: the chunk stays loaded after the
// viewer closes in Files. ScoreViewer empties it on unmount
// (clearSvgPageCache), or six parsed pages would stay in memory for as long
// as the Files tab is open.
const cache = createLru(6)
// Counts clearSvgPageCache() calls. A page still loading when the viewer
// closes would otherwise put its entry back after the clear.
let generation = 0

/**
 * Taken before a page is fetched and handed back to cacheSvgPage.
 *
 * @return {number}
 */
export function svgPageCacheGeneration() {
	return generation
}

/**
 * @param {string} key page URL and index
 * @return {object|undefined}
 */
export function cachedSvgPage(key) {
	return cache.get(key)
}

/**
 * @param {string} key
 * @param {{markup: string, source: object, viewBox: object, sizeMm: ?object}} page
 * @param {number} [since] svgPageCacheGeneration() from before the fetch;
 *   a cache cleared since then stays empty
 */
export function cacheSvgPage(key, page, since = generation) {
	if (since !== generation) {
		return
	}
	cache.set(key, page)
}

/** Forget every page - the viewer closed. */
export function clearSvgPageCache() {
	generation++
	cache.clear()
}

/**
 * The staff bands of a page (lib/staffBands.js), worked out once per page
 * entry. findStaffBands runs a regex over the whole markup - up to a
 * megabyte - and in the system band several frames show the same page,
 * each of which asked again. Kept on the entry itself, so a frame that
 * still holds an entry the cache has dropped keeps its bands too.
 *
 * @param {{markup: string, staffBands?: Array}} page
 * @return {Array} lib/staffBands.js Band[]
 */
export function staffBandsOf(page) {
	page.staffBands ??= findStaffBands(page.markup)
	return page.staffBands
}
