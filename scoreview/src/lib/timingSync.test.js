import { describe, expect, it } from 'vitest'
import { findStepIndex } from './timingSync.js'

describe('findStepIndex', () => {
	const times = [0, 1000, 2500, 2500, 4000]

	it('findet den größten Index, dessen Zeit nicht größer als die gesuchte Zeit ist', () => {
		expect(findStepIndex(times, 0)).toBe(0)
		expect(findStepIndex(times, 500)).toBe(0)
		expect(findStepIndex(times, 1000)).toBe(1)
		expect(findStepIndex(times, 4000)).toBe(4)
		expect(findStepIndex(times, 999999)).toBe(4)
	})

	it('liefert bei mehreren Schritten mit gleichem Zeitstempel den letzten davon', () => {
		expect(findStepIndex(times, 3000)).toBe(3)
	})

	it('liefert 0 für eine Zeit vor dem ersten Event', () => {
		expect(findStepIndex(times, -1)).toBe(0)
	})

	it('liefert 0 für eine leere Zeitliste', () => {
		expect(findStepIndex([], 1234)).toBe(0)
	})
})
