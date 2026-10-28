// Freehand drawings in the score (docs/architecture.md E22) - pure, without
// DOM.
//
// A drawing is pencil on the page: a breath mark drawn by hand, a slur, a
// circle around a tricky interval. Stored like a stamp - anchored to a
// measure and a point in it, not to pixels (Migration
// Version000100Date20260823130000) - and its strokes in staff spaces
// relative to that anchor. That way it keeps its shape and its place on the
// notes through a re-render, another zoom, phone pages or a part drawn on
// its own (E19): the anchor moves with the measure, the size with the staff.
//
// Vertically the anchor is the top line of the staff the stroke started on,
// remembered as its part - so a circle around a tenor note sits on the
// tenor staff also where the tenor stands alone. Where staves cannot be
// matched to parts (staffBands.canMapStavesToParts), the anchor is the top
// of the system; such a drawing stays where it was drawn, but would land
// above the wrong staff in a picture with other staves.

import { anchorFromTap, DEFAULT_SPACE, systemOf } from './stampLayout.js'

/** Format of the stored content - a change gets a new number, never a reinterpretation. */
export const DRAWING_VERSION = 1

/**
 * Bounds of one drawing, the same as the server's
 * (AnnotationController::validateDrawing): a drawing is a few marks, not a
 * picture. The content column is bounded to 10000 characters; at one decimal
 * a point takes about ten - the point limit keeps a drawing under that after
 * simplification.
 */
export const MAX_STROKES = 40
export const MAX_POINTS = 800
/** How far from its anchor a point may lie, in staff spaces (a page is ~150 wide). */
export const MAX_OFFSET_SPACES = 400

/**
 * Tolerance for thinning a stroke, in staff spaces. A finger on glass sends
 * a point every few pixels; a tenth of a staff space is below what the eye
 * tells apart at any zoom that shows notes readably.
 */
export const SIMPLIFY_SPACES = 0.12

/** Pen width in staff spaces - a soft pencil next to engraved notes. */
export const PEN_SPACES = 0.28

/**
 * Ramer-Douglas-Peucker: drops points that lie closer than `tolerance` to
 * the line between their neighbours. First and last point always stay.
 *
 * @param {Array<{x:number, y:number}>} points
 * @param {number} tolerance
 * @return {Array<{x:number, y:number}>}
 */
export function simplifyStroke(points, tolerance) {
	if (!Array.isArray(points) || points.length <= 2) {
		return points ?? []
	}
	const keep = new Uint8Array(points.length)
	keep[0] = 1
	keep[points.length - 1] = 1
	const stack = [[0, points.length - 1]]
	while (stack.length > 0) {
		const [first, last] = stack.pop()
		let maxDist = -1
		let index = -1
		for (let i = first + 1; i < last; i++) {
			const d = distanceToSegment(points[i], points[first], points[last])
			if (d > maxDist) {
				maxDist = d
				index = i
			}
		}
		if (index !== -1 && maxDist > tolerance) {
			keep[index] = 1
			stack.push([first, index], [index, last])
		}
	}
	return points.filter((_, i) => keep[i] === 1)
}

function distanceToSegment(p, a, b) {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const len2 = dx * dx + dy * dy
	if (len2 === 0) {
		return Math.hypot(p.x - a.x, p.y - a.y)
	}
	const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Staff space where a measure stands: from the staff lines if found, else
 * MuseScore's default, never more than a quarter of the measure (the same
 * rule as for stamps).
 *
 * @param {?{staves:Array<{top:number, bottom:number}>}} system
 * @param {{h:number}} measure
 * @param {?number} staffIndex
 * @return {number}
 */
export function spaceAt(system, measure, staffIndex = null) {
	const staves = system?.staves ?? []
	const band = (staffIndex !== null ? staves[staffIndex] : null) ?? staves[0]
	return band ? (band.bottom - band.top) / 4 : Math.min(measure.h / 4, DEFAULT_SPACE)
}

/**
 * The staff a point belongs to: the one it lies on, else the nearest.
 *
 * @param {?{staves:Array<{top:number, bottom:number}>}} system
 * @param {number} y
 * @return {?number}
 */
export function staffAt(system, y) {
	const staves = system?.staves ?? []
	let best = null
	let bestDist = Infinity
	staves.forEach((band, i) => {
		const d = y < band.top ? band.top - y : (y > band.bottom ? y - band.bottom : 0)
		if (d < bestDist) {
			bestDist = d
			best = i
		}
	})
	return best
}

/**
 * The origin of a drawing on the page: the anchor point in the measure,
 * at the top line of its staff - or of the system.
 *
 * @param {{x:number, y:number, w:number, h:number}} measure
 * @param {number} fraction
 * @param {?object} system
 * @param {?number} staffIndex
 * @return {{x:number, y:number, space:number}}
 */
export function originOf(measure, fraction, system, staffIndex) {
	const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
	const band = staffIndex !== null && staffIndex !== undefined ? system?.staves?.[staffIndex] : null
	return {
		x: measure.x + f * measure.w,
		y: band ? band.top : (system ? system.top : measure.y),
		space: spaceAt(system, measure, band ? staffIndex : null),
	}
}

