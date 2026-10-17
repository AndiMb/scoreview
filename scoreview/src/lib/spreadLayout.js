// Two pages side by side (A2): when it applies, how wide each page gets, and
// which pages share a row. Pure, no DOM - the viewer measures the width of
// the page area and hands it in.
//
// The spread is not a fourth layout next to pages, band and lyrics but a
// property of the page view: it applies as soon as there is room, and a
// person can switch it off. The threshold hangs on the width of the page
// area, not on the device - a narrow desktop window stays single, a tablet
// in landscape becomes double.

import { computeFitPageZoom, computeFitWidthZoom } from './scoreLayout.js'

/**
 * Two pages of at least 440 px each plus the gap. At that width a
 * four-part choir system is about 16 px high - the same readability
 * threshold as for note names and beat counts (limits.md). A phone in
 * landscape stays below it.
 */
export const MIN_SPREAD_WIDTH_PX = 900

/** Gap between the two pages of a row, and between rows (px). */
export const SPREAD_GAP_PX = 16

/** The stored values of the `double_page` preference. */
export const SPREAD_PREFS = ['off', 'left', 'right']

/**
 * @param {string} pref `off` | `left` (page 1 on the left) | `right` (page 1 alone on the right)
 * @param {string} layout the active layout (pages | band | lyrics)
 * @param {number} widthPx width of the page area
 * @return {'off'|'left'|'right'}
 */
export function spreadMode(pref, layout, widthPx) {
	if (pref !== 'left' && pref !== 'right') {
		return 'off'
	}
	if (layout !== 'pages' || !(widthPx >= MIN_SPREAD_WIDTH_PX)) {
		return 'off'
	}
	return pref
}

/**
 * Width of one page of the pair.
 *
 * @param {number} widthPx width of the page area
 * @param {number} [gap]
 * @return {number}
 */
export function slotWidthPx(widthPx, gap = SPREAD_GAP_PX) {
	return Math.max(0, (widthPx - gap) / 2)
}

/**
 * Preset "page width" for the pair: both pages and the gap fill the width.
 *
 * @param {number} widthPx
 * @return {number} zoom
 */
export function fitSpreadWidthZoom(widthPx) {
	return computeFitWidthZoom(slotWidthPx(widthPx))
}

/**
 * Preset "whole page" for the pair: both pages fit in width and height.
 *
 * @param {{width:number, height:number}} viewBox
 * @param {number} widthPx
 * @param {number} heightPx
 * @return {number} zoom
 */
export function fitSpreadPageZoom(viewBox, widthPx, heightPx) {
	return computeFitPageZoom(viewBox, slotWidthPx(widthPx), heightPx)
}

/**
 * The row a page sits in, as page indices (0-based). With `left`, pages
 * pair up 1-2, 3-4; with `right`, page 1 stands alone on the right like the
 * first page of a bound booklet, then 2-3, 4-5.
 *
 * @param {number} pageIndex 0-based
 * @param {'left'|'right'} mode
 * @param {number} pageCount
 * @return {{left: ?number, right: ?number}}
 */
export function pairOf(pageIndex, mode, pageCount) {
	const shift = mode === 'right' ? 1 : 0
	const leftIndex = Math.floor((pageIndex + shift) / 2) * 2 - shift
	const valid = (i) => (i >= 0 && i < pageCount ? i : null)
	return { left: valid(leftIndex), right: valid(leftIndex + 1) }
}
