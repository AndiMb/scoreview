import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createPdf, fmtNumber, jpegInfo, pdfString } from './pdfWriter.js'

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1')

/** Every xref entry must point at "<n> 0 obj" - recomputed from the bytes. */
function checkXref(bytes) {
	const text = latin1(bytes)
	const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/)[1])
	expect(text.slice(startxref, startxref + 5)).toBe('xref\n')
	const [, count] = text.slice(startxref).match(/^xref\n0 (\d+)\n/)
	const entries = text.slice(startxref).split('\n').slice(2, 2 + Number(count))
	expect(entries[0]).toBe('0000000000 65535 f ')
	entries.slice(1).forEach((entry, i) => {
		expect(entry).toMatch(/^\d{10} 00000 n $/)
		const offset = Number(entry.slice(0, 10))
		expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`)
	})
	return text
}

// A 2x1 baseline JPEG header: SOI, APP0, SOF0 (height 1, width 2, 3 components).
const TINY_JPEG = new Uint8Array([
	0xFF,
	0xD8,
	0xFF,
	0xE0,
	0x00,
	0x04,
	0x00,
	0x00,
	0xFF,
	0xC0,
	0x00,
	0x11,
	0x08,
	0x00,
	0x01,
	0x00,
	0x02,
	0x03,
	0x01,
	0x11,
	0x00,
	0x02,
	0x11,
	0x01,
	0x03,
	0x11,
	0x01,
	0xFF,
	0xD9,
])

describe('createPdf', () => {
	it('writes a one-page file whose xref offsets are right', async () => {
		const pdf = createPdf({ title: 'Aequale No. 1', producer: 'ScoreView test', compress: false })
		pdf.addPage({ widthPt: 595.276, heightPt: 841.89, content: '0 0 m 100 100 l S' })
		const text = checkXref(await pdf.finish())
		expect(text.startsWith('%PDF-1.4\n')).toBe(true)
		expect(text).toContain('/Type /Pages /Kids [4 0 R] /Count 1')
		expect(text).toContain('/MediaBox [0 0 595.276 841.89]')
		expect(text).toContain('/Title (Aequale No. 1) /Producer (ScoreView test)')
		expect(text).toContain('stream\n0 0 m 100 100 l S\nendstream')
		expect(text).not.toContain('/FlateDecode')
	})

	it('compresses streams with CompressionStream when asked', async () => {
		const pdf = createPdf({ compress: true })
		pdf.addPage({ widthPt: 100, heightPt: 100, content: '0 0 m 10 10 l S '.repeat(50) })
		const bytes = await pdf.finish()
		const text = checkXref(bytes)
		const match = text.match(/\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/)
		expect(match).not.toBeNull()
		const start = text.indexOf(match[0]) + match[0].length
		const body = Buffer.from(bytes.slice(start, start + Number(match[1])))
		expect(inflateSync(body).toString('latin1')).toBe('0 0 m 10 10 l S '.repeat(50))
	})

	it('writes uncompressed without CompressionStream', async () => {
		const original = globalThis.CompressionStream
		globalThis.CompressionStream = undefined
		try {
			const pdf = createPdf()
			pdf.addPage({ widthPt: 100, heightPt: 100, content: '0 0 m S' })
			const text = checkXref(await pdf.finish())
			expect(text).not.toContain('/FlateDecode')
		} finally {
			globalThis.CompressionStream = original
		}
	})

	it('writes forms and images as XObjects of their page', async () => {
		const pdf = createPdf({ compress: false })
		pdf.addPage({
			widthPt: 100,
			heightPt: 100,
			content: '/G0 Do /Im0 Do',
			xobjects: {
				G0: { type: 'form', bbox: [0, -3, 118, 147], content: '0 0 m 1 1 l f' },
				Im0: { type: 'image', kind: 'jpeg', bytes: TINY_JPEG },
				Im1: { type: 'image', kind: 'rgb', width: 1, height: 1, bytes: new Uint8Array([255, 0, 0]) },
			},
		})
		pdf.addPage({ widthPt: 100, heightPt: 100, content: '' })
		const text = checkXref(await pdf.finish())
		expect(text).toContain('/Count 2')
		expect(text).toContain('/Resources << /XObject << /G0 6 0 R /Im0 7 0 R /Im1 8 0 R >> >>')
		expect(text).toContain('/Subtype /Form /BBox [0 -3 118 147]')
		expect(text).toContain('/Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 29 /Filter /DCTDecode')
		expect(text).toContain('/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>')
	})
})

describe('jpegInfo', () => {
	it('reads size and components from the SOF marker', () => {
		expect(jpegInfo(TINY_JPEG)).toEqual({ width: 2, height: 1, components: 3, adobe: false })
		expect(jpegInfo(new Uint8Array([0x89, 0x50]))).toBeNull()
	})
})

describe('pdfString', () => {
	it('escapes ASCII and writes anything else as UTF-16', () => {
		expect(pdfString('a (b) \\c')).toBe('(a \\(b\\) \\\\c)')
		expect(pdfString('Bläser')).toBe('<FEFF0042006C00E4007300650072>')
	})
})

describe('fmtNumber', () => {
	it('rounds to three decimals without negative zero', () => {
		expect(fmtNumber(1.23456)).toBe('1.235')
		expect(fmtNumber(-0.0001)).toBe('0')
		expect(fmtNumber(42)).toBe('42')
	})
})
