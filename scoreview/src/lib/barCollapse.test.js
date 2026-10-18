import { describe, expect, it } from 'vitest'
import { isTight, shouldCollapse, TIGHT_ENTER, TIGHT_LEAVE } from './barCollapse.js'

describe('isTight', () => {
	it('counts a phone in landscape as tight and the same phone upright as not', () => {
		// compact bar 53 px; viewer under Safari and the viewer header
		expect(isTight(53, 290, false)).toBe(true)
		expect(isTight(53, 650, false)).toBe(false)
	})

	it('does not count a desktop window as tight', () => {
		expect(isTight(53, 900, false)).toBe(false)
	})

	it('keeps the answer between the two thresholds', () => {
		const between = 53 / ((TIGHT_ENTER + TIGHT_LEAVE) / 2)
		expect(isTight(53, between, false)).toBe(false)
		expect(isTight(53, between, true)).toBe(true)
	})

	it('leaves below the lower threshold', () => {
		expect(isTight(53, 53 / TIGHT_LEAVE + 10, true)).toBe(false)
	})

	it('keeps the previous answer while nothing is measured', () => {
		expect(isTight(0, 290, true)).toBe(true)
		expect(isTight(53, 0, false)).toBe(false)
		expect(isTight(Number.NaN, 290, false)).toBe(false)
	})
})

describe('shouldCollapse', () => {
	const idle = { fullscreen: false, tight: false, playing: false, performance: false, following: false }

	it('retracts only where there is reason and need', () => {
		expect(shouldCollapse(idle)).toBe(false)
		expect(shouldCollapse({ ...idle, fullscreen: true })).toBe(false)
		expect(shouldCollapse({ ...idle, playing: true })).toBe(false)
		expect(shouldCollapse({ ...idle, fullscreen: true, playing: true })).toBe(true)
	})

	it('treats a tight viewer like fullscreen', () => {
		expect(shouldCollapse({ ...idle, tight: true, playing: true })).toBe(true)
		expect(shouldCollapse({ ...idle, tight: true })).toBe(false)
	})

	it('retracts in performance mode and while following, also in fullscreen', () => {
		expect(shouldCollapse({ ...idle, tight: true, performance: true })).toBe(true)
		expect(shouldCollapse({ ...idle, tight: true, following: true })).toBe(true)
		expect(shouldCollapse({ ...idle, fullscreen: true, performance: true })).toBe(true)
		expect(shouldCollapse({ ...idle, fullscreen: true, following: true })).toBe(true)
	})
})
