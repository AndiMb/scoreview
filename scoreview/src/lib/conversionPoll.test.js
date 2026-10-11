import { describe, expect, it } from 'vitest'
import { nextStatusDelay, STATUS_POLL_MAX_MS } from './conversionPoll.js'

describe('nextStatusDelay', () => {
	it('stays at 2 s for the first three waits - the local path is done by then', () => {
		expect([0, 1, 2].map(nextStatusDelay)).toEqual([2000, 2000, 2000])
	})

	it('then doubles up to the ceiling and stays there', () => {
		expect([3, 4, 5, 6, 100].map(nextStatusDelay)).toEqual([4000, 8000, 15000, 15000, 15000])
		expect(nextStatusDelay(1e6)).toBe(STATUS_POLL_MAX_MS)
	})

	it('treats nonsense as the first wait', () => {
		expect(nextStatusDelay(-3)).toBe(2000)
		expect(nextStatusDelay(undefined)).toBe(2000)
	})
})
