import { describe, expect, it } from 'vitest'
import { clamp, lowerBound } from './numeric.js'

describe('clamp', () => {
	it('limits to the range and keeps values inside', () => {
		expect(clamp(-1, 0, 10)).toBe(0)
		expect(clamp(11, 0, 10)).toBe(10)
		expect(clamp(4.5, 0, 10)).toBe(4.5)
	})
})

describe('lowerBound', () => {
	it('finds the first entry not below the value', () => {
		const sorted = Float64Array.from([1, 3, 3, 7])
		expect(lowerBound(sorted, 0)).toBe(0)
		expect(lowerBound(sorted, 3)).toBe(1)
		expect(lowerBound(sorted, 4)).toBe(3)
		expect(lowerBound(sorted, 8)).toBe(4)
		expect(lowerBound([], 1)).toBe(0)
	})
})
