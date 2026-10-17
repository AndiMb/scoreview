// A minimal PDF 1.4 writer for the PDF file next to the score (A1b, E16).
//
// Why an own writer instead of a library: the release package sits about
// 200 KB under the App Store limit of 20 MiB, and a browser PDF library
// (jsPDF + svg2pdf.js, pdf-lib) weighs twice that. What a score page needs
// is small - vector paths with matrices, glyph forms and the odd embedded
// image, no fonts, no text layout - so the writer knows exactly that and
// nothing more. The translation of the SVG lives in svgToPdf.js; this file
// only knows PDF objects.
//
// Pure apart from CompressionStream, which is optional: without it (older
// browsers, a test that asks for it) the streams are written uncompressed -
// larger, still correct.

const encoder = new TextEncoder()

/**
 * Width, height and colour components of a baseline or progressive JPEG,
 * read from its SOF marker - a PDF needs them in the image dictionary, and
 * DCTDecode takes the file unchanged.
 *
 * @param {Uint8Array} bytes
 * @return {?{width:number, height:number, components:number, adobe:boolean}}
 */
export function jpegInfo(bytes) {
	if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
		return null
	}
	let adobe = false
	let i = 2
	while (i + 4 <= bytes.length) {
		if (bytes[i] !== 0xFF) {
			i++
			continue
		}
		const marker = bytes[i + 1]
		if (marker === 0xFF) {
			i++
			continue
		}
		if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
			i += 2
			continue
		}
		const length = (bytes[i + 2] << 8) | bytes[i + 3]
		if (marker === 0xEE) {
			adobe = true
		}
		// SOF0..SOF15 without DHT (C4), JPG (C8) and DAC (CC).
		if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
			if (i + 9 >= bytes.length) {
				return null
			}
			return {
				height: (bytes[i + 5] << 8) | bytes[i + 6],
				width: (bytes[i + 7] << 8) | bytes[i + 8],
				components: bytes[i + 9],
				adobe,
			}
		}
		i += 2 + length
	}
	return null
}

/**
 * A text string for the Info dictionary: literal when it is plain ASCII,
 * otherwise UTF-16BE with byte order mark, as PDF 1.4 asks for anything
 * beyond PDFDocEncoding.
 *
 * @param {string} text
 * @return {string}
 */
export function pdfString(text) {
	const value = String(text ?? '')
	if (/^[\x20-\x7E]*$/.test(value)) {
		return '(' + value.replace(/[\\()]/g, (c) => '\\' + c) + ')'
	}
	let hex = 'FEFF'
	for (let i = 0; i < value.length; i++) {
		hex += value.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
	}
	return '<' + hex + '>'
}

async function deflate(bytes) {
	const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
	return new Uint8Array(await new Response(stream).arrayBuffer())
}

