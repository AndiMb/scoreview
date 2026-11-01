// Wohin ein Tonname (H3) neben seinem Notenkopf kommt. Rein, ohne DOM: Koepfe
// und Hindernisse sind Boxen in SVG-Einheiten, gemessen in ScorePage.vue.
//
// Links vom Kopf ist der natuerliche Platz - dort liest man ihn vor der Note.
// Dort stehen aber auch Vorzeichen, Wiederholungspunkte (Teil von BarLine),
// Punkte und Haelse der vorigen Note und Nachbarkoepfe im Akkord. Statt
// darueberzuschreiben, bekommt jeder Name der Reihe nach links, unten, oben
// und rechts angeboten und nimmt den ersten freien Platz. Ist keiner frei,
// den mit der kleinsten Ueberdeckung - ein Name muss stehen, sonst fehlt er
// genau dort, wo es eng ist.

// Breite eines Zeichens relativ zur Schriftgroesse (fett, Ziffern und
// Buchstaben gemischt) - geschaetzt, gemessen wird im Browser nicht: Das
// waeren Hunderte Layoutabfragen je Zoomstufe.
const CHAR_WIDTH = 0.62

/**
 * @typedef {{x: number, y: number, width: number, height: number}} Box
 */

/**
 * @param {Box} a
 * @param {Box} b
 * @return {number} Flaeche der Ueberdeckung
 */
export function overlapArea(a, b) {
	const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
	const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
	return w > 0 && h > 0 ? w * h : 0
}

/**
 * Die Plaetze in der Reihenfolge, in der sie versucht werden.
 *
 * @param {Box} head
 * @param {number} w Breite des Namens
 * @param {number} h Hoehe des Namens
 * @param {number} gap Abstand zum Kopf
 * @return {Array<{side: string, box: Box}>}
 */
export function candidates(head, w, h, gap) {
	const cx = head.x + head.width / 2
	const cy = head.y + head.height / 2
	return [
		{ side: 'left', box: { x: head.x - gap - w, y: cy - h / 2, width: w, height: h } },
		{ side: 'below', box: { x: cx - w / 2, y: head.y + head.height + gap, width: w, height: h } },
		{ side: 'above', box: { x: cx - w / 2, y: head.y - gap - h, width: w, height: h } },
		{ side: 'right', box: { x: head.x + head.width + gap, y: cy - h / 2, width: w, height: h } },
	]
}

/**
 * @param {Array<{key: string, text: string, head: Box, id: number, sizePx: number}>} items
 *   `id` kennzeichnet den eigenen Kopf unter den Hindernissen
 * @param {Array<{box: Box, id: number}>} obstacles alles, was nicht verdeckt
 *   werden soll, die Koepfe eingeschlossen (id -1 fuer Nicht-Koepfe). Kept
 *   indexed by identity (obstacleIndex), so never changed in place once
 *   handed in - a new list for new obstacles.
 * @param {number} pxPerUnit Bildschirmpixel je SVG-Einheit bei diesem Zoom
 * @return {Array<{key: string, text: string, sizePx: number, side: string, box: Box}>}
 */
export function placeNoteLabels(items, obstacles, pxPerUnit) {
	if (!(pxPerUnit > 0) || items.length === 0) {
		return []
	}
	// Obstacles and placed names sit in grids (createGrid), so a candidate
	// only meets what shares a cell with it. A plain scan is quadratic:
	// every name against every name placed before it, and against every
	// obstacle in its horizontal reach, which spans all systems of the page
	// (measured in Node: 63 ms for 1,200 heads and 4,000 obstacles, several
	// times that on a phone).
	//
	// The costs are summed over the overlapping boxes in the order a plain
	// scan visits them - obstacles by x, then names as placed - so the
	// floating point sums, and with them every choice, do not depend on the
	// grid (noteLabelLayout.test.js compares both).
	const { sorted, grid: obstacleGrid } = obstacleIndex(obstacles)
	let tallest = 0
	for (const item of items) {
		tallest = Math.max(tallest, item.sizePx / pxPerUnit)
	}
	const placedGrid = createGrid(2 * tallest)
	const placed = []
	const out = []
	for (const item of items) {
		const w = (item.text.length * CHAR_WIDTH * item.sizePx) / pxPerUnit
		const h = item.sizePx / pxPerUnit
		const gap = 2 / pxPerUnit
		let best = null
		for (const cand of candidates(item.head, w, h, gap)) {
			let cost = 0
			for (const i of obstacleGrid.query(cand.box)) {
				const o = sorted[i]
				if (o.id !== item.id) {
					cost += overlapArea(cand.box, o.box)
				}
			}
			for (const i of placedGrid.query(cand.box)) {
				cost += overlapArea(cand.box, placed[i])
			}
			if (best === null || cost < best.cost) {
				best = { ...cand, cost }
			}
			if (cost === 0) {
				break
			}
		}
		placedGrid.insert(best.box, placed.length)
		placed.push(best.box)
		out.push({ key: item.key, text: item.text, sizePx: item.sizePx, side: best.side, box: best.box })
	}
	return out
}

// The obstacles of a page sorted and in their grid, by the identity of the
// list: a page measures them once (ScorePage.vue obstacles()) and lays out
// against them at every zoom band and setting.
const obstacleIndexes = new WeakMap()

/**
 * @param {Array<{box: Box, id: number}>} obstacles
 * @return {{sorted: Array<{box: Box, id: number}>, grid: object}}
 */
