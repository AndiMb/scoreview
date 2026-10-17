// @vitest-environment jsdom
//
// The cases follow the dialect measured on both conversion paths (engine
// and stock MuseScore in the sidecar) - see the header of svgToPdf.js.

import { describe, expect, it } from 'vitest'
import { parseColor, parseTransform, pathToOps, svgPageToPdf } from './svgToPdf.js'

function page(body, { viewBox = '0 0 1000 2000', width = '100mm', height = '200mm' } = {}) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.2" baseProfile="tiny">
<title>T</title><desc>D</desc>${body}</svg>`
}

// The base matrix of a 100 x 200 mm page with a 1000 x 2000 viewBox.
const PT = 100 * 72 / 25.4
const s = (PT / 1000)

const lines = (content) => content.split('\n')

describe('svgPageToPdf', () => {
	it('maps the viewBox onto the page in points and flips the y axis', async () => {
		const result = await svgPageToPdf(page(''))
		expect(result.widthPt).toBeCloseTo(283.465, 2)
		expect(result.heightPt).toBeCloseTo(566.929, 2)
		expect(lines(result.content)[0]).toBe(`${(Math.round(s * 1000) / 1000)} 0 0 -${Math.round(s * 1000) / 1000} 0 566.929 cm`)
		expect(result.unsupported).toEqual([])
	})

	it('takes the page size from the arguments over the root element', async () => {
		const result = await svgPageToPdf(page(''), { widthMm: 210, heightMm: 297 })
		expect(result.widthPt).toBeCloseTo(595.276, 2)
	})

	it('writes a stroked polyline (staff line) with its line attributes', async () => {
		const result = await svgPageToPdf(page('<polyline points="0,0 800,0" fill="none" stroke="#000000" stroke-width="9.094" stroke-linejoin="bevel"/>'))
		expect(lines(result.content)[1]).toBe('q 0 0 0 RG 9.094 w 0 J 2 j 4 M 0 0 m 800 0 l S Q')
	})

	it('closes and fills a polygon (beam) with even-odd', async () => {
		const result = await svgPageToPdf(page('<polygon points="1,2 3,2 3,4" fill-rule="evenodd" fill="#000000" stroke="none"/>'))
		expect(lines(result.content)[1]).toBe('q 0 0 0 rg 1 2 m 3 2 l 3 4 l h f* Q')
	})

	it('nests group matrices as q … cm … Q', async () => {
		const result = await svgPageToPdf(page('<g class="Note"><g transform="matrix(1 0 0 1 10 20)"><polyline points="0,0 1,0" fill="none" stroke="#000" stroke-width="2"/></g></g>'))
		expect(lines(result.content).slice(1)).toEqual([
			'q 1 0 0 1 10 20 cm',
			'q 0 0 0 RG 2 w 0 J 0 j 4 M 0 0 m 1 0 l S Q',
			'Q',
		])
	})

	it('draws a glyph use through one form per glyph, with translate and scale', async () => {
		const body = '<defs><path id="g0" d="M0 0L10 0L10 10Z"/></defs>'
			+ '<g transform="matrix(1 0 0 1 100 200)">'
			+ '<use xlink:href="#g0" transform="translate(2.5 0) scale(1.83 -1.83)" fill="#000000"/>'
			+ '<use xlink:href="#g0" transform="translate(30 0) scale(1.83 -1.83)" fill="#000000"/>'
			+ '</g>'
		const result = await svgPageToPdf(page(body))
		expect(lines(result.content).slice(1)).toEqual([
			'q 1 0 0 1 100 200 cm',
			'q 1.83 0 0 -1.83 2.5 0 cm 0 0 0 rg /G0 Do Q',
			'q 1.83 0 0 -1.83 30 0 cm 0 0 0 rg /G0 Do Q',
			'Q',
		])
		expect(result.xobjects).toEqual({ G0: { type: 'form', bbox: [0, 0, 10, 10], content: '0 0 m 10 0 l 10 10 l h f' } })
	})

	it('reads the sidecar form: path with comma matrix and class, white background skipped', async () => {
		const body = '<path class="" fill="#ffffff" fill-rule="evenodd" d="M0,0 L1000,0 L1000,2000 L0,2000 L0,0 "/>'
			+ '<path class="Note" transform="matrix(0.971429,0,0,0.971429,4641.63,1114.96)" fill="#000000" fill-rule="evenodd" d="M1,2 C3,4 5,6 7,8 L9,10 "/>'
			+ '<polyline class="StaffLines" fill="none" stroke="#000000" stroke-width="8.34" stroke-linejoin="bevel" stroke-miterlimit="2" points="0,5 10,5" />'
		const result = await svgPageToPdf(page(body))
		expect(lines(result.content).slice(1)).toEqual([
			'q 0.971 0 0 0.971 4641.63 1114.96 cm 0 0 0 rg 1 2 m 3 4 5 6 7 8 c 9 10 l f* Q',
			'q 0 0 0 RG 8.34 w 0 J 2 j 2 M 0 5 m 10 5 l S Q',
		])
		expect(result.unsupported).toEqual([])
	})

	it('fills only for fill without stroke, strokes only for fill="none", both for both', async () => {
		const both = await svgPageToPdf(page('<path d="M0 0L1 1" fill="#ff0000" stroke="#00f" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'))
		expect(lines(both.content)[1]).toBe('q 1 0 0 rg 0 0 1 RG 1 w 1 J 1 j 4 M 0 0 m 1 1 l B Q')
		const none = await svgPageToPdf(page('<path d="M0 0L1 1" fill="none" stroke="none"/>'))
		expect(lines(none.content)).toHaveLength(1)
	})

	it('inherits paint from a group, as SVG does', async () => {
		const result = await svgPageToPdf(page('<g fill="#ffffff"><polygon points="0,0 1,0 1,1"/></g>'))
		expect(lines(result.content)[1]).toBe('q 1 1 1 rg 0 0 m 1 0 l 1 1 l h f Q')
	})

	it('places a JPEG image as DCTDecode with the unit square flipped back', async () => {
		const jpeg = btoa(String.fromCharCode(0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x03, 0x00, 0x04, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xD9))
		const body = `<g transform="matrix(1 0 0 1 700 700)"><image x="0" y="0" width="1417" height="708" preserveAspectRatio="none" xlink:href="data:image/jpeg;base64,${jpeg}"/></g>`
		const result = await svgPageToPdf(page(body))
		expect(lines(result.content).slice(1)).toEqual([
			'q 1 0 0 1 700 700 cm',
			'q 1417 0 0 -708 0 708 cm /Im0 Do Q',
			'Q',
		])
		expect(result.xobjects.Im0).toMatchObject({ type: 'image', kind: 'jpeg', width: 4, height: 3 })
	})

	it('hands other images to decodeImage, with the sidecar transform and stroke attributes', async () => {
		const seen = []
		const decodeImage = async (href) => {
			seen.push(href.slice(0, 22))
			return { kind: 'rgb', width: 1, height: 1, bytes: new Uint8Array([0, 0, 0]) }
		}
		const body = '<image class="Image" fill="none" stroke="#000000" stroke-linecap="square" stroke-linejoin="bevel" transform="matrix(4,0,0,4,472.441,3542.3)" x="10" y="20" width="30" height="40" preserveAspectRatio="none" xlink:href="data:image/png;base64,iVBORw0KGgo="/>'
		const result = await svgPageToPdf(page(body), {}, { decodeImage })
		expect(seen).toEqual(['data:image/png;base64,'])
		expect(lines(result.content)[1]).toBe('q 4 0 0 4 472.441 3542.3 cm 30 0 0 -40 10 60 cm /Im0 Do Q')
		expect(result.unsupported).toEqual([])
	})

	it('reports an image it cannot decode instead of dropping it silently', async () => {
		const result = await svgPageToPdf(page('<image width="1" height="1" xlink:href="data:image/png;base64,AAAA"/>'))
		expect(result.unsupported).toEqual(['image'])
	})

	it('reports unknown elements and attributes once each', async () => {
		const body = '<text x="1" y="2">a</text><text>b</text><path d="M0 0L1 1" opacity="0.5" stroke="#000"/><path d="M0 0L1 1" opacity="1"/><clipPath id="c"/>'
		const result = await svgPageToPdf(page(body))
		expect(result.unsupported).toEqual(['clipPath', 'path@opacity', 'text'])
	})

	it('rejects text that is no SVG', async () => {
		await expect(svgPageToPdf('<html></html>')).rejects.toThrow('Not an SVG page.')
	})
})

describe('pathToOps', () => {
	it('turns quadratic segments into cubic ones (engine glyphs use Q)', () => {
		expect(pathToOps('M0 0Q3 3 6 0').ops).toBe('0 0 m 2 2 4 2 6 0 c')
	})

	it('resolves relative, H/V, S and T commands to absolute coordinates', () => {
		expect(pathToOps('m10 10 l5 0 h5 v5 z').ops).toBe('10 10 m 15 10 l 20 10 l 20 15 l h')
		expect(pathToOps('M0 0C0 1 1 1 1 0S2 -1 2 0').ops).toBe('0 0 m 0 1 1 1 1 0 c 1 -1 2 -1 2 0 c')
		expect(pathToOps('M0 0Q1 1 2 0T4 0').ops).toBe('0 0 m 0.667 0.667 1.333 0.667 2 0 c 2.667 -0.667 3.333 -0.667 4 0 c')
	})

	it('treats extra pairs after a moveto as linetos, and reports arcs', () => {
		expect(pathToOps('M0 0 1 1 2 2').ops).toBe('0 0 m 1 1 l 2 2 l')
		expect(pathToOps('M0 0A5 5 0 0 1 10 0').arcs).toBe(true)
	})

	it('reports the bounding box of all points', () => {
		expect(pathToOps('M-1 2L3 -4C5 6 7 8 9 1').bbox).toEqual([-1, -4, 9, 8])
	})
})

describe('parseTransform', () => {
	it('reads both matrix forms and composes a list left to right', () => {
		expect(parseTransform('matrix(1 0 0 1 5 6)')).toEqual([1, 0, 0, 1, 5, 6])
		expect(parseTransform('matrix(2,0,0,2,1,1)')).toEqual([2, 0, 0, 2, 1, 1])
		expect(parseTransform('translate(10 0) scale(2 -2)')).toEqual([2, 0, 0, -2, 10, 0])
		expect(parseTransform('')).toBeNull()
		expect(parseTransform('bogus(1)')).toBeNull()
	})
})

describe('parseColor', () => {
	it('reads the forms MuseScore writes and a few more', () => {
		expect(parseColor('#000000')).toEqual([0, 0, 0])
		expect(parseColor('#fff')).toEqual([1, 1, 1])
		expect(parseColor('rgb(255, 0, 0)')).toEqual([1, 0, 0])
		expect(parseColor('none')).toBeNull()
		expect(parseColor('papayawhip')).toBeUndefined()
	})
})
