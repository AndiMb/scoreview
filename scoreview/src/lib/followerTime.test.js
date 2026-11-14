import { describe, expect, it } from 'vitest'
import { createFollowerTime, shownBetweenReports } from './followerTime.js'

describe('createFollowerTime', () => {
	it('shows nothing before the first confirmation', () => {
		expect(createFollowerTime().shownMs(0)).toBeNull()
	})

	it('runs on with the tempo between confirmations', () => {
		const time = createFollowerTime()
		time.confirm(1000, 0, 1.2)
		expect(time.shownMs(0)).toBe(1000)
		let shown
		for (let now = 16; now <= 400; now += 16) {
			shown = time.shownMs(now)
		}
		expect(shown).toBeCloseTo(1000 + 400 * 1.2, -1)
	})

	it('coasts at most coastMs in a pause, then stands', () => {
		const time = createFollowerTime({ coastMs: 1500 })
		time.confirm(5000, 0, 1)
		for (let now = 0; now <= 4000; now += 20) {
			time.shownMs(now)
		}
		expect(time.shownMs(4000)).toBeCloseTo(6500, -1)
		// The confirmed time itself never moved without a confirmation.
		expect(time.confirmedMs()).toBe(5000)
	})

	it('closes a small gap smoothly and shows a jump at once', () => {
		const time = createFollowerTime({ jumpMs: 400 })
		time.confirm(1000, 0, 1)
		time.shownMs(0)
		time.confirm(1250, 100, 1)
		const smooth = time.shownMs(100)
		expect(smooth).toBeGreaterThan(1100)
		expect(smooth).toBeLessThan(1350)
		time.confirm(9000, 200, 1)
		expect(time.shownMs(200)).toBe(9000)
	})
})

describe('shownBetweenReports', () => {
	const report = { atMs: 1000, shownMs: 5000, tempoRatio: 1.2, phase: 'following' }

	it('is NaN while nothing is known, so the display keeps its own clock', () => {
		expect(shownBetweenReports(null, 1000)).toBeNaN()
		expect(shownBetweenReports({ ...report, shownMs: null }, 1000)).toBeNaN()
	})

	it('runs on at the tempo while following', () => {
		expect(shownBetweenReports(report, 1100)).toBeCloseTo(5120)
	})

	it('stops after maxAheadMs when no report comes', () => {
		expect(shownBetweenReports(report, 5000, 250)).toBeCloseTo(5300)
	})

	it('stands while not following', () => {
		expect(shownBetweenReports({ ...report, phase: 'lost' }, 1200)).toBe(5000)
	})
})
