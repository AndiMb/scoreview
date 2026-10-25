import { describe, expect, it } from 'vitest'
import { availableSource, elidMapping, keyForChoice, sourceOptions } from './variantChoice.js'

// parts-test.mscz in the shape of its meta.json: stored parts "Sopran"
// (part 1) and "Frauenstimmen" (1 + 2), clarinet (3) and piano (4) without.
const meta = {
	parts: [{ id: '1', name: 'Sopran' }, { id: '2', name: 'Alt' }, { id: '3', name: 'Klarinette in B' }, { id: '4', name: 'Klavier' }],
	excerpts: [{ id: 0, name: 'Sopran', partIds: ['1'] }, { id: 1, name: 'Frauenstimmen', partIds: ['1', '2'] }],
}

describe('sourceOptions', () => {
	it('offers the score, the stored parts, and generated ones only where none is stored', () => {
		expect(sourceOptions(meta).map((o) => [o.value, o.kind, o.name])).toEqual([
			['full', 'full', ''],
			['ex0', 'stored', 'Sopran'],
			['ex1', 'stored', 'Frauenstimmen'],
			['part2', 'generated', 'Alt'],
			['part3', 'generated', 'Klarinette in B'],
			['part4', 'generated', 'Klavier'],
		])
	})

	it('puts the option showing exactly my part first after the score', () => {
		expect(sourceOptions(meta, '3').map((o) => o.value).slice(0, 2)).toEqual(['full', 'part3'])
		// A stored single-part excerpt counts as mine; a two-part one does not.
		expect(sourceOptions(meta, 1).map((o) => o.value).slice(0, 2)).toEqual(['full', 'ex0'])
		expect(sourceOptions(meta, '1').find((o) => o.value === 'ex1').mine).toBe(false)
	})

	it('copes with a base from before "excerpts" and with no meta', () => {
		expect(sourceOptions({ parts: meta.parts }).map((o) => o.value)).toEqual(['full', 'part1', 'part2', 'part3', 'part4'])
		expect(sourceOptions(null).map((o) => o.value)).toEqual(['full'])
	})

	it('offers no generated part for an id the key could not carry', () => {
		expect(sourceOptions({ parts: [{ id: 'a~b', name: 'X' }] }).map((o) => o.value)).toEqual(['full'])
	})
})

describe('availableSource', () => {
	it('keeps a source the score has and falls back to the score', () => {
		expect(availableSource('ex1', meta)).toBe('ex1')
		expect(availableSource('ex2', meta)).toBe('full')
		expect(availableSource('part1', meta)).toBe('full') // stored instead
		expect(availableSource(null, meta)).toBe('full')
	})
})

describe('keyForChoice', () => {
	const choice = { source: 'full', format: 'orig', concert: false, transposeNotation: false, transpose: -2 }

	it('is null for the base conversion', () => {
		expect(keyForChoice(choice)).toBeNull()
	})

	it('transposes the notation only when asked to, by the sound\'s amount', () => {
		expect(keyForChoice({ ...choice, transposeNotation: true })).toBe('full~orig~w~-2')
		expect(keyForChoice({ ...choice, source: 'part3', format: 'phone' })).toBe('part3~phone~w~0')
	})

	it('spells concert pitch and refuses what is no source', () => {
		expect(keyForChoice({ ...choice, concert: true })).toBe('full~orig~c~0')
		expect(keyForChoice({ ...choice, source: 'ex01', format: 'phone' })).toBeNull()
		expect(keyForChoice({ ...choice, format: 'A4' })).toBeNull()
	})
})

describe('elidMapping', () => {
	it('is the identity for the base', () => {
		const m = elidMapping(null)
		expect(m.toBase(5)).toBe(5)
		expect(m.toPicture(5)).toBe(5)
		expect(m.toBase(null)).toBeNull()
	})

	it('maps both ways, the first variant segment standing for a base one', () => {
		const m = elidMapping({ baseElid: { 0: 0, 1: 4, 2: 4, 3: 9 } })
		expect(m.toBase(2)).toBe(4)
		expect(m.toPicture(4)).toBe(1)
		expect(m.toPicture(5)).toBeNull()
		expect(m.toBase(77)).toBeNull()
	})
})