/**
 * Turns the strokes drawn on one page into what is stored: the anchor
 * (measure, fraction), the part of the staff the first stroke began on, and
 * the strokes in staff spaces from the origin, thinned and rounded.
 *
 * @param {object} input
 * @param {Array<Array<{x:number, y:number}>>} input.strokes page units
 * @param {object} input.measureElements measures.json `elements`
 * @param {number} input.page
 * @param {Array} input.systems staffBands.groupBandsIntoSystems of the page
 * @param {boolean} input.mappable whether staves map to parts on the page
 * @param {Array<{id:(string|number), name:string}>} input.pictureParts parts in staff order
 * @return {?{measureNumber:number, fraction:number, content:string}} null
 *   when the drawing lies beside every measure, or is empty
 */
export function encodeDrawing({ strokes, measureElements, page, systems, mappable, pictureParts }) {
	const usable = (strokes ?? []).filter((s) => s.length > 0)
	if (usable.length === 0) {
		return null
	}
	const start = usable[0][0]
	const anchor = anchorFromTap(measureElements, page, start.x, start.y)
	if (anchor === null) {
		return null
	}
	const measure = measureElements[String(anchor.measureNumber - 1)]
	const system = systemOf(systems, measure)
	const staffIndex = mappable && system ? staffAt(system, start.y) : null
	const part = staffIndex !== null ? (pictureParts?.[staffIndex] ?? null) : null
	const origin = originOf(measure, anchor.fraction, system, part ? staffIndex : null)
	const round = (v) => Math.round(v * 10) / 10
	const encoded = []
	let points = 0
	for (const stroke of usable.slice(0, MAX_STROKES)) {
		const thin = simplifyStroke(stroke, SIMPLIFY_SPACES * origin.space)
		const flat = []
		for (const p of thin) {
			if (points >= MAX_POINTS) {
				break
			}
			const dx = Math.max(-MAX_OFFSET_SPACES, Math.min(MAX_OFFSET_SPACES, (p.x - origin.x) / origin.space))
			const dy = Math.max(-MAX_OFFSET_SPACES, Math.min(MAX_OFFSET_SPACES, (p.y - origin.y) / origin.space))
			flat.push(round(dx), round(dy))
			points++
		}
		// A dot is a stroke of one point - drawn as a short line, so the
		// round cap shows it.
		if (flat.length === 2) {
			flat.push(flat[0], flat[1])
		}
		if (flat.length >= 4) {
			encoded.push(flat)
		}
	}
	if (encoded.length === 0) {
		return null
	}
	return {
		measureNumber: anchor.measureNumber,
		fraction: anchor.fraction,
		content: JSON.stringify({
			v: DRAWING_VERSION,
			part: part ? { id: String(part.id), name: part.name ?? '' } : null,
			s: encoded,
		}),
	}
}

/**
 * The stored content back as data - defensive: a row that does not parse
 * draws nothing instead of breaking the page.
 *
 * @param {string} content
 * @return {?{part: ?{id:string, name:string}, strokes: number[][]}}
 */
export function decodeDrawing(content) {
	let data
	try {
		data = JSON.parse(content)
	} catch {
		return null
	}
	if (data?.v !== DRAWING_VERSION || !Array.isArray(data.s)) {
		return null
	}
	const strokes = data.s.filter((s) => Array.isArray(s) && s.length >= 4 && s.length % 2 === 0 && s.every(Number.isFinite))
	const part = data.part && typeof data.part.id === 'string' ? { id: data.part.id, name: String(data.part.name ?? '') } : null
	return { part, strokes }
}

/**
 * Where the drawings of a page are drawn: per drawing an SVG path in page
 * units and the pen width.
 *
 * @param {Array<{id:number, fraction:number, measureRect:object, staffIndex:?number, strokes:number[][], dimmed?:boolean}>} drawings
 *   `staffIndex` is the drawing's part counted in this picture (null: system)
 * @param {Array} systems
 * @param {boolean} mappable
 * @return {Array<{id:number, d:string, width:number, dimmed:boolean}>}
 */
export function layoutDrawings(drawings, systems, mappable) {
	const out = []
	for (const drawing of drawings ?? []) {
		const measure = drawing.measureRect
		if (!measure) {
			continue
		}
		const system = systemOf(systems, measure)
		const staffIndex = mappable ? drawing.staffIndex : null
		const origin = originOf(measure, drawing.fraction, system, staffIndex ?? null)
		const d = drawing.strokes.map((s) => {
			let path = ''
			for (let i = 0; i < s.length; i += 2) {
				const x = origin.x + s[i] * origin.space
				const y = origin.y + s[i + 1] * origin.space
				path += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
			}
			return path
		}).join('')
		out.push({ id: drawing.id, d, width: PEN_SPACES * origin.space, dimmed: drawing.dimmed === true })
	}
	return out
}

/**
 * Points of a stroke being drawn, as a path - the live trace under the pen.
 *
 * @param {Array<{x:number, y:number}>} points
 * @return {string}
 */
export function pathOf(points) {
	return (points ?? []).map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('')
}
