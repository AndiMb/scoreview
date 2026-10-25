// Systemband (H8): die Notensysteme nebeneinander statt Seiten
// untereinander - auf dem Handy quer gehalten fuellt ein System die Hoehe.
// Ausgeschnitten wird aus dem vorhandenen Seitenbild, nichts wird neu gesetzt
// (E2 bleibt): Jedes System wird ein Ausschnitt seiner Seite, den
// ScorePage mit der Prop `crop` zeigt. Rein, ohne DOM.
//
// Die Systemgrenzen kommen aus staffBands.js (Notenlinien), sie gelten also
// fuer beide Konvertierungswege.

/**
 * @typedef {{top:number,bottom:number,left:number,right:number,staves:Array<{top:number,bottom:number}>}} System
 * @typedef {{page:number, index:number, x:number, y:number, w:number, h:number, space:number}} Crop
 *   `space` is the system's staff space in SVG units (bandScale).
 */

/**
 * Hoechstens so viele Linienabstaende Rand ueber und unter einem System.
 * Mehr waere leerer Raum, der die Noten kleiner macht; weniger schnitte
 * Hilfslinien hoher Soprane und Dynamik ab.
 */
const MAX_PAD_SPACES = 7

/**
 * Links vor den Linien stehen Klammer und Stimmenname - bis zu so viele
 * Linienabstaende. Rechts genuegt wenig: Dort endet die Zeile am Taktstrich.
 */
const LEFT_SPACES = 9
const RIGHT_SPACES = 2

/**
 * The largest staff space a system is shown with at zoom 1, in CSS px: a
 * staff of 48 px, some 7-8 mm on a phone - about printed choir music.
 * Filling the height alone made a one-staff part held upright a staff of
 * 130 px with three notes to a screen.
 */
export const MAX_SPACE_PX = 12

/** Range of the band's own zoom (useBandZoom), a factor on bandScale. */
export const BAND_ZOOM_MIN = 0.5
export const BAND_ZOOM_MAX = 3

/**
 * @param {Array<{page:number, systems:System[], viewBox:{minX:number,minY:number,width:number,height:number},
 *   lyricBottoms?:Array<?number>}>} pages je Seite die Systeme (staffBands) und
 *   optional je System die Unterkante des Liedtexts darunter
 * @return {Crop[]} in Lesereihenfolge
 */
export function systemCrops(pages) {
	const crops = []
	for (const p of pages) {
		const systems = p.systems ?? []
		for (let i = 0; i < systems.length; i++) {
			const s = systems[i]
			const space = staffSpace(s)
			const maxPad = MAX_PAD_SPACES * space
			const gapAbove = i > 0 ? s.top - systems[i - 1].bottom : maxPad * 2
			const gapBelow = i + 1 < systems.length ? systems[i + 1].top - s.bottom : maxPad * 2
			const padTop = Math.min(gapAbove / 2, maxPad)
			let padBottom = Math.min(gapBelow / 2, maxPad)
			// Liedtext gehoert zum System, auch wenn er tiefer reicht als die
			// halbe Luecke - abgeschnittene Silben waeren schlimmer als ein
			// Stueck vom naechsten System.
			const lyric = p.lyricBottoms?.[i]
			if (Number.isFinite(lyric) && lyric > s.bottom) {
				padBottom = Math.max(padBottom, lyric - s.bottom + space)
			}
			const vb = p.viewBox
			const x = Math.max(vb.minX, s.left - LEFT_SPACES * space)
			const right = Math.min(vb.minX + vb.width, s.right + RIGHT_SPACES * space)
			const y = Math.max(vb.minY, s.top - padTop)
			const bottom = Math.min(vb.minY + vb.height, s.bottom + padBottom)
			crops.push({ page: p.page, index: crops.length, x, y, w: right - x, h: bottom - y, space })
		}
	}
	return crops
}

/**
 * Linienabstand eines Systems aus seiner ersten Notenzeile (fuenf Linien,
 * vier Abstaende). Ohne Zeilen ein Achtel der Systemhoehe - nur damit die
 * Raender nicht null werden.
 *
 * @param {System} s
 * @return {number}
 */
function staffSpace(s) {
	const first = s.staves?.[0]
	if (first && first.bottom > first.top) {
		return (first.bottom - first.top) / 4
	}
	return Math.max(1, (s.bottom - s.top) / 8)
}

/**
 * Welcher Ausschnitt die Stelle zeigt - fuer Autoscroll und Blaettern.
 * Gesucht wird auf der Seite der Stelle der Ausschnitt, in dessen Hoehe sie
 * liegt, sonst der naechstgelegene auf dieser Seite.
 *
 * @param {Crop[]} crops
 * @param {number} page
 * @param {number} y Mitte des Cursors in SVG-Einheiten
 * @return {number} Index in crops, -1 ohne Ausschnitt auf dieser Seite
 */
export function cropIndexAt(crops, page, y) {
	let best = -1
	let bestDistance = Infinity
	for (const c of crops) {
		if (c.page !== page) {
			continue
		}
		if (y >= c.y && y <= c.y + c.h) {
			return c.index
		}
		const d = Math.min(Math.abs(y - c.y), Math.abs(y - (c.y + c.h)))
		if (d < bestDistance) {
			bestDistance = d
			best = c.index
		}
	}
	return best
}

