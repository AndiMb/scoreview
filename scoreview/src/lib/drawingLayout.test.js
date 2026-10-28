import { describe, expect, it } from 'vitest'
import { decodeDrawing, encodeDrawing, layoutDrawings, MAX_POINTS, originOf, simplifyStroke, staffAt } from './drawingLayout.js'

// One system with two staves (S, B), staff space 25; measure 1 from x 1000
// to 3000, measure 2 from 3000 to 5000.
const system = {
	top: 1000,
	bottom: 1400,
	staves: [{ top: 1000, bottom: 1100 }, { top: 1300, bottom: 1400 }],
}
const measures = {
	0: { page: 0, x: 1000, y: 1000, w: 2000, h: 400 },
	1: { page: 0, x: 3000, y: 1000, w: 2000, h: 400 },
}
const parts = [{ id: '1', name: 'Sopran' }, { id: '2', name: 'Bass' }]

describe('simplifyStroke', () => {
	it('drops points on a straight line and keeps the corners', () => {
		const line = [{ x: 0, y: 0 }, { x: 1, y: 0.01 }, { x: 2, y: 0 }, { x: 2, y: 2 }]
		expect(simplifyStroke(line, 0.1)).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }])
	})
})

describe('staffAt', () => {
	it('takes the staff under the point, else the nearest', () => {
		expect(staffAt(system, 1050)).toBe(0)
		expect(staffAt(system, 1280)).toBe(1)
		expect(staffAt(system, 1150)).toBe(0)
	})
})

describe('encodeDrawing / layoutDrawings', () => {
	const stroke = [{ x: 3500, y: 1290 }, { x: 3550, y: 1250 }, { x: 3600, y: 1290 }]

	it('anchors at the measure and the part of the staff the stroke began on', () => {
		const out = encodeDrawing({ strokes: [stroke], measureElements: measures, page: 0, systems: [system], mappable: true, pictureParts: parts })
		expect(out.measureNumber).toBe(2)
		expect(out.fraction).toBeCloseTo(0.25)
		const data = decodeDrawing(out.content)
		expect(data.part).toEqual({ id: '2', name: 'Bass' })
		// in staff spaces from (3500, top of the bass staff 1300)
		expect(data.strokes[0]).toEqual([0, -0.4, 2, -2, 4, -0.4])
	})

	it('draws back exactly where it was drawn', () => {
		const out = encodeDrawing({ strokes: [stroke], measureElements: measures, page: 0, systems: [system], mappable: true, pictureParts: parts })
		const data = decodeDrawing(out.content)
		const [placed] = layoutDrawings([{ id: 1, fraction: out.fraction, measureRect: measures[1], staffIndex: 1, strokes: data.strokes }], [system], true)
		expect(placed.d).toBe('M3500.0 1290.0L3550.0 1250.0L3600.0 1290.0')
		expect(placed.width).toBeCloseTo(7)
	})

	it('follows its part into a picture where it stands alone, at that staff size', () => {
		const out = encodeDrawing({ strokes: [stroke], measureElements: measures, page: 0, systems: [system], mappable: true, pictureParts: parts })
		const data = decodeDrawing(out.content)
		// The bass alone: one staff, space 20, the measure elsewhere.
		const alone = { top: 500, bottom: 580, staves: [{ top: 500, bottom: 580 }] }
		const measure = { page: 0, x: 200, y: 500, w: 1000, h: 80 }
		const [placed] = layoutDrawings([{ id: 1, fraction: out.fraction, measureRect: measure, staffIndex: 0, strokes: data.strokes }], [alone], true)
		expect(placed.d.startsWith('M450.0 492.0')).toBe(true)
	})

	it('falls back to the top of the system where staves do not map to parts', () => {
		const out = encodeDrawing({ strokes: [stroke], measureElements: measures, page: 0, systems: [system], mappable: false, pictureParts: parts })
		expect(decodeDrawing(out.content).part).toBeNull()
		expect(originOf(measures[1], out.fraction, system, null).y).toBe(1000)
	})

	it('keeps a tap as a dot and refuses a drawing beside every measure', () => {
		const dot = encodeDrawing({ strokes: [[{ x: 1500, y: 1050 }]], measureElements: measures, page: 0, systems: [system], mappable: true, pictureParts: parts })
		expect(decodeDrawing(dot.content).strokes[0]).toHaveLength(4)
		expect(encodeDrawing({ strokes: [[{ x: 9000, y: 9000 }]], measureElements: measures, page: 0, systems: [system], mappable: true, pictureParts: parts })).toBeNull()
	})

	it('stays within the point bound', () => {
		const zigzag = Array.from({ length: 3000 }, (_, i) => ({ x: 1000 + i, y: 1000 + (i % 2) * 50 }))
		const out = encodeDrawing({ strokes: [zigzag], measureElements: measures, page: 0, systems: [system], mappable: true, pictureParts: parts })
		expect(decodeDrawing(out.content).strokes[0].length / 2).toBeLessThanOrEqual(MAX_POINTS)
		expect(out.content.length).toBeLessThan(10000)
	})
})

describe('decodeDrawing', () => {
	it('draws nothing for content it cannot read', () => {
		expect(decodeDrawing('nonsense')).toBeNull()
		expect(decodeDrawing('{"v":2,"s":[]}')).toBeNull()
		expect(decodeDrawing('{"v":1,"part":null,"s":[[1,2,3],[0,0,1,1]]}').strokes).toEqual([[0, 0, 1, 1]])
	})
})
