import { describe, expect, it } from 'vitest'
import { A4_MM, pageBoxMm, pageCss, parseViewBox } from './printLayout.js'

describe('pageBoxMm', () => {
	it('takes the page format from meta.json (A4 portrait, as MuseScore writes it)', () => {
		expect(pageBoxMm({ pageFormat: { width: 210, height: 297, twosided: 'true' } })).toEqual({ widthMm: 210, heightMm: 297 })
	})

	it('keeps a landscape format as it is', () => {
		expect(pageBoxMm({ pageFormat: { width: 297, height: 210 } })).toEqual({ widthMm: 297, heightMm: 210 })
	})

	it('derives a missing height from the viewBox ratio of the first page', () => {
		const box = pageBoxMm({ pageFormat: { width: 210 } }, { width: 2100, height: 2970 })
		expect(box.widthMm).toBe(210)
		expect(box.heightMm).toBeCloseTo(297)
	})

	it('falls back to A4 without a usable width', () => {
		expect(pageBoxMm(null)).toEqual(A4_MM)
		expect(pageBoxMm({})).toEqual(A4_MM)
		expect(pageBoxMm({ pageFormat: { width: 0, height: 297 } })).toEqual(A4_MM)
		expect(pageBoxMm({ pageFormat: { width: 'x', height: 'y' } })).toEqual(A4_MM)
	})

	it('treats an implausible size as missing rather than printing on it', () => {
		expect(pageBoxMm({ pageFormat: { width: 21000, height: 29700 } })).toEqual(A4_MM)
		expect(pageBoxMm({ pageFormat: { width: 210 } }, { width: 1, height: 100 })).toEqual(A4_MM)
	})

	it('does not share the fallback object', () => {
		const a = pageBoxMm(null)
		a.widthMm = 1
		expect(A4_MM.widthMm).toBe(210)
	})
})

describe('pageCss', () => {
	it('writes the @page rule without margins', () => {
		expect(pageCss({ widthMm: 210, heightMm: 297 })).toBe('@page { size: 210mm 297mm; margin: 0; }')
	})

	it('rounds to two decimals', () => {
		expect(pageCss({ widthMm: 215.9, heightMm: 279.4000001 })).toBe('@page { size: 215.9mm 279.4mm; margin: 0; }')
	})
})

describe('parseViewBox', () => {
	it('reads the viewBox of a MuseScore page', () => {
		const svg = '<?xml version="1.0"?>\n<svg width="210mm" height="297mm"\n viewBox="0 0 2976.38 4209.45" xmlns="http://www.w3.org/2000/svg">'
		expect(parseViewBox(svg)).toEqual({ width: 2976.38, height: 4209.45 })
	})

	it('accepts commas and returns null without a viewBox', () => {
		expect(parseViewBox('<svg viewBox="0,0,100,50">')).toEqual({ width: 100, height: 50 })
		expect(parseViewBox('<svg width="10">')).toBeNull()
		expect(parseViewBox('')).toBeNull()
		expect(parseViewBox('<svg viewBox="0 0 0 10">')).toBeNull()
	})
})
