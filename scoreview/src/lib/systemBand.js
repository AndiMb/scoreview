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
 * @typedef {{page:number, index:number, x:number, y:number, w:number, h:number}} Crop
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
			crops.push({ page: p.page, index: crops.length, x, y, w: right - x, h: bottom - y })
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
 * Massstab, mit dem ein Ausschnitt die verfuegbare Hoehe fuellt - als
 * Seitenbreite in Pixeln, die ScorePage erwartet (dort ist alles relativ
 * zur Seitenbreite).
 *
 * @param {Crop} crop
 * @param {{width:number}} viewBox der Seite
 * @param {number} heightPx verfuegbare Hoehe
 * @return {{pageWidthPx:number, cropWidthPx:number}}
 */
export function cropScale(crop, viewBox, heightPx) {
	const pxPerUnit = heightPx / crop.h
	return { pageWidthPx: viewBox.width * pxPerUnit, cropWidthPx: crop.w * pxPerUnit }
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
