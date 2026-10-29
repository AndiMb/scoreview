// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { BASE_PAGE_WIDTH_PX } from '../lib/scoreLayout.js'
import { SPREAD_GAP_PX } from '../lib/spreadLayout.js'
import { useZoom } from './useZoom.js'

/** A scroll element with a page area of the given size (jsdom has no layout). */
function dom(width, height) {
	const scroll = document.createElement('div')
	const pages = document.createElement('div')
	pages.className = 'scoreview-pages'
	scroll.appendChild(pages)
	Object.defineProperty(pages, 'clientWidth', { value: width })
	Object.defineProperty(scroll, 'clientHeight', { value: height })
	return scroll
}

const A4 = { width: 9924, height: 14028 }

describe('useZoom presets', () => {
	it('fits one page into the width without a spread', () => {
		const scroll = dom(1280, 800)
		const zoom = useZoom({ rootEl: () => null, scrollEl: () => scroll })
		zoom.applyPreset('width')
		expect(zoom.zoom.value * BASE_PAGE_WIDTH_PX).toBeCloseTo(1280)
	})

	it('fits the pair into the width with a spread', () => {
		const scroll = dom(1280, 800)
		const zoom = useZoom({ rootEl: () => null, scrollEl: () => scroll, spread: () => true })
		zoom.applyPreset('width')
		expect(2 * zoom.zoom.value * BASE_PAGE_WIDTH_PX + SPREAD_GAP_PX).toBeCloseTo(1280)
		expect(zoom.followsWidth.value).toBe(true)
	})

	it('fits the pair into width and height for "whole page"', () => {
		const scroll = dom(1000, 800)
		const zoom = useZoom({ rootEl: () => null, scrollEl: () => scroll, spread: () => true })
		zoom.onPageLoaded({ index: 0, viewBox: A4, sizeMm: null })
		zoom.applyPreset('page')
		// One page of the pair is (1000 - 16) / 2 = 492 px wide at most; the
		// height would allow 566 px, so the width is the bound.
		expect(zoom.zoom.value * BASE_PAGE_WIDTH_PX).toBeCloseTo(492)
		expect(zoom.preset.value).toBe('page')
	})
})

// jsdom has no Fullscreen API (document.fullscreenEnabled is undefined) - the
// same answer as the WebView of the Nextcloud Android app.
describe('fullscreen inside the page (issue #20)', () => {
	it('is offered where the browser has no Fullscreen API', () => {
		const zoom = useZoom({ rootEl: () => null, scrollEl: () => dom(400, 800) })
		expect(zoom.fullscreenPossible).toBe(false)
	})

	it('enters with a history entry and "whole page", and leaves with the back button', async () => {
		const scroll = dom(400, 800)
		const zoom = useZoom({ rootEl: () => null, scrollEl: () => scroll })
		zoom.onPageLoaded({ index: 0, viewBox: A4, sizeMm: null })
		const length = history.length
		await zoom.toggleFullscreen()
		expect(zoom.pageFullscreen.value).toBe(true)
		expect(zoom.isFullscreen.value).toBe(true)
		expect(zoom.preset.value).toBe('page')
		expect(history.length).toBe(length + 1)
		window.dispatchEvent(new PopStateEvent('popstate'))
		await new Promise((resolve) => setTimeout(resolve))
		expect(zoom.pageFullscreen.value).toBe(false)
		expect(zoom.preset.value).toBe('width')
	})

	it('leaves on Escape', async () => {
		const zoom = useZoom({ rootEl: () => null, scrollEl: () => dom(400, 800) })
		await zoom.toggleFullscreen()
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
		await new Promise((resolve) => setTimeout(resolve))
		expect(zoom.isFullscreen.value).toBe(false)
	})
})

describe('useZoom pinch', () => {
	it('previews the pinch and sets the zoom once, when the fingers let go', () => {
		const frames = []
		vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb))
		vi.stubGlobal('cancelAnimationFrame', () => {})
		try {
			const animation = { effect: { setKeyframes: vi.fn() }, cancel: vi.fn() }
			const target = { animate: vi.fn(() => animation), getBoundingClientRect: () => ({ left: 0, top: 0 }) }
			const touches = (distance) => ({ currentTarget: target, touches: [{ clientX: 100, clientY: 100 }, { clientX: 100 + distance, clientY: 100 }] })
			const zoom = useZoom({ rootEl: () => null, scrollEl: () => dom(1280, 800) })
			zoom.set(1)
			zoom.onTouchStart(touches(100))
			zoom.onTouchMove(touches(200))
			frames.shift()()
			expect(zoom.zoom.value).toBe(1)
			expect(target.animate.mock.calls[0][0][0].transform).toBe('scale(2)')
			zoom.onTouchEnd({ currentTarget: target, touches: [] })
			expect(animation.cancel).toHaveBeenCalled()
			expect(zoom.zoom.value).toBeCloseTo(2)
		} finally {
			vi.unstubAllGlobals()
		}
	})
})