function obstacleIndex(obstacles) {
	let index = obstacleIndexes.get(obstacles)
	if (index && index.count === obstacles.length) {
		return index
	}
	const sorted = [...obstacles].sort((a, b) => a.box.x - b.box.x)
	// Cells of three typical obstacles - fixed by the obstacles, not by the
	// names' size, so the grid serves every zoom.
	const heights = sorted.map((o) => o.box.height).filter((h) => h > 0).sort((a, b) => a - b)
	const grid = createGrid(3 * (heights[heights.length >> 1] ?? 1))
	sorted.forEach((o, i) => grid.insert(o.box, i))
	index = { sorted, grid, count: obstacles.length }
	obstacleIndexes.set(obstacles, index)
	return index
}

/** A box wider or taller than this many cells is checked against everything. */
const MAX_CELL_SPAN = 64

/**
 * A uniform grid over boxes. query() returns the ids of every box that can
 * overlap the given one with positive area, each once, ascending.
 *
 * @param {number} cellSize
 * @return {{insert: function(Box, number): void, query: function(Box): number[]}}
 */
export function createGrid(cellSize) {
	const size = cellSize > 0 && Number.isFinite(cellSize) ? cellSize : 1
	const cells = new Map()
	// Boxes too large or too odd for cells: a staff-wide slur, a box with
	// infinite coordinates. Few, so always checked.
	const everywhere = []
	const seen = []
	let stamp = 0
	const range = (box) => {
		const x0 = Math.floor(box.x / size)
		const x1 = Math.floor((box.x + box.width) / size)
		const y0 = Math.floor(box.y / size)
		const y1 = Math.floor((box.y + box.height) / size)
		return { x0, x1, y0, y1 }
	}
	// Cell keys as numbers: a page is far fewer than 2^20 cells across.
	const key = (cx, cy) => cx * 1048576 + cy
	return {
		insert(box, id) {
			// Without width or height a box never overlaps anything
			// (overlapArea() is 0 for it, NaN included).
			if (!(box.width > 0 && box.height > 0)) {
				return
			}
			const { x0, x1, y0, y1 } = range(box)
			if (!Number.isFinite(x0 + x1 + y0 + y1) || x1 - x0 > MAX_CELL_SPAN || y1 - y0 > MAX_CELL_SPAN) {
				everywhere.push(id)
				return
			}
			for (let cx = x0; cx <= x1; cx++) {
				for (let cy = y0; cy <= y1; cy++) {
					const k = key(cx, cy)
					const list = cells.get(k)
					if (list) {
						list.push(id)
					} else {
						cells.set(k, [id])
					}
				}
			}
		},
		query(box) {
			stamp++
			const found = []
			const take = (id) => {
				if (seen[id] !== stamp) {
					seen[id] = stamp
					found.push(id)
				}
			}
			everywhere.forEach(take)
			const { x0, x1, y0, y1 } = range(box)
			if (Number.isFinite(x0 + x1 + y0 + y1) && x1 - x0 <= MAX_CELL_SPAN && y1 - y0 <= MAX_CELL_SPAN) {
				for (let cx = x0; cx <= x1; cx++) {
					for (let cy = y0; cy <= y1; cy++) {
						cells.get(key(cx, cy))?.forEach(take)
					}
				}
			} else {
				// A query box too large for cells: everything that was put in.
				for (const list of cells.values()) {
					list.forEach(take)
				}
			}
			return found.length > 1 ? found.sort((a, b) => a - b) : found
		},
	}
}

/**
 * How finely the zoom is told apart for note names. The names are SVG text
 * in page units (ScorePage.vue): between two layouts they simply scale with
 * the notation, so a zoom step only needs a new layout - all of
 * placeNoteLabels() - when it leaves its band. 4 % per band: the gap to the
 * head and the size limits drift by at most 2 % before the names are placed
 * again; inside the limits the size does not drift at all.
 */
const SCALE_STEP = 1.04

/**
 * The zoom band a scale falls in, and the scale names are laid out at for
 * all of it.
 *
 * @param {number} pxPerUnit
 * @return {?{key: number, pxPerUnit: number}} null without a usable scale
 */
export function labelScale(pxPerUnit) {
	if (!(pxPerUnit > 0) || !Number.isFinite(pxPerUnit)) {
		return null
	}
	const key = Math.round(Math.log(pxPerUnit) / Math.log(SCALE_STEP))
	return { key, pxPerUnit: SCALE_STEP ** key }
}

/**
 * Placed names as SVG text in page units: anchored on the side towards the
 * head, so that the estimated width (CHAR_WIDTH) errs away from it, and
 * centred vertically on the box. `halo` is the width of the outline in the
 * paper's colour that keeps a name legible over staff lines - about 3 px at
 * the scale it was laid out for.
 *
 * @param {Array<{key: string, text: string, side: string, box: Box}>} placed placeNoteLabels()
 * @param {number} pxPerUnit the scale they were placed at
 * @return {{halo: number, texts: Array<{key: string, text: string, x: number, y: number, size: number, anchor: string}>}}
 */
export function noteNameTexts(placed, pxPerUnit) {
	return {
		halo: pxPerUnit > 0 ? 3 / pxPerUnit : 0,
		texts: placed.map((label) => {
			const { box } = label
			const anchor = { left: 'end', right: 'start' }[label.side] ?? 'middle'
			const x = anchor === 'end' ? box.x + box.width : anchor === 'start' ? box.x : box.x + box.width / 2
			return { key: label.key, text: label.text, x, y: box.y + box.height / 2, size: box.height, anchor }
		}),
	}
}
