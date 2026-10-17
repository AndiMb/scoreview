import { describe, expect, it, vi } from 'vitest'
// Switched off, autoscroll must stay still for the playback but still move
// for a forced update (an own jump, a zoom change, the button back), and it
// has to notice when the playing position has left the screen (issue #12).
import { useAutoScroll } from './useAutoScroll.js'

/**
 * A scroll container 500 px high with one page whose cursor sits at
 * `cursorTop` in viewport coordinates.
 *
 * @param {object} options
 * @param {boolean} options.enabled the user's switch
 * @param {number} options.cursorTop
 */
function setup({ enabled, cursorTop }) {
	const el = {
		scrollTop: 0,
		scrollLeft: 0,
		clientHeight: 500,
		clientWidth: 800,
		scrollHeight: 5000,
		scrollWidth: 800,
		getBoundingClientRect: () => ({ top: 0, left: 0 }),
		scrollTo: vi.fn(),
	}
	const page = {
		getCursorClientRect: () => ({ top: cursorTop, left: 100, height: 80, width: 50 }),
	}
	const on = { value: enabled }
	const scroll = useAutoScroll({ scrollEl: () => el, enabled: () => on.value })
	scroll.setPageRef(page, 0)
	return { el, scroll, on }
}

const RECT = { page: 0, x: 0, y: 0, w: 1, h: 1 }

describe('useAutoScroll', () => {
	it('follows the playback while switched on', () => {
		const { el, scroll } = setup({ enabled: true, cursorTop: 1200 })
		scroll.update(RECT)
		expect(el.scrollTo).toHaveBeenCalledTimes(1)
		expect(scroll.cursorOutOfView.value).toBe(false)
	})

	it('stays still while switched off and reports the cursor out of view', () => {
		const { el, scroll } = setup({ enabled: false, cursorTop: 1200 })
		scroll.update(RECT)
		expect(el.scrollTo).not.toHaveBeenCalled()
		expect(scroll.cursorOutOfView.value).toBe(true)
	})

	it('does not offer the way back for a cursor on screen', () => {
		const { scroll } = setup({ enabled: false, cursorTop: 200 })
		scroll.update(RECT)
		expect(scroll.cursorOutOfView.value).toBe(false)
	})

	it('still scrolls for a forced update while switched off', () => {
		const { el, scroll } = setup({ enabled: false, cursorTop: 1200 })
		scroll.update(RECT)
		scroll.update(RECT, true)
		expect(el.scrollTo).toHaveBeenCalledTimes(1)
		expect(scroll.cursorOutOfView.value).toBe(false)
	})

	it('re-measures after a manual scroll ends', () => {
		const { scroll } = setup({ enabled: false, cursorTop: 200 })
		scroll.update(RECT)
		expect(scroll.cursorOutOfView.value).toBe(false)
		// The cursor did not move, the view did: scrolled away by hand.
		scroll.setPageRef({ getCursorClientRect: () => ({ top: -900, left: 100, height: 80, width: 50 }) }, 0)
		scroll.onUserGestureStart()
		scroll.onUserGestureEnd()
		scroll.onScrollEnd()
		expect(scroll.cursorOutOfView.value).toBe(true)
	})
})
