import { describe, expect, it } from 'vitest'
import { cropsInLoop, loopDimRects, loopMeasureRects, loopSystemKeys } from './loopFocus.js'

// Six measures: three on system 1 (y 100), two on system 2 (y 400), one on
// page 2 - like measures.json elements, elid = measure - 1.
const elements = {
	0: { page: 0, x: 0, y: 100, w: 100, h: 50 },
	1: { page: 0, x: 100, y: 100, w: 100, h: 50 },
	2: { page: 0, x: 200, y: 100, w: 100, h: 50 },
	3: { page: 0, x: 0, y: 400, w: 150, h: 50 },
	4: { page: 0, x: 150, y: 400, w: 150, h: 50 },
	5: { page: 1, x: 0, y: 100, w: 300, h: 50 },
}

describe('loopMeasureRects', () => {
	it('returns the rectangles of the looped measures', () => {
		expect(loopMeasureRects(elements, 2, 4).map((r) => [r.page, r.x])).toEqual([[0, 100], [0, 200], [0, 0]])
		expect(loopMeasureRects(elements, 6, 9)).toEqual([elements[5]])
		expect(loopMeasureRects(null, 1, 2)).toEqual([])
	})
})

describe('loopDimRects', () => {
	it('dims what lies outside, merged per system row', () => {
		expect(loopDimRects(elements, 2, 2)).toEqual([
			[{ x: 0, y: 100, w: 100, h: 50 }, { x: 200, y: 100, w: 100, h: 50 }, { x: 0, y: 400, w: 300, h: 50 }],
			[{ x: 0, y: 100, w: 300, h: 50 }],
		])
	})

	it('dims nothing within a loop over everything and everything outside a loop at the end', () => {
		expect(loopDimRects(elements, 1, 6)).toEqual([])
		expect(loopDimRects(elements, 6, 6)).toEqual([[{ x: 0, y: 100, w: 300, h: 50 }, { x: 0, y: 400, w: 300, h: 50 }]])
	})

	it('keeps a loop across three systems intact', () => {
		const dim = loopDimRects(elements, 3, 6)
		expect(dim).toEqual([[{ x: 0, y: 100, w: 200, h: 50 }]])
	})
})

describe('loopSystemKeys / cropsInLoop', () => {
	it('keys the systems like the lyrics view', () => {
		expect([...loopSystemKeys(loopMeasureRects(elements, 2, 4))]).toEqual(['0:100', '0:400'])
	})

	it('keeps only the frames a loop measure lies in', () => {
		const crops = [
			{ page: 0, index: 0, y: 80, h: 100 },
			{ page: 0, index: 1, y: 380, h: 100 },
			{ page: 1, index: 2, y: 80, h: 100 },
		]
		expect(cropsInLoop(crops, loopMeasureRects(elements, 4, 5)).map((c) => c.index)).toEqual([1])
		expect(cropsInLoop(crops, loopMeasureRects(elements, 1, 6)).map((c) => c.index)).toEqual([0, 1, 2])
		expect(cropsInLoop(crops, [])).toEqual([])
	})
})
