import { describe, expect, it } from 'vitest'
import { candidates, createGrid, labelScale, noteNameTexts, overlapArea, placeNoteLabels } from './noteLabelLayout.js'

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

// The scan placeNoteLabels() replaced: every candidate against all obstacles
// in its horizontal reach and all names placed before. The grid must give
// exactly its answer.
function referencePlace(items, obstacles, pxPerUnit) {
	if (!(pxPerUnit > 0)) {
		return []
	}
	const sorted = [...obstacles].sort((a, b) => a.box.x - b.box.x)
	const placed = []
	const out = []
	for (const it of items) {
		const w = (it.text.length * 0.62 * it.sizePx) / pxPerUnit
		const h = it.sizePx / pxPerUnit
		const gap = 2 / pxPerUnit
		const reach = w + gap + it.head.width + 2 * h
		const from = it.head.x - reach
		const to = it.head.x + it.head.width + reach
		const near = []
		for (const o of sorted) {
			if (o.box.x > to) {
				break
			}
			if (o.box.x + o.box.width >= from && o.id !== it.id) {
				near.push(o)
			}
		}
		let best = null
		for (const cand of candidates(it.head, w, h, gap)) {
			let cost = 0
			for (const o of near) {
				cost += overlapArea(cand.box, o.box)
			}
			for (const p of placed) {
				cost += overlapArea(cand.box, p)
			}
			if (best === null || cost < best.cost) {
				best = { ...cand, cost }
			}
			if (cost === 0) {
				break
			}
		}
		placed.push(best.box)
		out.push({ key: it.key, text: it.text, sizePx: it.sizePx, side: best.side, box: best.box })
	}
	return out
}

// Deterministic random numbers (mulberry32), so a failure can be replayed.
function random(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6D2B79F5) >>> 0
		let r = Math.imul(a ^ (a >>> 15), 1 | a)
		r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296
	}
}

/**
 * A page like a dense choir score: systems of staves, heads in rows, and
 * stems, accidentals, dots and the odd wide slur around them.
 *
 * @param {number} heads
 * @param {number} others
 * @param {number} seed
 */
function densePage(heads, others, seed) {
	const rnd = random(seed)
	const staves = 40
	const perStaff = Math.ceil(heads / staves)
	const items = []
	const obstacles = []
	for (let i = 0; i < heads; i++) {
		const staff = Math.floor(i / perStaff)
		const x = 150 + (i % perStaff) * (7800 / perStaff) + rnd() * 20
		const y = 200 + staff * 300 + rnd() * 80
		const head = { x, y, width: 26, height: 22 }
		items.push({ key: `k${i}`, text: rnd() < 0.3 ? 'fis' : 'c', head, id: i, sizePx: 9 + Math.floor(rnd() * 4) })
		obstacles.push({ box: head, id: i })
	}
	for (let i = 0; i < others; i++) {
		const near = items[Math.floor(rnd() * items.length)].head
		const wide = rnd() < 0.01
		obstacles.push({
			box: {
				x: near.x - 60 + rnd() * 120,
				y: near.y - 60 + rnd() * 120,
				width: wide ? 2000 + rnd() * 6000 : 3 + rnd() * 30,
				height: wide ? 30 : 3 + rnd() * 90,
			},
			id: -1,
		})
	}
	return { items, obstacles }
}

describe('noteLabelLayout - grid', () => {
	it('finds every box that overlaps, each once and in order', () => {
		const grid = createGrid(10)
		grid.insert({ x: 0, y: 0, width: 5, height: 5 }, 0)
		grid.insert({ x: 8, y: 8, width: 30, height: 4 }, 1)
		grid.insert({ x: 100, y: 100, width: 5, height: 5 }, 2)
		grid.insert({ x: -1e6, y: 0, width: 2e6, height: 1 }, 3)
		grid.insert({ x: 0, y: 0, width: 0, height: 5 }, 4)
		expect(grid.query({ x: 2, y: 2, width: 10, height: 10 })).toEqual([0, 1, 3])
		expect(grid.query({ x: 500, y: 500, width: 1, height: 1 })).toEqual([3])
	})

	it('places exactly as the plain scan, on random pages', () => {
		for (let seed = 1; seed <= 25; seed++) {
			const rnd = random(seed)
			const { items, obstacles } = densePage(20 + Math.floor(rnd() * 200), Math.floor(rnd() * 600), seed)
			const pxPerUnit = 0.05 + rnd() * 1.5
			expect(placeNoteLabels(items, obstacles, pxPerUnit)).toEqual(referencePlace(items, obstacles, pxPerUnit))
		}
	})

	it('stays fast on a dense page (1,200 heads, 4,000 obstacles)', () => {
		const { items, obstacles } = densePage(1200, 2800, 7)
		const time = (fn) => {
			fn()
			const start = performance.now()
			fn()
			return performance.now() - start
		}
		const grid = time(() => placeNoteLabels(items, obstacles, 0.36))
		const scan = time(() => referencePlace(items, obstacles, 0.36))
		expect(placeNoteLabels(items, obstacles, 0.36)).toEqual(referencePlace(items, obstacles, 0.36))
		// Relative, not in ms: CI machines differ by more than the gain.
		expect(grid).toBeLessThan(scan / 3)
	})
})

describe('noteLabelLayout - zoom bands and SVG text', () => {
	it('gives nearby zooms the same band and lays out at its scale', () => {
		const a = labelScale(0.5)
		expect(labelScale(a.pxPerUnit * 1.015).key).toBe(a.key)
		expect(labelScale(a.pxPerUnit / 1.015).key).toBe(a.key)
		expect(labelScale(0.6).key).not.toBe(a.key)
		expect(Math.abs(a.pxPerUnit / 0.5 - 1)).toBeLessThanOrEqual(0.02)
		expect(labelScale(0)).toBeNull()
		expect(labelScale(Infinity)).toBeNull()
	})

	it('anchors each name on the side towards its head', () => {
		const box = { x: 10, y: 20, width: 30, height: 12 }
		const { halo, texts } = noteNameTexts([
			{ key: 'l', text: 'c', side: 'left', box },
			{ key: 'r', text: 'c', side: 'right', box },
			{ key: 'b', text: 'c', side: 'below', box },
		], 0.5)
		expect(halo).toBe(6)
		expect(texts.map((x) => [x.anchor, x.x])).toEqual([['end', 40], ['start', 10], ['middle', 25]])
		expect(texts[0]).toMatchObject({ y: 26, size: 12, text: 'c', key: 'l' })
	})
})
