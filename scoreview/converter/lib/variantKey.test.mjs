import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { BASE_KEY, engineViewOptions, parseVariantKey, variantKey } from './variantKey.mjs'

/**
 * The cases Service\VariantKey (PHP) is tested against as well - the two
 * grammars must agree, or the viewer asks for keys the server refuses. They
 * live in one fixture both test suites read (tests/fixtures/, outside the
 * shipped converter).
 */
const CASES = JSON.parse(readFileSync(new URL('../../tests/fixtures/variant-keys.json', import.meta.url), 'utf8'))
export const VALID = CASES.valid
export const INVALID = CASES.invalid

it('keeps the base key among the refused ones', () => {
	expect(INVALID).toContain(BASE_KEY)
})

describe('parseVariantKey', () => {
	it.each(VALID)('reads %s and writes it back the same', (key) => {
		const variant = parseVariantKey(key)
		expect(variant).not.toBeNull()
		expect(variantKey(variant)).toBe(key)
	})

	it.each(INVALID)('refuses %j', (key) => {
		expect(parseVariantKey(key)).toBeNull()
	})

	it('names the source', () => {
		expect(parseVariantKey('ex2~orig~w~0').source).toEqual({ kind: 'ex', index: 2 })
		expect(parseVariantKey('part17~orig~w~0').source).toEqual({ kind: 'part', partId: '17' })
		expect(parseVariantKey('full~phone~w~0').source).toEqual({ kind: 'full' })
	})

	it('refuses a key too long to be a folder name', () => {
		expect(parseVariantKey(`part${'a'.repeat(40)}~phonel~w~-12`)).not.toBeNull()
		expect(parseVariantKey(`part${'a'.repeat(41)}~orig~w~0`)).toBeNull()
	})
})

describe('variantKey', () => {
	it('has no key for the base conversion', () => {
		expect(variantKey({ source: { kind: 'full' }, format: 'orig', pitch: 'w', transpose: 0 })).toBeNull()
	})

	it('refuses what it cannot spell', () => {
		expect(variantKey({ source: { kind: 'full' }, format: 'orig', pitch: 'w', transpose: 1.5 })).toBeNull()
		expect(variantKey({ source: { kind: 'ex', index: -1 }, format: 'orig', pitch: 'w', transpose: 0 })).toBeNull()
		expect(variantKey({ source: { kind: 'part', partId: 'a~b' }, format: 'orig', pitch: 'w', transpose: 0 })).toBeNull()
		expect(variantKey(null)).toBeNull()
	})
})

describe('engineViewOptions', () => {
	it('leaves the pitch to the file unless concert pitch is asked for', () => {
		expect(engineViewOptions(parseVariantKey('full~phone~w~-2')))
			.toEqual({ format: 'phone', concertPitch: null, transposeSemitones: -2 })
		expect(engineViewOptions(parseVariantKey('full~orig~c~0')))
			.toEqual({ format: 'orig', concertPitch: true, transposeSemitones: 0 })
	})
})
