// Where overlays go on a score page (ScorePage.vue) - pure, no DOM. Page
// units are the SVG's viewBox; HTML overlays are placed in percent of the
// page box, which the page element maps exactly onto the viewBox (its
// aspect ratio is the viewBox's).

import { systemOf } from './stampLayout.js'

/**
 * @typedef {{minX:number, minY:number, width:number, height:number}} ViewBox
 * @typedef {{top:number, bottom:number, left:number, right:number}} Band
 * @typedef {{top:number, bottom:number, staves:Band[]}} System
 */

/**
 * @param {ViewBox} box
 * @param {number} x page units
 * @return {number} percent of the page width from its left edge
 */
export function percentX(box, x) {
	return ((x - box.minX) / box.width) * 100
}

/**
 * @param {ViewBox} box
 * @param {number} y page units
 * @return {number} percent of the page height from its top edge
 */
export function percentY(box, y) {
	return ((y - box.minY) / box.height) * 100
}

/**
 * A point as CSS `left`/`top`.
 *
 * @param {ViewBox} box
 * @param {number} x
 * @param {number} y
 * @return {{left: string, top: string}}
 */
export function percentStyle(box, x, y) {
	return { left: `${percentX(box, x)}%`, top: `${percentY(box, y)}%` }
}

/**
 * The playback cursor in page units: one band per staff of the system it
 * stands in, a little beyond the outer lines so notes on ledger lines stay
 * inside. Without a system (staves not found) the cursor rectangle itself.
 *
 * @param {{x:number, y:number, w:number, h:number}} rect
 * @param {System[]} systems
 * @return {Array<{x:number, y:number, w:number, h:number}>}
 */
export function cursorBands(rect, systems) {
	const system = systemOf(systems, rect)
	if (!system) {
		return [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h }]
	}
	const air = (system.staves[0].bottom - system.staves[0].top) / 4
	return system.staves.map((band) => ({
		x: rect.x,
		y: band.top - air,
		w: rect.w,
		h: band.bottom - band.top + 2 * air,
	}))
}

/**
 * Note texts above their system, stacked where several share a spot.
 *
 * Above the system rather than at the anchor: there the text would lie in
 * the notes. One staff space above it - close enough to belong, clear of the
 * notes. Several notes on one measure are the normal case in a rehearsal;
 * stacked rather than printed over each other, where they became unreadable.
 *
 * @param {Array<{x:number, y:number, h:number}>} markers of this page
 * @param {System[]} systems
 * @param {ViewBox} box
 * @return {Array<{left:number, top:number, stack:number}>} per marker, in
 *   percent of the page; `stack` counts the texts already below it
 */
export function stackNoteTexts(markers, systems, box) {
	const taken = []
	return markers.map((m) => {
		const system = systemOf(systems, m)
		const above = system ? system.top : m.y
		const space = system ? (system.staves[0].bottom - system.staves[0].top) / 2 : m.h / 2
		const left = percentX(box, m.x)
		const top = percentY(box, above - space)
		// Taken is what stands at the same height and closer than a text's
		// width.
		const stack = taken.filter((b) => Math.abs(b.top - top) < 0.5 && Math.abs(b.left - left) < 12).length
		taken.push({ left, top })
		return { left, top, stack }
	})
}

/**
 * A staff as a CSS box over the full system width, `airFactor` times a
 * quarter of its height beyond the outer lines.
 *
 * @param {Band} band
 * @param {ViewBox} box
 * @param {number} [airFactor]
 * @return {{left:string, top:string, width:string, height:string}}
 */
export function bandStyle(band, box, airFactor = 0.5) {
	const air = ((band.bottom - band.top) / 4) * airFactor
	return {
		left: `${percentX(box, band.left)}%`,
		top: `${percentY(box, band.top - air)}%`,
		width: `${((band.right - band.left) / box.width) * 100}%`,
		height: `${((band.bottom - band.top + 2 * air) / box.height) * 100}%`,
	}
}
