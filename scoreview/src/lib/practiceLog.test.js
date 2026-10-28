import { describe, expect, it } from 'vitest'
import { createPracticeMeter, localDay, MAX_STRETCH_MS, minutesOf, shiftDay, streakOf, summarize, weekdayOf } from './practiceLog.js'

describe('days', () => {
	it('names the local calendar day', () => {
		expect(localDay(new Date(2026, 9, 27, 23, 30))).toBe('2026-10-27')
		expect(localDay(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05')
	})

	it('shifts across month, year and the change to winter time', () => {
		expect(shiftDay('2026-11-01', 1)).toBe('2026-10-31')
		expect(shiftDay('2027-01-01', 1)).toBe('2026-12-31')
		expect(shiftDay('2026-10-25', 1)).toBe('2026-10-24')
		expect(shiftDay('2026-10-24', -1)).toBe('2026-10-25')
	})

	it('counts the week from Monday', () => {
		expect(weekdayOf('2026-10-26')).toBe(0)
		expect(weekdayOf('2026-11-01')).toBe(6)
	})
})

describe('createPracticeMeter', () => {
	it('counts only active time and keeps the remainder', () => {
		const meter = createPracticeMeter()
		meter.mark(0, true)
		meter.mark(1500, false)
		meter.mark(5000, false) // paused: nothing
		meter.mark(6000, true)
		meter.mark(7000, true)
		expect(meter.take()).toBe(2)
		expect(meter.pendingMs()).toBe(500)
	})

	it('does not believe a stretch the device slept through', () => {
		const meter = createPracticeMeter()
		meter.mark(0, true)
		meter.mark(60 * 60 * 1000, true)
		expect(meter.take(10_000)).toBe(MAX_STRETCH_MS / 1000)
	})

	it('hands out at most what one report may carry', () => {
		const meter = createPracticeMeter()
		meter.mark(0, true)
		meter.mark(100_000, true)
		expect(meter.take(60)).toBe(60)
		expect(meter.take(60)).toBe(40)
	})
})

describe('summarize', () => {
	const days = {
		'2026-10-19': 600, // last week, Monday
		'2026-10-25': 300, // last week, Sunday
		'2026-10-26': 1200, // this week, Monday
		'2026-10-27': 90,
	}

	it('adds up this week from Monday and last week apart', () => {
		const s = summarize({ days, activeDays: [], today: '2026-10-27', goalMinutes: null })
		expect(s.weekSeconds).toBe(1290)
		expect(s.lastWeekSeconds).toBe(900)
		expect(s.week.map((d) => d.seconds)).toEqual([1200, 90, 0, 0, 0, 0, 0])
		expect(s.week[1].today).toBe(true)
		expect(s.week[2].future).toBe(true)
		expect(s.goalPercent).toBeNull()
	})

	it('measures the week against the goal, capped at 100 %', () => {
		expect(summarize({ days, activeDays: [], today: '2026-10-27', goalMinutes: 43 }).goalPercent).toBe(50)
		const reached = summarize({ days, activeDays: [], today: '2026-10-27', goalMinutes: 20 })
		expect(reached.goalPercent).toBe(100)
		expect(reached.goalReached).toBe(true)
	})
})

describe('streakOf', () => {
	it('counts days in a row up to today', () => {
		expect(streakOf(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'], '2026-10-27')).toBe(4)
	})

	it('still counts at breakfast, before today is practised', () => {
		expect(streakOf(['2026-10-25', '2026-10-26'], '2026-10-27')).toBe(2)
	})

	it('ends at a gap', () => {
		expect(streakOf(['2026-10-23', '2026-10-25', '2026-10-26'], '2026-10-27')).toBe(2)
		expect(streakOf(['2026-10-24'], '2026-10-27')).toBe(0)
	})
})

describe('minutesOf', () => {
	it('shows a started minute as one', () => {
		expect(minutesOf(0)).toBe(0)
		expect(minutesOf(20)).toBe(1)
		expect(minutesOf(150)).toBe(3)
	})
})
