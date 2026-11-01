import { describe, expect, it } from 'vitest'
import { abortableDelay, retryAfterMs } from './retryAfter.js'

describe('retryAfterMs', () => {
	it('reads seconds and clamps', () => {
		expect(retryAfterMs('10', 5000)).toBe(10000)
		expect(retryAfterMs('0', 5000)).toBe(1000)
		expect(retryAfterMs('600', 5000)).toBe(30000)
	})
	it('reads an HTTP date', () => {
		const now = Date.parse('Sun, 01 Nov 2026 12:00:00 GMT')
		expect(retryAfterMs('Sun, 01 Nov 2026 12:00:05 GMT', 9000, now)).toBe(5000)
	})
	it('falls back on garbage', () => {
		expect(retryAfterMs('soon', 7000)).toBe(7000)
		expect(retryAfterMs(null, 7000)).toBe(7000)
	})
})

describe('abortableDelay', () => {
	it('resolves after the delay', async () => {
		await expect(abortableDelay(5, null)).resolves.toBeUndefined()
	})
	it('rejects on abort', async () => {
		const c = new AbortController()
		const p = abortableDelay(10000, c.signal)
		c.abort()
		await expect(p).rejects.toBeTruthy()
	})
})
