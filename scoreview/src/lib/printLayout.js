// Page geometry for the print page (E16): the sheet size the browser's print
// dialog should use, taken from the score itself. MuseScore lays out the
// pages (E2) and writes their format into meta.json (`pageFormat`, mm) on
// both conversion paths (E3); the SVG carries the same proportions in its
// viewBox. Pure, no DOM - the print page only turns the result into CSS.

/** Fallback when the score carries no usable page format. */
export const A4_MM = Object.freeze({ widthMm: 210, heightMm: 297 })

// Anything outside this range is not a sheet of paper but a broken value
// (a page of 0 mm, or inches read as millimetres twice). Hand-sized up to
// A0 plus a margin.
const MIN_MM = 50
const MAX_MM = 1300

/**
 * Width and height of one sheet in millimetres.
 *
 * Precedence: `pageFormat` from meta.json; a missing height is taken from the
 * first page's viewBox ratio (the width is the reliable value - MuseScore
 * exports it even for custom formats); without both, A4. Every page of a
 * score shares one format, so the first page stands for all of them.
 *
 * @param {?{pageFormat?: {width?: number, height?: number}}} meta meta.json
 * @param {?{width: number, height: number}} [firstViewBox] viewBox of page 1, any unit
 * @return {{widthMm: number, heightMm: number}}
 */
export function pageBoxMm(meta, firstViewBox = null) {
	const width = plausible(meta?.pageFormat?.width)
	const height = plausible(meta?.pageFormat?.height)
	if (width !== null && height !== null) {
		return { widthMm: width, heightMm: height }
	}
	const ratio = firstViewBox && firstViewBox.width > 0 && firstViewBox.height > 0
		? firstViewBox.height / firstViewBox.width
		: null
	if (width !== null && ratio !== null) {
		const fromRatio = plausible(width * ratio)
		if (fromRatio !== null) {
			return { widthMm: width, heightMm: fromRatio }
		}
	}
	return { ...A4_MM }
}

/**
 * The `@page` rule for the print page. No margin: MuseScore's page layout
 * already contains the margins (E2), and a browser margin on top would
 * shrink the score and shift it off centre.
 *
 * @param {{widthMm: number, heightMm: number}} box
 * @return {string}
 */
export function pageCss(box) {
	return `@page { size: ${fmt(box.widthMm)}mm ${fmt(box.heightMm)}mm; margin: 0; }`
}

/**
 * The viewBox of an SVG document as numbers, or null if it has none.
 *
 * @param {string} svgText
 * @return {?{width: number, height: number}}
 */
export function parseViewBox(svgText) {
	const m = /<svg\b[^>]*\bviewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)\s*["']/.exec(svgText ?? '')
	if (!m) {
		return null
	}
	const width = Number(m[3])
	const height = Number(m[4])
	return width > 0 && height > 0 ? { width, height } : null
}

function plausible(mm) {
	const n = Number(mm)
	return Number.isFinite(n) && n >= MIN_MM && n <= MAX_MM ? n : null
}

function fmt(mm) {
	// Two decimals are far below what a printer resolves; more only makes the
	// CSS harder to read in the DOM inspector.
	return String(Math.round(mm * 100) / 100)
}