/**
 * Which frames of the band to render: everything on screen plus `ahead`
 * screen widths on either side. Going by geometry rather than by "current
 * system +-1" matters twice: a frame narrower than the screen leaves the one
 * after next visible, and while the band glides to the next system the
 * current index still names the old one until the glide is nearly over.
 *
 * @param {Array<{left:number, width:number}>} frames in band coordinates (px)
 * @param {number} scrollLeft
 * @param {number} viewWidth
 * @param {number} [ahead] lead in screen widths
 * @return {{from:number, to:number}|null} inclusive index range, null if no frame is in reach
 */
export function bandWindow(frames, scrollLeft, viewWidth, ahead = 1) {
	const start = scrollLeft - viewWidth * ahead
	const end = scrollLeft + viewWidth * (1 + ahead)
	let from = -1
	let to = -1
	frames.forEach((f, i) => {
		if (f.left + f.width >= start && f.left <= end) {
			if (from < 0) {
				from = i
			}
			to = i
		}
	})
	return from < 0 ? null : { from, to }
}

/**
 * The frame whose left edge was passed last - the one the band "stands on"
 * while scrolling. Binary search over the left edges, which only grow: the
 * scroll handler runs for every scroll event of a glide.
 *
 * @param {number[]} lefts left edge of each frame, ascending
 * @param {number} position scroll position plus lead
 * @return {number} index, 0 before the first edge or without frames
 */
export function frameAt(lefts, position) {
	let lo = 0
	let hi = lefts.length - 1
	let found = 0
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		if (lefts[mid] <= position + 1) {
			found = mid
			lo = mid + 1
		} else {
			hi = mid - 1
		}
	}
	return found
}

/**
 * The scale of one frame: as tall as the band, but no larger staves than
 * MAX_SPACE_PX, times the band's zoom - as the page width in px that
 * ScorePage expects (everything there is relative to the page width).
 *
 * Per frame, not one scale for the whole band: held sideways the height is
 * the limit and each system fills it, as before; held upright the bound
 * applies and the staves come out the same size anyway. One scale for all
 * would let a single tall system (title, many verses) shrink every other.
 *
 * @param {Crop} crop without `space`, only the height counts
 * @param {{width:number}} viewBox of the page
 * @param {number} heightPx height of the band
 * @param {{zoom?:number, maxSpacePx?:number}} [options]
 * @return {{pageWidthPx:number, cropWidthPx:number, cropHeightPx:number}}
 */
export function bandScale(crop, viewBox, heightPx, { zoom = 1, maxSpacePx = MAX_SPACE_PX } = {}) {
	let pxPerUnit = heightPx / crop.h
	if (crop.space > 0) {
		pxPerUnit = Math.min(pxPerUnit, maxSpacePx / crop.space)
	}
	pxPerUnit *= zoom
	return { pageWidthPx: viewBox.width * pxPerUnit, cropWidthPx: crop.w * pxPerUnit, cropHeightPx: crop.h * pxPerUnit }
}

/**
 * Where the band stands, in terms that survive a new scale: the frame at
 * the left edge of the view and how far into it. When the frames change
 * size (the bar retracts on a phone held sideways, a hint comes or goes,
 * the zoom changes) the scroll position in px would point somewhere else.
 * The gap between frames does not scale, so a position in it is kept in px.
 *
 * @param {Array<{left:number, width:number}>} frames in band coordinates (px)
 * @param {number} scrollLeft
 * @return {?{index:number, fraction:number, gapPx:number}} null without frames
 */
export function bandAnchor(frames, scrollLeft) {
	if (frames.length === 0) {
		return null
	}
	const index = frameAt(frames.map((f) => f.left), scrollLeft)
	const f = frames[index]
	const offset = scrollLeft - f.left
	if (offset <= 0 || f.width <= 0) {
		return { index, fraction: 0, gapPx: Math.min(0, offset) }
	}
	if (offset > f.width) {
		return { index, fraction: 1, gapPx: offset - f.width }
	}
	return { index, fraction: offset / f.width, gapPx: 0 }
}

/**
 * The scroll position that shows the anchored spot again (bandAnchor).
 *
 * @param {Array<{left:number, width:number}>} frames after the change
 * @param {{index:number, fraction:number, gapPx:number}} anchor
 * @return {?number} null if the frame is gone
 */
export function scrollForAnchor(frames, anchor) {
	const f = anchor ? frames[anchor.index] : null
	if (!f) {
		return null
	}
	return Math.max(0, f.left + anchor.fraction * f.width + anchor.gapPx)
}

/**
 * Grundlinien des Liedtexts auf einer Seite (y in SVG-Einheiten). Die Engine
 * schreibt jede Silbe als `<g class="Lyrics …"><g transform="matrix(1 0 0 1
 * x y)">` (M10); Stock-MuseScore traegt dort keine Klasse - dann gibt es
 * keine, und der Ausschnitt bleibt beim halben Abstand.
 *
 * @param {string} svgText
 * @return {number[]}
 */
export function lyricBaselines(svgText) {
	const out = []
	const re = /class="Lyrics[^"]*">\s*<g transform="matrix\(1 0 0 1 [-\d.]+ ([-\d.]+)\)"/g
	for (const m of String(svgText ?? '').matchAll(re)) {
		out.push(Number(m[1]))
	}
	return out
}

/**
 * Je System die tiefste Liedtext-Grundlinie darunter (bis zum naechsten
 * System) - oder null ohne Liedtext.
 *
 * @param {System[]} systems
 * @param {number[]} baselines aus lyricBaselines()
 * @return {Array<?number>}
 */
export function lyricBottomsFor(systems, baselines) {
	return systems.map((s, i) => {
		const limit = i + 1 < systems.length ? systems[i + 1].top : Infinity
		const below = baselines.filter((y) => y > s.bottom && y < limit)
		return below.length > 0 ? Math.max(...below) : null
	})
}
