// One score page as SVG -> one PDF page (content stream plus XObjects), for
// the PDF file next to the score (A1b). The PDF objects themselves are
// written by pdfWriter.js.
//
// This is not an SVG renderer. It translates the dialect the two conversion
// paths actually write (E3, measured on both):
//
// - scoreview-engine: <g transform="matrix(…)"> nested up to two deep,
//   glyphs as <use xlink:href="#gN" transform="translate(…) scale(…)"> on a
//   <path id> in <defs>, <path> (M L C Q Z), <polyline>, <polygon>, and
//   <image> with a data URI inside a translated group.
// - Stock MuseScore (sidecar, M9): flat, every glyph a <path> with
//   transform="matrix(a,b,c,d,e,f)", <polyline> with stroke-miterlimit,
//   <image> with its own transform and x/y, and a white page-sized <path>
//   as background.
//
// Everything in that set maps one to one onto PDF operators: matrices to
// `cm`, paths to `m l c h`, paint to `f f* S B B*`, line attributes to
// `w J j M`, colours to `rg RG`. A little more of the SVG grammar is
// covered than measured (relative path commands, H/V/S/T, rect, line,
// style="…") because it costs a few lines. Whatever falls outside -
// text, gradients, clip paths, arcs, opacity - is NOT approximated
// silently: it lands in `unsupported`, and the print page tells the person
// before the file is saved.
//
// Glyphs become Form XObjects, one per <defs> path and paint: the engine
// reuses a glyph thousands of times on a page, and repeating its outline at
// every use would make the file several times larger.
//
// Needs a DOMParser (browser; jsdom in the tests). Images other than JPEG
// need a canvas to decode - that impure step stays in PrintApp.vue and
// comes in through `decodeImage`.

import { jpegInfo, fmtNumber as n } from './pdfWriter.js'

const XLINK = 'http://www.w3.org/1999/xlink'
const PT_PER_MM = 72 / 25.4

/** Attributes that carry no drawing or that the walk reads itself. */
const STRUCTURAL = new Set([
	'id',
	'class',
	'version',
	'baseProfile',
	'xmlns',
	'xmlns:xlink',
	'viewBox',
	'width',
	'height',
	'x',
	'y',
	'd',
	'points',
	'transform',
	'href',
	'xlink:href',
	'preserveAspectRatio',
	'x1',
	'y1',
	'x2',
	'y2',
	'xml:space',
])

/** Presentation attributes that are translated (and inherited, as in SVG). */
const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule']

/** Accepted when they change nothing. */
const NEUTRAL = { opacity: '1', 'fill-opacity': '1', 'stroke-opacity': '1', visibility: 'visible', display: 'inline' }

const SKIPPED = new Set(['title', 'desc', 'metadata', 'defs'])

const DEFAULT_STYLE = {
	fill: '#000000',
	stroke: 'none',
	'stroke-width': '1',
	'stroke-linecap': 'butt',
	'stroke-linejoin': 'miter',
	'stroke-miterlimit': '4',
	'fill-rule': 'nonzero',
}

const NAMED_COLORS = { black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.5, 0], blue: [0, 0, 1], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5] }
const CAPS = { butt: 0, round: 1, square: 2 }
const JOINS = { miter: 0, round: 1, bevel: 2, 'miter-clip': 0 }

/**
 * @param {string} value
 * @return {?Array<number>} rgb in 0..1, null for none
 */
