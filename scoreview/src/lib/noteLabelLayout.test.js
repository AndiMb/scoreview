import { describe, expect, it } from 'vitest'
import { candidates, overlapArea, placeNoteLabels } from './noteLabelLayout.js'

// Ein Pixel je Einheit: Groessen lassen sich direkt ablesen.
const head = (x, y = 100) => ({ x, y, width: 10, height: 8 })
const item = (key, x, id, text = 'c', y = 100) => ({ key, text, head: head(x, y), id, sizePx: 10 })

describe('noteLabelLayout', () => {
	it('misst Ueberdeckung nur, wo sich Boxen wirklich schneiden', () => {
		expect(overlapArea({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(25)
		expect(overlapArea({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBe(0)
	})

	it('versucht links, unten, oben, rechts', () => {
		expect(candidates(head(50), 6, 10, 2).map((c) => c.side)).toEqual(['left', 'below', 'above', 'right'])
		const [left] = candidates(head(50), 6, 10, 2)
		expect(left.box.x + left.box.width).toBe(48)
		expect(left.box.y + left.box.height / 2).toBe(104)
	})

	it('steht links, wenn dort frei ist - der eigene Kopf ist kein Hindernis', () => {
		const [label] = placeNoteLabels([item('a', 50, 0)], [{ box: head(50), id: 0 }], 1)
		expect(label.side).toBe('left')
	})

	it('weicht Wiederholungspunkten und Vorzeichen links vom Kopf aus', () => {
		const punkte = { box: { x: 42, y: 98, width: 4, height: 12 }, id: -1 }
		const [label] = placeNoteLabels([item('a', 50, 0)], [punkte], 1)
		expect(label.side).toBe('below')
		expect(overlapArea(label.box, punkte.box)).toBe(0)
	})

	it('schreibt Namen im Akkord nicht uebereinander', () => {
		// Zwei Koepfe direkt uebereinander: beide wollen links stehen.
		const items = [item('unten', 50, 0, 'c', 104), item('oben', 50, 1, 'e', 98)]
		const obstacles = [{ box: items[0].head, id: 0 }, { box: items[1].head, id: 1 }]
		const [a, b] = placeNoteLabels(items, obstacles, 1)
		expect(a.side).toBe('left')
		expect(b.side).not.toBe('left')
		expect(overlapArea(a.box, b.box)).toBe(0)
	})

	it('nimmt bei Enge den Platz mit der kleinsten Ueberdeckung statt keinen', () => {
		const wand = (x, y, w, h) => ({ box: { x, y, width: w, height: h }, id: -1 })
		const obstacles = [wand(30, 90, 18, 30), wand(40, 109, 30, 20), wand(40, 70, 30, 21), wand(61, 95, 2, 6)]
		const [label] = placeNoteLabels([item('a', 50, 0)], obstacles, 1)
		expect(label.side).toBe('right')
	})

	it('liefert ohne Massstab nichts', () => {
		expect(placeNoteLabels([item('a', 50, 0)], [], 0)).toEqual([])
	})
})
