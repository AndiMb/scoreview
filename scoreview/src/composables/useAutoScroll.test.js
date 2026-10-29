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
	const page = pageAt(cursorTop)
	const on = { value: enabled }
	const scroll = useAutoScroll({ scrollEl: () => el, enabled: () => on.value })
	scroll.setPageRef(page, 0)
	return { el, scroll, on }
}

const RECT = { page: 0, x: 0, y: 0, w: 1, h: 1 }

/**
 * A page 800 x 1000 px whose top edge sits at `cursorTop` in viewport
 * coordinates, with the cursor at its top edge, 100 px in, 50 x 80 px.
 *
 * @param {number} cursorTop
 */
function pageAt(cursorTop) {
	return {
		$el: { getBoundingClientRect: () => ({ top: cursorTop, left: 0, width: 800, height: 1000 }) },
		getCursorBox: () => ({ top: 0, left: 100 / 800, width: 50 / 800, height: 80 / 1000 }),
	}
}

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
		scroll.setPageRef(pageAt(-900), 0)
		scroll.onUserGestureStart()
		scroll.onUserGestureEnd()
		scroll.onScrollEnd()
		expect(scroll.cursorOutOfView.value).toBe(true)
	})

	it('measures the layout once, not per note change', () => {
		const { scroll } = setup({ enabled: true, cursorTop: 200 })
		const page = pageAt(200)
		const read = vi.spyOn(page.$el, 'getBoundingClientRect')
		scroll.setPageRef(page, 0)
		scroll.update(RECT)
		scroll.update(RECT)
		scroll.update(RECT)
		expect(read).toHaveBeenCalledTimes(1)
	})

	it('measures afresh for a forced update', () => {
		const { scroll } = setup({ enabled: true, cursorTop: 200 })
		const page = pageAt(200)
		const read = vi.spyOn(page.$el, 'getBoundingClientRect')
		scroll.setPageRef(page, 0)
		scroll.update(RECT)
		scroll.update(RECT, true)
		expect(read).toHaveBeenCalledTimes(2)
	})

	it('hands out the same ref callback for a page on every render', () => {
		const { scroll } = setup({ enabled: true, cursorTop: 200 })
		expect(scroll.pageRef(3)).toBe(scroll.pageRef(3))
		expect(scroll.pageRef(3)).not.toBe(scroll.pageRef(4))
	})
})
