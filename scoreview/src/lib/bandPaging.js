// Turning pages inside one system of the band (issue #21) - pure, in the
// band's scroll coordinates (offsetLeft/scrollLeft, see SystemBand.vue).
//
// Every frame is as tall as the band, so on a phone one system is easily two
// to five screens wide. Moving only when the cursor enters the next system,
// the band would let the playhead run off the right edge in between.
//
// **Pages, not a glide:** the band stands still until the cursor nears the
// right edge, then moves on by most of a screen. A still picture can be read
// ahead, like a turned page; one that creeps along cannot, and it would cost a
// scroll per note on the phone. What was just played stays at the left
// (OVERLAP), so the eye finds its place after the jump.

/** Share of the view from which the cursor makes the band turn. */
export const TURN_EDGE = 0.85

/**
 * Share of the view kept from the old page: after a turn the cursor stands
 * this far from the left edge. With TURN_EDGE, one turn moves 70 % of a view.
 */
export const OVERLAP = 0.15

/**
 * The scroll range that shows only this frame: from its start (with the lead
 * the band keeps before every system, see LEAD in SystemBand.vue) to its end
 * flush with the right edge.
 *
 * @param {{frameLeft:number, frameWidth:number, viewWidth:number, lead?:number}} input
 * @return {{min:number, max:number}}
 */
function frameRange({ frameLeft, frameWidth, viewWidth, lead = 0 }) {
	const min = frameLeft - lead * viewWidth
	return { min, max: Math.max(min, frameLeft + frameWidth - viewWidth) }
}

/**
 * Where the band should scroll for the cursor inside a frame wider than the
 * view, or null to stand still.
 *
 * @param {object} input
 * @param {number} input.frameLeft
 * @param {number} input.frameWidth
 * @param {number} input.cursorLeft cursor's left edge, band coordinates
 * @param {number} input.cursorWidth
 * @param {number} input.scrollLeft
 * @param {number} input.viewWidth
 * @param {number} [input.lead] share of the view kept before a system's start
 * @return {?number} new scrollLeft
 */
export function planBandPage({ frameLeft, frameWidth, cursorLeft, cursorWidth, scrollLeft, viewWidth, lead = 0 }) {
	if (!(viewWidth > 0) || frameWidth <= viewWidth) {
		return null
	}
	const cursorRight = cursorLeft + cursorWidth
	const pastEdge = cursorRight > scrollLeft + viewWidth * TURN_EDGE
	// Left of the view: after a jump back, a loop or a hand that scrolled on.
	const behind = cursorLeft < scrollLeft
	if (!pastEdge && !behind) {
		return null
	}
	const target = pageForCursor({ frameLeft, frameWidth, cursorLeft, viewWidth, lead })
	return Math.abs(target - scrollLeft) < 1 ? null : target
}

/**
 * The page that shows the cursor, with the overlap before it - for a turn,
 * and for the button that brings the band back to the cursor.
 *
 * @param {object} input
 * @param {number} input.frameLeft
 * @param {number} input.frameWidth
 * @param {number} input.cursorLeft
 * @param {number} input.viewWidth
 * @param {number} [input.lead]
 * @return {number} scrollLeft
 */
export function pageForCursor({ frameLeft, frameWidth, cursorLeft, viewWidth, lead = 0 }) {
	const { min, max } = frameRange({ frameLeft, frameWidth, viewWidth, lead })
	return Math.min(max, Math.max(min, cursorLeft - viewWidth * OVERLAP))
}

/**
 * One page on inside a wide frame - pedal, Page Down, a swipe. Null at the
 * frame's end: then the next system follows, as before.
 *
 * @param {object} input
 * @param {number} input.frameLeft
 * @param {number} input.frameWidth
 * @param {number} input.scrollLeft
 * @param {number} input.viewWidth
 * @param {1|-1} input.direction
 * @param {number} [input.lead]
 * @return {?number} new scrollLeft
 */
export function pageStep({ frameLeft, frameWidth, scrollLeft, viewWidth, direction, lead = 0 }) {
	if (!(viewWidth > 0) || frameWidth <= viewWidth) {
		return null
	}
	const { min, max } = frameRange({ frameLeft, frameWidth, viewWidth, lead })
	// A whole view less the overlap: by hand the reader is not waiting at the edge.
	const step = viewWidth * (1 - OVERLAP)
	if (direction > 0) {
		return scrollLeft < max - 1 ? Math.min(max, scrollLeft + step) : null
	}
	return scrollLeft > min + 1 ? Math.max(min, scrollLeft - step) : null
}
