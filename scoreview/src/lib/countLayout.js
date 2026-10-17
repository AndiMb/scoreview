// Where a beat number goes on the page (B1): in a row above the staff, at
// the left edge of the chord's first notehead - like a teacher pencils them
// in. Pure, no DOM: the noteheads arrive as measured boxes
// (ScorePage.vue, noteSpellingIndex.js), the staves as bands
// (staffBands.js), and the result is a list of SVG text positions.
//
// Above the staff and not beside the head (unlike note names,
// noteLabelLayout.js): counts are read as a row, "1 + 2 + 3", and a row
// only works when every number sits at the same height. That leaves them
// over whatever stands above the staff - dynamics, slurs - which is where a
// pencilled count sits too.

/** Distance of the row above the top staff line, in staff spaces. */
const ROW_ABOVE_SPACES = 2.5

/** Height of the numbers, in staff spaces - a notehead is one. */
const SIZE_SPACES = 2.2

/**
 * @param {Array<{elid:number, staff:number, box:{x:number, y:number, width:number, height:number}}>} items
 *   the matched noteheads of one page (ScorePage noteItems)
 * @param {Array<{top:number, bottom:number, staves:Array<{top:number, bottom:number}>}>} systems
 *   staffBands.groupBandsIntoSystems of that page
 * @param {?Map<number, string>} countOfElid countLabels.countLabels, null = off
 * @param {?Array<number>} staves only these staff indices, null = all
 * @return {Array<{key:string, x:number, y:number, size:number, text:string}>} in SVG units
 */
export function placeCountLabels(items, systems, countOfElid, staves = null) {
	if (!countOfElid || countOfElid.size === 0 || !items || items.length === 0) {
		return []
	}
	const wanted = staves ? new Set(staves) : null
	// One label per chord and staff, at its leftmost head: a chord's heads
	// share the segment, and the number belongs to the chord, not to each
	// note of it.
	const firstHead = new Map()
	for (const item of items) {
		const text = countOfElid.get(item.elid)
		if (text === undefined || (wanted && !wanted.has(item.staff)) || !item.box) {
			continue
		}
		const key = `${item.elid}:${item.staff}`
		const seen = firstHead.get(key)
		if (!seen || item.box.x < seen.box.x) {
			firstHead.set(key, { key, text, staff: item.staff, box: item.box })
		}
	}
	const out = []
	for (const head of firstHead.values()) {
		const band = staffBandOf(systems, head.staff, head.box)
		if (!band) {
			continue
		}
		const space = (band.bottom - band.top) / 4
		out.push({
			key: head.key,
			x: head.box.x,
			y: band.top - ROW_ABOVE_SPACES * space,
			size: SIZE_SPACES * space,
			text: head.text,
		})
	}
	return out.sort((a, b) => a.y - b.y || a.x - b.x)
}

/**
 * The staff band a notehead belongs to: the staff of its index in the
 * system the head lies in, or - where staves do not map one to one (hidden
 * empty staves) - the band nearest to the head.
 *
 * @param {Array<object>} systems
 * @param {number} staff
 * @param {{y:number, height:number}} box
 * @return {?{top:number, bottom:number}}
 */
function staffBandOf(systems, staff, box) {
	const centre = box.y + box.height / 2
	// The nearest system, not the one containing the head: a note on a
	// ledger line below the bottom staff lies outside every system's lines
	// and still belongs to the one above it.
	const system = (systems ?? []).reduce((best, s) => {
		const d = centre < s.top ? s.top - centre : (centre > s.bottom ? centre - s.bottom : 0)
		return !best || d < best.d ? { s, d } : best
	}, null)?.s ?? null
	if (!system || !system.staves?.length) {
		return null
	}
	const byIndex = system.staves[staff]
	if (byIndex && centre >= byIndex.top - 4 * (byIndex.bottom - byIndex.top) && centre <= byIndex.bottom + 4 * (byIndex.bottom - byIndex.top)) {
		return byIndex
	}
	return system.staves.reduce((best, band) => {
		const d = Math.min(Math.abs(centre - band.top), Math.abs(centre - band.bottom))
		return !best || d < best.d ? { band, d } : best
	}, null)?.band ?? null
}
