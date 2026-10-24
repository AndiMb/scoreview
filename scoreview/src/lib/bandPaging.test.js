import { describe, expect, it } from 'vitest'
import { OVERLAP, pageStep, planBandPage, TURN_EDGE } from './bandPaging.js'

// A frame three views wide at 1000 px, the view 400 px wide.
const frame = { frameLeft: 1000, frameWidth: 1200, viewWidth: 400 }

describe('planBandPage', () => {
	it('stands still while the cursor is left of the turning edge', () => {
		expect(planBandPage({ ...frame, scrollLeft: 1000, cursorLeft: 1000 + 400 * TURN_EDGE - 20, cursorWidth: 10 })).toBeNull()
	})

	it('turns when the cursor reaches the edge and keeps the overlap on the left', () => {
		const cursorLeft = 1000 + 400 * TURN_EDGE
		expect(planBandPage({ ...frame, scrollLeft: 1000, cursorLeft, cursorWidth: 10 })).toBe(cursorLeft - 400 * OVERLAP)
	})

	it('never scrolls past the frame\'s end - its last part ends flush right', () => {
		expect(planBandPage({ ...frame, scrollLeft: 1700, cursorLeft: 2150, cursorWidth: 10 })).toBe(1800)
		expect(planBandPage({ ...frame, scrollLeft: 1800, cursorLeft: 2190, cursorWidth: 10 })).toBeNull()
	})

	it('brings a cursor back that lies left of the view, not before the system\'s lead', () => {
		expect(planBandPage({ ...frame, scrollLeft: 1600, cursorLeft: 1020, cursorWidth: 10, lead: 0.08 })).toBe(968)
	})

	it('leaves a frame that fits the view to the system change', () => {
		expect(planBandPage({ frameLeft: 0, frameWidth: 380, viewWidth: 400, scrollLeft: 0, cursorLeft: 370, cursorWidth: 10 })).toBeNull()
	})

	it('does nothing before the band is measured', () => {
		expect(planBandPage({ ...frame, viewWidth: 0, scrollLeft: 0, cursorLeft: 2000, cursorWidth: 10 })).toBeNull()
	})
})

describe('pageStep', () => {
	it('moves a view less the overlap, and stops at the frame\'s end', () => {
		expect(pageStep({ ...frame, scrollLeft: 1000, direction: 1 })).toBe(1000 + 400 * (1 - OVERLAP))
		expect(pageStep({ ...frame, scrollLeft: 1700, direction: 1 })).toBe(1800)
		expect(pageStep({ ...frame, scrollLeft: 1800, direction: 1 })).toBeNull()
	})

	it('goes back to the start, then hands over to the previous system', () => {
		expect(pageStep({ ...frame, scrollLeft: 1100, direction: -1, lead: 0 })).toBe(1000)
		expect(pageStep({ ...frame, scrollLeft: 1000, direction: -1, lead: 0 })).toBeNull()
	})

	it('has no pages in a frame that fits', () => {
		expect(pageStep({ frameLeft: 0, frameWidth: 300, viewWidth: 400, scrollLeft: 0, direction: 1 })).toBeNull()
	})
})
