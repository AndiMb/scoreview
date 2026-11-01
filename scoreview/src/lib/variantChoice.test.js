import { describe, expect, it } from 'vitest'
import { availableSource, elidMapping, keyForChoice, mergePictureMeta, pictureParts, sourceOptions } from './variantChoice.js'

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

describe('mergePictureMeta', () => {
	const base = {
		parts: [{ id: '1' }, { id: '2' }],
		duration: 90,
		noteSpellings: [{ elid: 1 }],
		lyricSyllables: [{ elid: 1, text: 'la' }],
		pageFormat: { width: 210, height: 297 },
		pages: 3,
	}

	it('is the base itself without a variant', () => {
		expect(mergePictureMeta(base, null)).toBe(base)
		expect(mergePictureMeta(null, { pages: 1 })).toBe(null)
	})

	it('takes the picture fields from the variant and keeps the piece', () => {
		const variant = { noteSpellings: [{ elid: 9 }], lyricSyllables: [], pageFormat: { width: 100, height: 200 }, pages: 7, parts: [{ id: '2' }] }
		const merged = mergePictureMeta(base, variant)
		expect(merged.noteSpellings).toEqual([{ elid: 9 }])
		expect(merged.pageFormat).toEqual({ width: 100, height: 200 })
		expect(merged.pages).toBe(7)
		// "none" stays none rather than the base's syllables.
		expect(merged.lyricSyllables).toEqual([])
		expect(merged.duration).toBe(90)
		expect(merged.parts).toBe(base.parts)
	})

	it('keeps "absent" apart from "empty" for syllables and falls back for the page format', () => {
		const merged = mergePictureMeta(base, { noteSpellings: [], pages: 2 })
		expect('lyricSyllables' in merged).toBe(false)
		expect(merged.pageFormat).toBe(base.pageFormat)
		// The base is not touched.
		expect(base.lyricSyllables).toHaveLength(1)
	})
})

describe('pictureParts', () => {
	it('prefers the variant parts, then the base parts, else none', () => {
		expect(pictureParts({ parts: [1, 2] }, { parts: [2] })).toEqual([2])
		expect(pictureParts({ parts: [1, 2] }, null)).toEqual([1, 2])
		expect(pictureParts(null, null)).toEqual([])
	})

	// Human.mscz: five voices and an invisible drum kit - five staves per
	// system, six parts in meta.json, so no page mapped staves to parts.
	const voices = ['S', 'A', 'T', 'B'].map((name, i) => ({ id: String(i + 1), name, isVisible: 'true' }))
	const drums = { id: '5', name: 'Drums', isVisible: 'false' }

	it('leaves out parts the score does not show', () => {
		expect(pictureParts({ parts: [...voices, drums] }, null)).toEqual(voices)
		expect(pictureParts({ parts: [voices[0], { ...drums, isVisible: false }] }, null)).toEqual([voices[0]])
	})

	it('leaves them out of a variant too, whose parts carry no visibility', () => {
		const variant = { parts: [...voices, drums].map(({ id, name }) => ({ id, name })) }
		expect(pictureParts({ parts: [...voices, drums] }, variant).map((p) => p.id)).toEqual(['1', '2', '3', '4'])
	})

	it('keeps an invisible part that a variant draws on its own', () => {
		expect(pictureParts({ parts: [...voices, drums] }, { parts: [{ id: '5', name: 'Drums' }] })).toEqual([{ id: '5', name: 'Drums' }])
	})
})
