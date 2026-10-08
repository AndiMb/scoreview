import { describe, expect, it } from 'vitest'
import { hitNotehead, matchNoteheads, spellingMap } from './noteSpellingIndex.js'

const spellings = spellingMap([
	{ elid: 3, staff: 0, voice: 0, notes: [[67, 15], [71, 19]] },
	{ elid: 3, staff: 0, voice: 1, notes: [[60, 14]] },
	{ elid: 4, staff: 1, voice: 0, notes: [[48, 14]] },
])

describe('matchNoteheads', () => {
	it('ordnet der Reihe nach je Stimme zu', () => {
		const index = new Map([
			['3:0', [{ node: 'a', voice: 0 }, { node: 'b', voice: 1 }, { node: 'c', voice: 0 }]],
			['4:1', [{ node: 'd', voice: 0 }]],
		])
		expect(matchNoteheads(index, spellings)).toEqual([
			{ node: 'a', elid: 3, staff: 0, voice: 0, pitch: 67, tpc: 15 },
			{ node: 'c', elid: 3, staff: 0, voice: 0, pitch: 71, tpc: 19 },
			{ node: 'b', elid: 3, staff: 0, voice: 1, pitch: 60, tpc: 14 },
			{ node: 'd', elid: 4, staff: 1, voice: 0, pitch: 48, tpc: 14 },
		])
	})

	it('laesst eine Gruppe mit abweichender Zahl ohne Namen', () => {
		const index = new Map([['3:0', [{ node: 'a', voice: 0 }]], ['4:1', [{ node: 'd', voice: 0 }]]])
		expect(matchNoteheads(index, spellings).map((m) => m.node)).toEqual(['d'])
	})

	it('ueberspringt Koepfe ohne Stimmkennung und fremde Segmente', () => {
		const index = new Map([['3:0', [{ node: 'x', voice: null }]], ['9:0', [{ node: 'y', voice: 0 }]]])
		expect(matchNoteheads(index, spellings)).toEqual([])
	})

	it('liefert ohne Schreibweisen nichts', () => {
		expect(matchNoteheads(new Map([['3:0', [{ node: 'a', voice: 0 }]]]), new Map())).toEqual([])
	})
})

describe('hitNotehead', () => {
	const items = [
		{ id: 1, box: { x: 100, y: 100, width: 20, height: 15 } },
		{ id: 2, box: { x: 100, y: 130, width: 20, height: 15 } },
	]

	it('trifft den Kopf unter dem Finger', () => {
		expect(hitNotehead(items, 110, 107, 5)?.id).toBe(1)
	})

	it('nimmt bei zwei Treffern den naeheren', () => {
		expect(hitNotehead(items, 110, 126, 10)?.id).toBe(2)
	})

	it('trifft daneben nichts', () => {
		expect(hitNotehead(items, 300, 300, 5)).toBeNull()
	})
})
