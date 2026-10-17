// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
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
