import { describe, expect, it } from 'vitest'
import { createGeneration } from './generation.js'

describe('createGeneration', () => {
	it('haelt die juengste Marke fuer aktuell', () => {
		const gen = createGeneration()
		const a = gen.next()
		expect(gen.isCurrent(a)).toBe(true)
	})

	it('ein spaeterer Anstoss ueberholt den frueheren', () => {
		const gen = createGeneration()
		const a = gen.next()
		const b = gen.next()
		expect(gen.isCurrent(a)).toBe(false)
		expect(gen.isCurrent(b)).toBe(true)
	})

	it('invalidate verwirft auch die juengste Marke', () => {
		const gen = createGeneration()
		const a = gen.next()
		gen.invalidate()
		expect(gen.isCurrent(a)).toBe(false)
	})

	it('eine Marke nach invalidate ist wieder aktuell', () => {
		const gen = createGeneration()
		gen.next()
		gen.invalidate()
		const b = gen.next()
		expect(gen.isCurrent(b)).toBe(true)
	})
})
