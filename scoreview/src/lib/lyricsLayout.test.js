import { describe, expect, it } from 'vitest'
import { activeSyllable, buildLyrics, occurrences, seekTimeFor, syllableId, systemKeyFor, versesByElid } from './lyricsLayout.js'

// Nachgebaut nach lyrics-test.mscz (spike/messung-h/mb/gen.py): Sopran
// (Zeile 0) und Bass (Zeile 1); Takt 1-2 = elid 0-7, dreimal wiederholt mit
// drei Strophen; Schluss Takt 3 = elid 8-11 mit "A-men A-men" nur Strophe 0.
const SOP = [
	[['Hal', 'begin'], ['le', 'middle'], ['lu', 'middle'], ['ja', 'end'], ['sin', 'begin'], ['get', 'end'], ['dem', 'single'], ['Herrn', 'single']],
	[['Lo', 'begin'], ['bet', 'end'], ['ihn', 'single'], ['mit', 'single'], ['Psal', 'begin'], ['men', 'end'], ['und', 'single'], ['Klang', 'single']],
	[['Eh', 'begin'], ['re', 'end'], ['sei', 'single'], ['dem', 'single'], ['Va', 'begin'], ['ter', 'end'], ['al', 'begin'], ['lein', 'end']],
]
const SCHLUSS = [['A', 'single'], ['men', 'single'], ['A', 'begin'], ['men', 'end']]

function syllables() {
	const out = []
	for (const staff of [0, 1]) {
		for (let verse = 0; verse < 3; verse++) {
			SOP[verse].forEach(([text, syllabic], i) => out.push({ elid: i, staff, voice: 0, verse, syllabic, text: staff === 0 ? text : text.toUpperCase() }))
		}
		SCHLUSS.forEach(([text, syllabic], i) => out.push({ elid: 8 + i, staff, voice: 0, verse: 0, syllabic, text }))
	}
	return out
}

// Ausgerollt: 3 x elid 0-7, dann 8-11, je 500 ms
const events = [...[0, 1, 2].flatMap(() => [0, 1, 2, 3, 4, 5, 6, 7]), 8, 9, 10, 11].map((elid, i) => ({ elid, timeMs: i * 500 }))

describe('buildLyrics', () => {
	it('fuegt Silben zu Woertern zusammen', () => {
		const { blocks } = buildLyrics({ syllables: syllables(), staves: [0] })
		const v0 = blocks[0].verses.find((v) => v.verse === 0).words.map((w) => w.text)
		expect(v0).toEqual(['Halleluja', 'singet', 'dem', 'Herrn', 'A', 'men', 'Amen'])
	})

	it('legt die Strophen untereinander', () => {
		const { blocks, verses } = buildLyrics({ syllables: syllables(), staves: [0] })
		expect(verses).toEqual([0, 1, 2])
		expect(blocks[0].verses.map((v) => v.words[0].text)).toEqual(['Halleluja', 'Lobet', 'Ehre'])
	})

	it('zeigt den Text der eigenen Stimme', () => {
		const { blocks, staves } = buildLyrics({ syllables: syllables(), staves: [1] })
		expect(staves).toEqual([1])
		expect(blocks[0].verses[0].words[0].text).toBe('HALLELUJA')
	})

	it('nimmt ohne Stimme die oberste Zeile mit Text', () => {
		expect(buildLyrics({ syllables: syllables(), staves: null }).staves).toEqual([0])
	})

	it('nimmt die oberste Zeile, wenn die eigene keinen Text hat', () => {
		expect(buildLyrics({ syllables: syllables(), staves: [5] }).staves).toEqual([0])
	})

	it('teilt in Bloecke und behaelt Woerter ganz', () => {
		// Systemwechsel mitten in "singet" (elid 4 | 5)
		const { blocks } = buildLyrics({ syllables: syllables(), staves: [0], blockKeyOf: (elid) => (elid < 5 ? 'a' : 'b') })
		expect(blocks.map((b) => b.key)).toEqual(['a', 'b'])
		expect(blocks[0].verses[0].words.map((w) => w.text)).toEqual(['Halleluja', 'singet'])
		expect(blocks[1].verses[0].words.map((w) => w.text)).toEqual(['dem', 'Herrn', 'A', 'men', 'Amen'])
		// Der Schluss hat nur eine Strophe
		expect(blocks[1].verses).toHaveLength(3)
	})

	it('vertraegt eine leere Liste', () => {
		expect(buildLyrics({ syllables: [], staves: null })).toEqual({ blocks: [], staves: [], verses: [] })
	})
})

describe('activeSyllable', () => {
	const { blocks } = buildLyrics({ syllables: syllables(), staves: [0] })
	const index = { syllableVerses: versesByElid(blocks), events, occ: occurrences(events) }

	it('singt im n-ten Durchlauf die n-te Strophe (F2.2)', () => {
		expect(activeSyllable(index, 0)).toBe(syllableId(0, 0))
		expect(activeSyllable(index, 8)).toBe(syllableId(0, 1))
		expect(activeSyllable(index, 16)).toBe(syllableId(0, 2))
	})

	it('bleibt im Schluss bei der einzigen Strophe', () => {
		expect(activeSyllable(index, 24)).toBe(syllableId(8, 0))
	})

	it('liefert ohne Silbe an der Stelle null', () => {
		const idx = { ...index, events: [{ elid: 99 }], occ: [1] }
		expect(activeSyllable(idx, 0)).toBeNull()
		expect(activeSyllable(index, 999)).toBeNull()
	})
})

describe('seekTimeFor', () => {
	const { blocks } = buildLyrics({ syllables: syllables(), staves: [0] })
	const verses = versesByElid(blocks)

	it('springt zum Durchlauf der Strophe', () => {
		expect(seekTimeFor(events, verses, 2, 0)).toBe(1000)
		expect(seekTimeFor(events, verses, 2, 1)).toBe(5000)
		expect(seekTimeFor(events, verses, 2, 2)).toBe(9000)
	})

	it('liefert ohne die Stelle null', () => {
		expect(seekTimeFor(events, verses, 99, 0)).toBeNull()
	})
})

describe('occurrences', () => {
	it('zaehlt je elid', () => {
		expect(occurrences([{ elid: 1 }, { elid: 2 }, { elid: 1 }])).toEqual([1, 1, 2])
	})
})

describe('systemKeyFor', () => {
	const rects = [[{ y: 100, h: 50 }, { y: 100, h: 50 }, { y: 300, h: 50 }]]

	it('ordnet eine Stelle ihrem System zu', () => {
		expect(systemKeyFor({ page: 0, y: 120 }, rects)).toBe('0:100')
		expect(systemKeyFor({ page: 0, y: 320 }, rects)).toBe('0:300')
	})

	it('nimmt ohne Rechtecke die Seite', () => {
		expect(systemKeyFor({ page: 2, y: 5 }, rects)).toBe('2')
		expect(systemKeyFor(null, rects)).toBe('x')
	})
})