const COLOR_SPACES = { 1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK' }

/**
 * @param {object} [options]
 * @param {string} [options.title] document title (Info)
 * @param {string} [options.producer] producer, e.g. "ScoreView 1.18.0"
 * @param {boolean} [options.compress] FlateDecode for streams; default: when CompressionStream exists
 * @return {{addPage: (page: object) => void, finish: () => Promise<Uint8Array>, pageCount: () => number}}
 */
export function createPdf({ title = '', producer = '', compress } = {}) {
	const flate = compress ?? (typeof CompressionStream !== 'undefined')
	const pages = []

	/**
	 * One page. `content` is the page's content stream in default user space
	 * (points, origin bottom left). XObjects are per page: glyph forms come
	 * from the page's own <defs>, images from its own <image> elements.
	 *
	 * @param {object} page
	 * @param {number} page.widthPt
	 * @param {number} page.heightPt
	 * @param {string} page.content
	 * @param {object} [page.xobjects] name -> {type: 'form', bbox: number[4], content: string}
	 *   | {type: 'image', kind: 'jpeg'|'rgb', width: number, height: number, bytes: Uint8Array}
	 */
	function addPage({ widthPt, heightPt, content, xobjects = {} }) {
		pages.push({ widthPt, heightPt, content, xobjects })
	}

	async function stream(bytes, { allowFlate = true } = {}) {
		if (flate && allowFlate) {
			return { bytes: await deflate(bytes), filter: '/FlateDecode' }
		}
		return { bytes, filter: null }
	}

	async function finish() {
		// Objects 1-3 are fixed; everything else is numbered in page order.
		const objects = []
		const reserve = () => {
			objects.push(null)
			return objects.length
		}
		const catalogId = reserve()
		const pagesId = reserve()
		const infoId = reserve()
		const pageIds = []

		for (const page of pages) {
			const pageId = reserve()
			const contentId = reserve()
			pageIds.push(pageId)
			const refs = []
			for (const [name, xo] of Object.entries(page.xobjects)) {
				const id = reserve()
				refs.push(`/${name} ${id} 0 R`)
				if (xo.type === 'form') {
					const s = await stream(encoder.encode(xo.content))
					const bbox = xo.bbox.map(fmtNumber).join(' ')
					objects[id - 1] = { dict: `/Type /XObject /Subtype /Form /BBox [${bbox}]`, ...s }
				} else if (xo.kind === 'jpeg') {
					const info = jpegInfo(xo.bytes)
					const components = info?.components ?? 3
					const space = COLOR_SPACES[components] ?? '/DeviceRGB'
					// Adobe CMYK JPEGs are stored inverted (Photoshop writes them so).
					const decode = components === 4 && info?.adobe ? ' /Decode [1 0 1 0 1 0 1 0]' : ''
					objects[id - 1] = {
						dict: `/Type /XObject /Subtype /Image /Width ${info?.width ?? xo.width} /Height ${info?.height ?? xo.height} /ColorSpace ${space} /BitsPerComponent 8${decode}`,
						bytes: xo.bytes,
						filter: '/DCTDecode',
					}
				} else {
					const s = await stream(xo.bytes)
					objects[id - 1] = {
						dict: `/Type /XObject /Subtype /Image /Width ${xo.width} /Height ${xo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8`,
						...s,
					}
				}
			}
			const resources = refs.length > 0 ? `/Resources << /XObject << ${refs.join(' ')} >> >>` : '/Resources << >>'
			objects[pageId - 1] = {
				dict: `/Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${fmtNumber(page.widthPt)} ${fmtNumber(page.heightPt)}] ${resources} /Contents ${contentId} 0 R`,
			}
			objects[contentId - 1] = await stream(encoder.encode(page.content))
		}

		objects[catalogId - 1] = { dict: `/Type /Catalog /Pages ${pagesId} 0 R` }
		objects[pagesId - 1] = { dict: `/Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length}` }
		objects[infoId - 1] = { dict: `/Title ${pdfString(title)} /Producer ${pdfString(producer)}` }

		const chunks = []
		let offset = 0
		const push = (part) => {
			const bytes = typeof part === 'string' ? encoder.encode(part) : part
			chunks.push(bytes)
			offset += bytes.length
		}
		// The binary comment tells transfer tools that the file is not text.
		push('%PDF-1.4\n')
		push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]))
		const offsets = []
		objects.forEach((obj, index) => {
			offsets.push(offset)
			if (obj.bytes) {
				const filter = obj.filter ? ` /Filter ${obj.filter}` : ''
				push(`${index + 1} 0 obj\n<< ${obj.dict ? obj.dict + ' ' : ''}/Length ${obj.bytes.length}${filter} >>\nstream\n`)
				push(obj.bytes)
				push('\nendstream\nendobj\n')
			} else {
				push(`${index + 1} 0 obj\n<< ${obj.dict} >>\nendobj\n`)
			}
		})
		const xrefOffset = offset
		let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
		for (const value of offsets) {
			xref += `${String(value).padStart(10, '0')} 00000 n \n`
		}
		push(xref)
		push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

		const out = new Uint8Array(offset)
		let at = 0
		for (const chunk of chunks) {
			out.set(chunk, at)
			at += chunk.length
		}
		return out
	}

	return { addPage, finish, pageCount: () => pages.length }
}

/**
 * A number for a PDF operand: at most three decimals, no exponent, no "-0".
 *
 * @param {number} value
 * @return {string}
 */
export function fmtNumber(value) {
	const rounded = Math.round(value * 1000) / 1000
	if (rounded === 0 || !Number.isFinite(rounded)) {
		return '0'
	}
	return String(rounded)
}
