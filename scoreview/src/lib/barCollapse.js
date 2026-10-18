// When the control bar retracts to the progress line (useBarLayout.js).
//
// Two questions, kept apart: whether there is reason to give the bar's height
// to the score at all (fullscreen, or a viewer so short that the bar eats a
// noticeable share of it), and whether anybody needs the bar right now
// (playback, performance mode or following a leader - otherwise the user is
// operating, and a bar that vanishes meanwhile would be a nuisance).
//
// "Short" is the bar's share of the viewer's height, not a media query on
// orientation or height: the viewer sits in Nextcloud's viewer, in its own
// modal, in the mobile apps' frame or in fullscreen, and a share follows what
// it really has. Measured in Files, emulating a phone: the 59 px bar takes
// 25 % of the viewer in landscape, 10 % upright; a desktop window stays far
// below (issue #15).

/** Share of the viewer's height from which the bar counts as too tall. */
export const TIGHT_ENTER = 0.15

/**
 * Share below which it no longer does - apart from the entry, so that the bar
 * does not flutter while Safari shows and hides its own bars.
 */
export const TIGHT_LEAVE = 0.12

/**
 * Whether the bar takes too much of the viewer's height.
 *
 * The bar height is the one measured while the bar was standing; the caller
 * keeps it while the bar is retracted - measured then, the 8 px line would
 * say "not tight" and bring the bar straight back.
 *
 * @param {number} barHeight height of the standing bar (px)
 * @param {number} rootHeight height of the viewer (px)
 * @param {boolean} wasTight the previous answer
 * @return {boolean}
 */
export function isTight(barHeight, rootHeight, wasTight) {
	if (!(barHeight > 0) || !(rootHeight > 0)) {
		// Not measured yet: no reason to change anything.
		return wasTight
	}
	const share = barHeight / rootHeight
	return wasTight ? share >= TIGHT_LEAVE : share >= TIGHT_ENTER
}

/**
 * Whether the bar should retract after the idle period.
 *
 * @param {object} state
 * @param {boolean} state.fullscreen
 * @param {boolean} state.tight see isTight
 * @param {boolean} state.playing
 * @param {boolean} state.performance performance mode
 * @param {boolean} state.following this device follows a leader
 * @return {boolean}
 */
export function shouldCollapse({ fullscreen, tight, playing, performance, following }) {
	return (fullscreen || tight) && (playing || performance || following)
}
