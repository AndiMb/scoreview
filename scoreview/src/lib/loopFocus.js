// Focus on the loop (B4): everything outside the looped measures steps
// back, in all three views, so the eye finds the passage without reading
// measure numbers. Pure geometry over measures.json: a measure is a
// rectangle on a page (M4), the loop a range of displayed measure indices
// (elid = measure number - 1). Nothing is rebuilt (E2, no reflow) - the
// pages dim what lies outside, the band drops systems without a loop
// measure, the lyrics dim their blocks.

/**
 * The rectangles of the looped measures, page and all.
 *
 * @param {?Object<string, {page:number, x:number, y:number, w:number, h:number}>} elements measures.json elements
 * @param {number} fromMeasure 1-based, inclusive
 * @param {number} toMeasure 1-based, inclusive
 * @return {Array<{page:number, x:number, y:number, w:number, h:number}>}
 */
export function loopMeasureRects(elements, fromMeasure, toMeasure) {
	const out = []
	for (let m = Number(fromMeasure); m <= Number(toMeasure); m++) {
		const rect = elements?.[String(m - 1)]
		if (rect && Number.isFinite(rect.page)) {
			out.push(rect)
		}
	}
	return out
}

/**
 * What to dim on each page: the measures outside the loop, merged along a
 * system into one rectangle per run - a page of a choral piece has dozens
 * of measures, and a handful of rectangles cost the renderer nothing where
 * dozens would still be cheap but pointless.
 *
 * @param {?Object<string, {page:number, x:number, y:number, w:number, h:number}>} elements
 * @param {number} fromMeasure
 * @param {number} toMeasure
 * @return {Array<Array<{x:number, y:number, w:number, h:number}>>} by page index
 */
export function loopDimRects(elements, fromMeasure, toMeasure) {
	const from = Number(fromMeasure) - 1
	const to = Number(toMeasure) - 1
	const rows = new Map()
	for (const [id, rect] of Object.entries(elements ?? {})) {
		const elid = Number(id)
		if (!Number.isFinite(elid) || (elid >= from && elid <= to) || !rect || !Number.isFinite(rect.page)) {
			continue
		}
		const key = `${rect.page}:${Math.round(rect.y)}:${Math.round(rect.h)}`
		const row = rows.get(key) ?? []
		row.push(rect)
		rows.set(key, row)
	}
	const byPage = []
	for (const row of rows.values()) {
		row.sort((a, b) => a.x - b.x)
		let current = null
		for (const rect of row) {
			if (current && rect.x <= current.x + current.w + 2) {
				current.w = Math.max(current.x + current.w, rect.x + rect.w) - current.x
				continue
			}
			current = { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
			while (byPage.length <= rect.page) {
				byPage.push([])
			}
			byPage[rect.page].push(current)
		}
	}
	for (const page of byPage) {
		page.sort((a, b) => a.y - b.y || a.x - b.x)
	}
	return byPage
}

/**
 * The systems the loop touches, keyed like the lyrics view keys its blocks
 * (lyricsLayout.systemKeyFor: page and the measure row's top).
 *
 * @param {Array<{page:number, y:number}>} loopRects from loopMeasureRects()
 * @return {Set<string>}
 */
export function loopSystemKeys(loopRects) {
	return new Set(loopRects.map((r) => `${r.page}:${Math.round(r.y)}`))
}

/**
 * The band's frames that show a loop measure: a frame is a system's crop,
 * and a measure belongs to it when the measure's centre lies inside the
 * crop's height on the same page.
 *
 * @param {Array<{page:number, y:number, h:number}>} crops systemBand.systemCrops
 * @param {Array<{page:number, y:number, h:number}>} loopRects from loopMeasureRects()
 * @return {Array<object>} the crops kept, in their order
 */
export function cropsInLoop(crops, loopRects) {
	return crops.filter((crop) => loopRects.some((r) => {
		const centre = r.y + r.h / 2
		return r.page === crop.page && centre >= crop.y && centre <= crop.y + crop.h
	}))
}
