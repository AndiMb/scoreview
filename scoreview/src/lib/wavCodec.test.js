import { describe, expect, it } from 'vitest'
import { decodeWav, encodeWav, floatToInt16 } from './wavCodec.js'

describe('encodeWav', () => {
	it('schreibt den Kopf, den der Server erwartet (16 kHz, mono, 16 bit)', () => {
		const buffer = encodeWav([new Float32Array(16000)])
		const view = new DataView(buffer)
		const ascii = (o) => String.fromCharCode(...new Uint8Array(buffer, o, 4))
		expect(ascii(0)).toBe('RIFF')
		expect(ascii(8)).toBe('WAVE')
		expect(ascii(12)).toBe('fmt ')
		expect(view.getUint16(20, true)).toBe(1)
		expect(view.getUint16(22, true)).toBe(1)
		expect(view.getUint32(24, true)).toBe(16000)
		expect(view.getUint32(28, true)).toBe(32000)
		expect(view.getUint16(32, true)).toBe(2)
		expect(view.getUint16(34, true)).toBe(16)
		expect(ascii(36)).toBe('data')
		expect(view.getUint32(40, true)).toBe(32000)
		expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8)
	})

	it('klebt Bloecke in der richtigen Reihenfolge zusammen', () => {
		const buffer = encodeWav([Float32Array.of(0.5), Float32Array.of(-0.5, 1)])
		const { samples } = decodeWav(buffer)
		expect(samples).toHaveLength(3)
		expect(samples[0]).toBeCloseTo(0.5, 3)
		expect(samples[1]).toBeCloseTo(-0.5, 3)
		expect(samples[2]).toBeCloseTo(1, 3)
	})
})

describe('floatToInt16', () => {
	it('begrenzt statt ueberzulaufen - ein Knacken waere hoerbar', () => {
		expect([...floatToInt16(Float32Array.of(2, -2, 0))]).toEqual([32767, -32768, 0])
	})
})

describe('decodeWav', () => {
	it('Rundreise: ein Sinus kommt auf zwei Quantisierungsstufen genau zurueck', () => {
		const sinus = new Float32Array(1600).map((_, i) => 0.8 * Math.sin((2 * Math.PI * 440 * i) / 16000))
		const { sampleRate, samples } = decodeWav(encodeWav([sinus]))
		expect(sampleRate).toBe(16000)
		const fehler = Math.max(...samples.map((v, i) => Math.abs(v - sinus[i])))
		expect(fehler).toBeLessThan(2 / 32768)
	})

	it('mittelt Stereo auf mono und ueberspringt fremde Bloecke', () => {
		// Handgebaut: LIST-Block vor fmt, zwei Kanaele.
		const daten = new Int16Array([16384, -16384, 8192, 8192])
		const list = new Uint8Array([...'LIST'].map((c) => c.charCodeAt(0)).concat([2, 0, 0, 0, 65, 66]))
		const fmt = new DataView(new ArrayBuffer(24))
		;[...'fmt '].forEach((c, i) => fmt.setUint8(i, c.charCodeAt(0)))
		fmt.setUint32(4, 16, true)
		fmt.setUint16(8, 1, true)
		fmt.setUint16(10, 2, true)
		fmt.setUint32(12, 16000, true)
		fmt.setUint32(16, 64000, true)
		fmt.setUint16(20, 4, true)
		fmt.setUint16(22, 16, true)
		const kopf = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WAVE'].map((c) => c.charCodeAt(0))))
		const dataKopf = new DataView(new ArrayBuffer(8))
		;[...'data'].forEach((c, i) => dataKopf.setUint8(i, c.charCodeAt(0)))
		dataKopf.setUint32(4, daten.byteLength, true)
		const teile = [kopf, list, new Uint8Array(fmt.buffer), new Uint8Array(dataKopf.buffer), new Uint8Array(daten.buffer)]
		const gesamt = new Uint8Array(teile.reduce((s, t) => s + t.length, 0))
		let o = 0
		for (const t of teile) {
			gesamt.set(t, o)
			o += t.length
		}
		const { samples } = decodeWav(gesamt.buffer)
		expect(samples).toHaveLength(2)
		expect(samples[0]).toBeCloseTo(0, 5)
		expect(samples[1]).toBeCloseTo(0.25, 5)
	})

	it('lehnt Fremdes ab', () => {
		expect(() => decodeWav(new ArrayBuffer(10))).toThrow()
		expect(() => decodeWav(new TextEncoder().encode('x'.repeat(100)).buffer)).toThrow()
	})
})