export function parseColor(value) {
	const v = String(value ?? '').trim().toLowerCase()
	if (v === 'none' || v === 'transparent' || v === '') {
		return null
	}
	let m = v.match(/^#([0-9a-f]{6})$/)
	if (m) {
		const int = parseInt(m[1], 16)
		return [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => c / 255)
	}
	m = v.match(/^#([0-9a-f]{3})$/)
	if (m) {
		return [...m[1]].map((c) => parseInt(c + c, 16) / 255)
	}
	m = v.match(/^rgb\(\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*\)$/)
	if (m) {
		return [[m[1], m[2]], [m[3], m[4]], [m[5], m[6]]].map(([num, pct]) => Math.min(1, Number(num) / (pct ? 100 : 255)))
	}
	if (v === 'currentcolor') {
		return [0, 0, 0]
	}
	return NAMED_COLORS[v] ?? undefined
}

const IDENTITY = [1, 0, 0, 1, 0, 0]

/**
 * A∘B: B applies first, as in an SVG transform list "A B".
 *
 * @param A
 * @param B
 */
function multiply(A, B) {
	return [
		A[0] * B[0] + A[2] * B[1],
		A[1] * B[0] + A[3] * B[1],
		A[0] * B[2] + A[2] * B[3],
		A[1] * B[2] + A[3] * B[3],
		A[0] * B[4] + A[2] * B[5] + A[4],
		A[1] * B[4] + A[3] * B[5] + A[5],
	]
}

/**
 * An SVG transform list as one matrix [a b c d e f].
 *
 * @param {?string} value
 * @return {?Array<number>} null when absent or unreadable
 */
export function parseTransform(value) {
	if (!value || !value.trim()) {
		return null
	}
	let matrix = IDENTITY
	let matched = false
	for (const [, name, args] of value.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
		const a = (args.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number)
		let m = null
		if (name === 'matrix' && a.length === 6) {
			m = a
		} else if (name === 'translate' && a.length >= 1) {
			m = [1, 0, 0, 1, a[0], a[1] ?? 0]
		} else if (name === 'scale' && a.length >= 1) {
			m = [a[0], 0, 0, a[1] ?? a[0], 0, 0]
		} else if (name === 'rotate' && a.length >= 1) {
			const r = (a[0] * Math.PI) / 180
			const rot = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]
			m = a.length >= 3 ? multiply(multiply([1, 0, 0, 1, a[1], a[2]], rot), [1, 0, 0, 1, -a[1], -a[2]]) : rot
		} else if (name === 'skewX' && a.length >= 1) {
			m = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0]
		} else if (name === 'skewY' && a.length >= 1) {
			m = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0]
		}
		if (m === null) {
			return null
		}
		matrix = multiply(matrix, m)
		matched = true
	}
	return matched ? matrix : null
}

const cm = (m) => `${m.map(n).join(' ')} cm`

/**
 * Path data to PDF path construction operators, absolute coordinates.
 * Quadratic segments become cubic ones (PDF has no quadratic Bézier).
 *
 * @param {string} d
 * @return {{ops: string, bbox: ?Array<number>, arcs: boolean}}
 */
export function pathToOps(d) {
	const tokens = String(d ?? '').match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []
	const out = []
	let x = 0
	let y = 0
	let startX = 0
	let startY = 0
	let lastCubic = null
	let lastQuad = null
	let arcs = false
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	const see = (px, py) => {
		minX = Math.min(minX, px)
		minY = Math.min(minY, py)
		maxX = Math.max(maxX, px)
		maxY = Math.max(maxY, py)
	}
	const move = (px, py) => {
		out.push(`${n(px)} ${n(py)} m`)
		see(px, py)
	}
	const line = (px, py) => {
		out.push(`${n(px)} ${n(py)} l`)
		see(px, py)
	}
	const curve = (x1, y1, x2, y2, px, py) => {
		out.push(`${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(px)} ${n(py)} c`)
		see(x1, y1)
		see(x2, y2)
		see(px, py)
	}

	let i = 0
	let command = null
	const isNumber = (t) => t !== undefined && !/^[a-zA-Z]$/.test(t)
	const take = () => Number(tokens[i++])
	while (i < tokens.length) {
		if (!isNumber(tokens[i])) {
			command = tokens[i++]
		} else if (command === null) {
			break
		}
		const rel = command === command.toLowerCase()
		const ox = rel ? x : 0
		const oy = rel ? y : 0
		const C = command.toUpperCase()
		if (C === 'Z') {
			out.push('h')
			x = startX
			y = startY
			lastCubic = lastQuad = null
			continue
		}
		const need = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }[C]
		if (need === undefined || !tokens.slice(i, i + need).every(isNumber) || i + need > tokens.length) {
			break
		}
		if (C === 'M') {
			x = ox + take()
			y = oy + take()
			startX = x
			startY = y
			move(x, y)
			// Further pairs after a moveto are implicit linetos.
			command = rel ? 'l' : 'L'
			lastCubic = lastQuad = null
		} else if (C === 'L') {
			x = ox + take()
			y = oy + take()
			line(x, y)
			lastCubic = lastQuad = null
		} else if (C === 'H') {
			x = ox + take()
			line(x, y)
			lastCubic = lastQuad = null
		} else if (C === 'V') {
			y = oy + take()
			line(x, y)
			lastCubic = lastQuad = null
		} else if (C === 'C' || C === 'S') {
			let x1
			let y1
			if (C === 'C') {
				x1 = ox + take()
				y1 = oy + take()
			} else {
				x1 = lastCubic ? 2 * x - lastCubic[0] : x
				y1 = lastCubic ? 2 * y - lastCubic[1] : y
			}
			const x2 = ox + take()
			const y2 = oy + take()
			const px = ox + take()
			const py = oy + take()
			curve(x1, y1, x2, y2, px, py)
			lastCubic = [x2, y2]
			lastQuad = null
			x = px
			y = py
		} else if (C === 'Q' || C === 'T') {
			let qx
			let qy
			if (C === 'Q') {
				qx = ox + take()
				qy = oy + take()
			} else {
				qx = lastQuad ? 2 * x - lastQuad[0] : x
				qy = lastQuad ? 2 * y - lastQuad[1] : y
			}
			const px = ox + take()
			const py = oy + take()
			curve(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), px + (2 / 3) * (qx - px), py + (2 / 3) * (qy - py), px, py)
			lastQuad = [qx, qy]
			lastCubic = null
			x = px
			y = py
		} else {
			// Arc: not in either dialect. A straight line keeps the outline
			// closed; the caller reports it.
			i += 5
			x = ox + take()
			y = oy + take()
			line(x, y)
			arcs = true
			lastCubic = lastQuad = null
		}
	}
	const bbox = minX === Infinity ? null : [minX, minY, maxX, maxY]
	return { ops: out.join(' '), bbox, arcs }
}

