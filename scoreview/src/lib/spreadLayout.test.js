import { describe, expect, it } from 'vitest'
import { BASE_PAGE_WIDTH_PX } from './scoreLayout.js'
import {
	fitSpreadPageZoom,
	fitSpreadWidthZoom,
	MIN_SPREAD_WIDTH_PX,
	pairOf,
	slotWidthPx,
	SPREAD_GAP_PX,
	spreadMode,
} from './spreadLayout.js'

const A4 = { width: 9924, height: 14028 }

describe('spreadMode', () => {
	it('switches on at the threshold, not below', () => {
		expect(MIN_SPREAD_WIDTH_PX).toBe(900)
		expect(spreadMode('left', 'pages', 899)).toBe('off')
		expect(spreadMode('left', 'pages', 900)).toBe('left')
		expect(spreadMode('right', 'pages', 1280)).toBe('right')
	})

	it('only applies to the page view', () => {
		expect(spreadMode('left', 'band', 1280)).toBe('off')
		expect(spreadMode('left', 'lyrics', 1280)).toBe('off')
	})

	it('stays off when switched off or unknown', () => {
		expect(spreadMode('off', 'pages', 1280)).toBe('off')
		expect(spreadMode('both', 'pages', 1280)).toBe('off')
		expect(spreadMode('left', 'pages', NaN)).toBe('off')
	})
})

describe('zoom for the pair', () => {
	it('fits two pages and the gap into the width', () => {
		expect(slotWidthPx(1280)).toBe((1280 - SPREAD_GAP_PX) / 2)
		const zoom = fitSpreadWidthZoom(1280)
		expect(zoom).toBeCloseTo(632 / BASE_PAGE_WIDTH_PX)
		expect(2 * zoom * BASE_PAGE_WIDTH_PX + SPREAD_GAP_PX).toBeCloseTo(1280)
	})

	it('fits the pair into the height when that is the tighter bound', () => {
		// 800 px high: one A4 page is 800 * 9924/14028 = 566 px wide, under the 632 px slot.
		const zoom = fitSpreadPageZoom(A4, 1280, 800)
		expect(zoom * BASE_PAGE_WIDTH_PX).toBeCloseTo(800 * A4.width / A4.height)
		// Very low and wide: the width is the bound.
		expect(fitSpreadPageZoom(A4, 1280, 5000)).toBeCloseTo(fitSpreadWidthZoom(1280))
	})
})

describe('pairOf', () => {
	it('pairs 1-2, 3-4 with page 1 on the left', () => {
		expect(pairOf(0, 'left', 5)).toEqual({ left: 0, right: 1 })
		expect(pairOf(1, 'left', 5)).toEqual({ left: 0, right: 1 })
		expect(pairOf(3, 'left', 5)).toEqual({ left: 2, right: 3 })
		expect(pairOf(4, 'left', 5)).toEqual({ left: 4, right: null })
	})

	it('puts page 1 alone on the right, then 2-3, 4-5', () => {
		expect(pairOf(0, 'right', 4)).toEqual({ left: null, right: 0 })
		expect(pairOf(1, 'right', 4)).toEqual({ left: 1, right: 2 })
		expect(pairOf(2, 'right', 4)).toEqual({ left: 1, right: 2 })
		expect(pairOf(3, 'right', 4)).toEqual({ left: 3, right: null })
	})
})
