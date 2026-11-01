import { describe, expect, it } from 'vitest'
import { noteNameStaves, noteNameSystem } from './noteNameSystem.js'

describe('noteNameSystem', () => {
	it('keeps an explicit choice', () => {
		expect(noteNameSystem('solfa-fixed', 'de')).toBe('solfa-fixed')
	})
	it('follows the language when off', () => {
		expect(noteNameSystem('off', 'de_DE')).toBe('de')
		expect(noteNameSystem('off', 'DE')).toBe('de')
		expect(noteNameSystem(null, 'en_GB')).toBe('en')
		expect(noteNameSystem('off', undefined)).toBe('en')
	})
})

describe('noteNameStaves', () => {
	it('names only my staff where staves map to parts', () => {
		expect(noteNameStaves(true, 2, true)).toEqual([2])
		expect(noteNameStaves(true, 0, true)).toEqual([0])
	})
	it('names all staves otherwise', () => {
		expect(noteNameStaves(false, 2, true)).toBe(null)
		expect(noteNameStaves(true, null, true)).toBe(null)
		expect(noteNameStaves(true, 2, false)).toBe(null)
	})
})