function pointsToOps(points, close) {
	const values = (String(points ?? '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number)
	const parts = []
	for (let k = 0; k + 1 < values.length; k += 2) {
		parts.push(`${n(values[k])} ${n(values[k + 1])} ${k === 0 ? 'm' : 'l'}`)
	}
	if (close && parts.length > 0) {
		parts.push('h')
	}
	const xs = values.filter((_, k) => k % 2 === 0)
	const ys = values.filter((_, k) => k % 2 === 1)
	const bbox = xs.length > 0 ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null
	return { ops: parts.join(' '), bbox }
}

function base64ToBytes(base64) {
	const binary = atob(base64.replace(/\s+/g, ''))
	const bytes = new Uint8Array(binary.length)
	for (let k = 0; k < binary.length; k++) {
		bytes[k] = binary.charCodeAt(k)
	}
	return bytes
}

/**
 * @param {string} svgText one page as served (sanitized or not - the
 *   sanitizer removes nothing MuseScore draws)
 * @param {{widthMm?: number, heightMm?: number}} [size] page size; default from the root element
 * @param {object} [options]
 * @param {(href: string) => Promise<?{kind:'jpeg'|'rgb', width:number, height:number, bytes:Uint8Array}>} [options.decodeImage]
 *   decodes a non-JPEG data URI (PNG, GIF, BMP) to RGB on white
 * @return {Promise<{widthPt:number, heightPt:number, content:string, xobjects:object, unsupported:string[]}>}
 */
export async function svgPageToPdf(svgText, size = {}, { decodeImage = null } = {}) {
	const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
	const root = doc.documentElement
	if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) {
		throw new Error('Not an SVG page.')
	}
	const unsupported = new Set()
	const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
	const mm = (attr) => {
		const m = String(root.getAttribute(attr) ?? '').match(/^([\d.]+)mm$/)
		return m ? Number(m[1]) : null
	}
	const widthMm = size.widthMm ?? mm('width') ?? 210
	const heightMm = size.heightMm ?? mm('height') ?? 297
	const [minX, minY, vbW, vbH] = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0
		? vb
		: [0, 0, widthMm, heightMm]
	const widthPt = widthMm * PT_PER_MM
	const heightPt = heightMm * PT_PER_MM
	const sx = widthPt / vbW
	const sy = heightPt / vbH

	const ids = new Map()
	for (const el of root.getElementsByTagName('*')) {
		const id = el.getAttribute('id')
		if (id) {
			ids.set(id, el)
		}
	}

	const xobjects = {}
	const forms = new Map()
	let imageCount = 0
	const ops = [
		// SVG user space: origin top left, y down, in viewBox units.
		cm([sx, 0, 0, -sy, -minX * sx, heightPt + minY * sy]),
	]

	/**
	 * Own presentation attributes over the inherited ones.
	 *
	 * @param el
	 * @param inherited
	 */
	function styleOf(el, inherited) {
		const style = { ...inherited }
		const declarations = {}
		for (const attr of el.attributes) {
			declarations[attr.name] = attr.value
		}
		const inline = el.getAttribute('style')
		if (inline) {
			delete declarations.style
			for (const part of inline.split(';')) {
				const at = part.indexOf(':')
				if (at > 0) {
					declarations[part.slice(0, at).trim()] = part.slice(at + 1).trim()
				}
			}
		}
		for (const [name, value] of Object.entries(declarations)) {
			if (PAINT.includes(name)) {
				style[name] = value
			} else if (name in NEUTRAL) {
				if (String(value).trim() !== NEUTRAL[name]) {
					unsupported.add(`${el.localName}@${name}`)
				}
			} else if (!STRUCTURAL.has(name) && !name.startsWith('xmlns')) {
				unsupported.add(`${el.localName}@${name}`)
			}
		}
		return style
	}

	function color(value, el) {
		const rgb = parseColor(value)
		if (rgb === undefined) {
			unsupported.add(`${el.localName}@colour:${value}`)
			return [0, 0, 0]
		}
		return rgb
	}

	/**
	 * Colour and line operators plus the painting operator for a style.
	 *
	 * @param style
	 * @param el
	 * @param closedShape
	 * @return {{setup: string, paint: string}}
	 */
	function paintOf(style, el, closedShape) {
		const fill = color(style.fill, el)
		const stroke = color(style.stroke, el)
		const width = Number(style['stroke-width'])
		const strokes = stroke !== null && width > 0
		const evenodd = style['fill-rule'] === 'evenodd'
		const setup = []
		if (fill !== null) {
			setup.push(`${fill.map(n).join(' ')} rg`)
		}
		if (strokes) {
			setup.push(`${stroke.map(n).join(' ')} RG ${n(width)} w ${CAPS[style['stroke-linecap']] ?? 0} J ${JOINS[style['stroke-linejoin']] ?? 0} j ${n(Math.max(1, Number(style['stroke-miterlimit']) || 4))} M`)
		}
		let paint = 'n'
		if (fill !== null && strokes) {
			paint = evenodd ? 'B*' : 'B'
		} else if (fill !== null) {
			paint = evenodd ? 'f*' : 'f'
		} else if (strokes) {
			paint = closedShape ? 's' : 'S'
		}
		return { setup: setup.join(' '), paint }
	}

	/**
	 * The white page-sized area MuseScore lays under a page (M9) - paper is white already.
	 *
	 * @param bbox
	 * @param style
	 */
	function isBackground(bbox, style) {
		const fill = parseColor(style.fill)
		if (!bbox || !fill || fill.some((c) => c < 0.99) || parseColor(style.stroke) !== null) {
			return false
		}
		return bbox[0] <= minX + 1 && bbox[1] <= minY + 1 && bbox[2] >= minX + vbW - 1 && bbox[3] >= minY + vbH - 1
	}

	function shape(el, style) {
		const tag = el.localName
		let geometry
		if (tag === 'path') {
			geometry = pathToOps(el.getAttribute('d'))
			if (geometry.arcs) {
				unsupported.add('path@d:arc')
			}
		} else if (tag === 'polyline' || tag === 'polygon') {
			geometry = pointsToOps(el.getAttribute('points'), tag === 'polygon')
		} else if (tag === 'rect') {
			const x = Number(el.getAttribute('x') ?? 0)
			const y = Number(el.getAttribute('y') ?? 0)
			const w = Number(el.getAttribute('width') ?? 0)
			const h = Number(el.getAttribute('height') ?? 0)
			if (el.hasAttribute('rx') || el.hasAttribute('ry')) {
				unsupported.add('rect@rx')
			}
			geometry = { ops: `${n(x)} ${n(y)} ${n(w)} ${n(h)} re`, bbox: [x, y, x + w, y + h] }
		} else {
			const x1 = Number(el.getAttribute('x1') ?? 0)
			const y1 = Number(el.getAttribute('y1') ?? 0)
			const x2 = Number(el.getAttribute('x2') ?? 0)
			const y2 = Number(el.getAttribute('y2') ?? 0)
			geometry = { ops: `${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l`, bbox: [x1, y1, x2, y2] }
			style = { ...style, fill: 'none' }
		}
		if (!geometry.ops || isBackground(geometry.bbox, style)) {
			return
		}
		const { setup, paint } = paintOf(style, el, false)
		if (paint === 'n') {
			return
		}
		const transform = parseTransform(el.getAttribute('transform'))
		ops.push(`q ${transform ? cm(transform) + ' ' : ''}${setup} ${geometry.ops} ${paint} Q`)
	}

	function use(el, style) {
		const href = el.getAttributeNS(XLINK, 'href') ?? el.getAttribute('xlink:href') ?? el.getAttribute('href') ?? ''
		const target = href.startsWith('#') ? ids.get(href.slice(1)) : null
		if (!target || target.localName !== 'path') {
			unsupported.add(target ? `use→${target.localName}` : 'use@href')
			return
		}
		const useStyle = styleOf(target, style)
		const { setup, paint } = paintOf(useStyle, target, false)
		if (paint === 'n') {
			return
		}
		const key = `${href}|${paint}`
		let name = forms.get(key)
		if (name === undefined) {
			const geometry = pathToOps(target.getAttribute('d'))
			if (geometry.arcs) {
				unsupported.add('path@d:arc')
			}
			const pad = paint === 'f' || paint === 'f*' ? 0 : Number(useStyle['stroke-width']) || 0
			const bbox = geometry.bbox ?? [0, 0, 0, 0]
			name = `G${forms.size}`
			forms.set(key, name)
			xobjects[name] = {
				type: 'form',
				bbox: [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad],
				content: `${geometry.ops} ${paint}`,
			}
		}
		let matrix = parseTransform(el.getAttribute('transform')) ?? IDENTITY
		const x = Number(el.getAttribute('x') ?? 0)
		const y = Number(el.getAttribute('y') ?? 0)
		if (x !== 0 || y !== 0) {
			matrix = multiply(matrix, [1, 0, 0, 1, x, y])
		}
		const own = parseTransform(target.getAttribute('transform'))
		if (own) {
			matrix = multiply(matrix, own)
		}
		ops.push(`q ${cm(matrix)} ${setup} /${name} Do Q`)
	}

	async function image(el) {
		const href = el.getAttributeNS(XLINK, 'href') ?? el.getAttribute('xlink:href') ?? el.getAttribute('href') ?? ''
		const ratio = el.getAttribute('preserveAspectRatio')
		if (ratio && ratio !== 'none') {
			unsupported.add(`image@preserveAspectRatio:${ratio}`)
		}
		let data = null
		const jpeg = href.match(/^data:image\/jpeg;base64,(.*)$/s)
		if (jpeg) {
			const bytes = base64ToBytes(jpeg[1])
			const info = jpegInfo(bytes)
			data = info ? { kind: 'jpeg', width: info.width, height: info.height, bytes } : null
		} else if (href.startsWith('data:image/') && decodeImage) {
			data = await decodeImage(href)
		}
		if (!data) {
			unsupported.add('image')
			return
		}
		const name = `Im${imageCount++}`
		xobjects[name] = { type: 'image', ...data }
		const x = Number(el.getAttribute('x') ?? 0)
		const y = Number(el.getAttribute('y') ?? 0)
		const w = Number(el.getAttribute('width') ?? 0)
		const h = Number(el.getAttribute('height') ?? 0)
		const transform = parseTransform(el.getAttribute('transform'))
		// The image space has its first row at the top (y = 1); SVG space here
		// runs downwards, so the unit square is flipped back.
		ops.push(`q ${transform ? cm(transform) + ' ' : ''}${cm([w, 0, 0, -h, x, y + h])} /${name} Do Q`)
	}

	async function walk(el, inherited) {
		for (const child of el.children) {
			const tag = child.localName
			if (SKIPPED.has(tag)) {
				continue
			}
			if (tag === 'g') {
				const style = styleOf(child, inherited)
				const transform = parseTransform(child.getAttribute('transform'))
				if (transform) {
					ops.push(`q ${cm(transform)}`)
				}
				await walk(child, style)
				if (transform) {
					ops.push('Q')
				}
			} else if (tag === 'path' || tag === 'polyline' || tag === 'polygon' || tag === 'rect' || tag === 'line') {
				shape(child, styleOf(child, inherited))
			} else if (tag === 'use') {
				use(child, styleOf(child, inherited))
			} else if (tag === 'image') {
				styleOf(child, inherited)
				await image(child)
			} else {
				unsupported.add(tag)
			}
		}
	}

	await walk(root, styleOf(root, DEFAULT_STYLE))
	return { widthPt, heightPt, content: ops.join('\n'), xobjects, unsupported: [...unsupported].sort() }
}
