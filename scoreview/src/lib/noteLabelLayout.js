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
 *   werden soll, die Koepfe eingeschlossen (id -1 fuer Nicht-Koepfe)
 * @param {number} pxPerUnit Bildschirmpixel je SVG-Einheit bei diesem Zoom
 * @return {Array<{key: string, text: string, sizePx: number, side: string, box: Box}>}
 */
export function placeNoteLabels(items, obstacles, pxPerUnit) {
	if (!(pxPerUnit > 0)) {
		return []
	}
	// Grob nach x einsortiert, damit nicht jeder Name jedes Hindernis prueft:
	// Ein Name sieht nur, was in seiner Naehe beginnt.
	const sorted = [...obstacles].sort((a, b) => a.box.x - b.box.x)
	const placed = []
	const out = []
	for (const item of items) {
		const w = (item.text.length * CHAR_WIDTH * item.sizePx) / pxPerUnit
		const h = item.sizePx / pxPerUnit
		const gap = 2 / pxPerUnit
		const reach = w + gap + item.head.width + 2 * h
		const near = nearby(sorted, item.head.x - reach, item.head.x + item.head.width + reach)
			.filter((o) => o.id !== item.id)
		let best = null
		for (const cand of candidates(item.head, w, h, gap)) {
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
		out.push({ key: item.key, text: item.text, sizePx: item.sizePx, side: best.side, box: best.box })
	}
	return out
}

/**
 * Hindernisse, deren Box den Bereich [from, to] waagerecht beruehren kann.
 *
 * @param {Array<{box: Box}>} sorted nach box.x aufsteigend
 * @param {number} from
 * @param {number} to
 * @return {Array<{box: Box, id: number}>}
 */
function nearby(sorted, from, to) {
	const out = []
	for (const o of sorted) {
		if (o.box.x > to) {
			break
		}
		if (o.box.x + o.box.width >= from) {
			out.push(o)
		}
	}
	return out
}
