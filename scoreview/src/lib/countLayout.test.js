import { describe, expect, it } from 'vitest'
import { placeCountLabels } from './countLayout.js'

// Two staves of 40 units (space 10) in one system; a second system below.
const systems = [
	{ top: 100, bottom: 260, staves: [{ top: 100, bottom: 140, left: 0, right: 1000 }, { top: 220, bottom: 260, left: 0, right: 1000 }] },
	{ top: 400, bottom: 560, staves: [{ top: 400, bottom: 440, left: 0, right: 1000 }, { top: 520, bottom: 560, left: 0, right: 1000 }] },
]
const box = (x, y) => ({ x, y, width: 12, height: 10 })
const items = [
	{ elid: 0, staff: 0, box: box(50, 120) },
	{ elid: 0, staff: 0, box: box(40, 130) }, // the lower head of the chord, further left
	{ elid: 0, staff: 1, box: box(50, 240) },
	{ elid: 1, staff: 0, box: box(150, 110) },
	{ elid: 2, staff: 0, box: box(60, 420) },
]
const counts = new Map([[0, '1'], [1, '+'], [2, '1']])

describe('placeCountLabels', () => {
	it('puts one number per chord and staff in a row above the staff, at the leftmost head', () => {
		const labels = placeCountLabels(items, systems, counts)
		expect(labels).toEqual([
			{ key: '0:0', x: 40, y: 75, size: 22, text: '1' },
			{ key: '1:0', x: 150, y: 75, size: 22, text: '+' },
			{ key: '0:1', x: 50, y: 195, size: 22, text: '1' },
			{ key: '2:0', x: 60, y: 375, size: 22, text: '1' },
		])
	})

	it('restricts to the staves asked for', () => {
		expect(placeCountLabels(items, systems, counts, [1]).map((l) => l.key)).toEqual(['0:1'])
	})

	it('falls back to the nearest band where the staff index does not fit', () => {
		// Only one band in the system, the item says staff 1: nearest wins.
		const oneBand = [{ top: 100, bottom: 140, staves: [{ top: 100, bottom: 140 }] }]
		expect(placeCountLabels([{ elid: 0, staff: 1, box: box(10, 120) }], oneBand, counts)).toHaveLength(1)
	})

	it('keeps a head on a ledger line below the staff with its system', () => {
		// 30 units below the bottom line of staff 0 in system 1.
		const labels = placeCountLabels([{ elid: 0, staff: 0, box: box(10, 165) }], systems, counts)
		expect(labels).toEqual([{ key: '0:0', x: 10, y: 75, size: 22, text: '1' }])
	})

	it('gives nothing without counts, items or systems', () => {
		expect(placeCountLabels(items, systems, null)).toEqual([])
		expect(placeCountLabels([], systems, counts)).toEqual([])
		expect(placeCountLabels([{ elid: 0, staff: 0, box: box(10, 900) }], [], counts)).toEqual([])
	})
})
