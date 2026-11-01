import { describe, expect, it } from 'vitest'
import { bandStyle, cursorBands, percentStyle, percentX, percentY, stackNoteTexts } from './pageGeometry.js'

const box = { minX: 100, minY: 0, width: 1000, height: 2000 }
const staff = (top) => ({ top, bottom: top + 40, left: 150, right: 1050 })
const systems = [
	{ top: 100, bottom: 240, staves: [staff(100), staff(200)] },
	{ top: 500, bottom: 640, staves: [staff(500), staff(600)] },
]

describe('pageGeometry', () => {
	it('converts page units to percent of the page', () => {
		expect(percentX(box, 600)).toBe(50)
		expect(percentY(box, 500)).toBe(25)
		expect(percentStyle(box, 350, 1000)).toEqual({ left: '25%', top: '50%' })
	})

	it('splits the cursor into one band per staff of its system', () => {
		const bands = cursorBands({ x: 300, y: 90, w: 20, h: 160 }, systems)
		expect(bands).toEqual([
			{ x: 300, y: 90, w: 20, h: 60 },
			{ x: 300, y: 190, w: 20, h: 60 },
		])
	})

	it('keeps the cursor rectangle where no system is found', () => {
		expect(cursorBands({ x: 1, y: 1000, w: 2, h: 3 }, systems)).toEqual([{ x: 1, y: 1000, w: 2, h: 3 }])
		expect(cursorBands({ x: 1, y: 2, w: 3, h: 4 }, [])).toEqual([{ x: 1, y: 2, w: 3, h: 4 }])
	})

	it('puts note texts a staff space above their system and stacks those on one spot', () => {
		const spots = stackNoteTexts([
			{ x: 300, y: 110, h: 120 },
			{ x: 320, y: 110, h: 120 },
			{ x: 900, y: 110, h: 120 },
			{ x: 300, y: 520, h: 100 },
		], systems, box)
		expect(spots[0]).toEqual({ left: 20, top: percentY(box, 100 - 20), stack: 0 })
		expect(spots[1].stack).toBe(1)
		expect(spots[2].stack).toBe(0)
		expect(spots[3]).toEqual({ left: 20, top: percentY(box, 500 - 20), stack: 0 })
	})

	it('places a note text without a system over its own anchor', () => {
		const [spot] = stackNoteTexts([{ x: 100, y: 1000, h: 60 }], systems, box)
		expect(spot).toEqual({ left: 0, top: percentY(box, 1000 - 30), stack: 0 })
	})

	it('draws a staff band over the system width with air above and below', () => {
		expect(bandStyle(staff(200), box)).toEqual({ left: '5%', top: '9.75%', width: '90%', height: '2.5%' })
		expect(bandStyle(staff(200), box, 2).height).toBe('4%')
	})
})
