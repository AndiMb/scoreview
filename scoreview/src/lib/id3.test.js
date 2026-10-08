import { describe, expect, it } from 'vitest'
import { id3v23, syncsafe, tagText } from './id3.js'

/** Liest die Frames eines v2.3-Kopfs zurueck - ein Gegenleser fuer den Test. */
function parse(bytes) {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]
	const frames = {}
	let o = 10
	while (o < 10 + size) {
		const id = String.fromCharCode(...bytes.slice(o, o + 4))
		const len = dv.getUint32(o + 4)
		frames[id] = bytes.slice(o + 10, o + 10 + len)
		o += 10 + len
	}
	return { size, frames }
}

function decodeUtf16(bytes) {
	expect([bytes[0], bytes[1]]).toEqual([0xFF, 0xFE])
	return new TextDecoder('utf-16le').decode(bytes.slice(2))
}

describe('id3v23', () => {
	it('schreibt Kopf und Groesse', () => {
		const tag = id3v23({ title: 'A' })
		expect([...tag.slice(0, 6)]).toEqual([0x49, 0x44, 0x33, 3, 0, 0])
		expect(parse(tag).size).toBe(tag.length - 10)
	})

	it('kodiert Umlaute als UTF-16', () => {
		const { frames } = parse(id3v23({ title: 'Übe-Track – Tenor', artist: 'Mozart', album: 'Ave verum' }))
		expect(frames.TIT2[0]).toBe(1)
		expect(decodeUtf16(frames.TIT2.slice(1))).toBe('Übe-Track – Tenor')
		expect(decodeUtf16(frames.TPE1.slice(1))).toBe('Mozart')
		expect(decodeUtf16(frames.TALB.slice(1))).toBe('Ave verum')
	})

	it('schreibt einen Kommentar mit Sprache', () => {
		const { frames } = parse(id3v23({ comment: 'Coach, 80 %', lang: 'deu' }))
		const c = frames.COMM
		expect(c[0]).toBe(1)
		expect(String.fromCharCode(c[1], c[2], c[3])).toBe('deu')
		// leere Beschreibung: BOM + 00 00, danach der Text
		expect([...c.slice(4, 8)]).toEqual([0xFF, 0xFE, 0, 0])
		expect(decodeUtf16(c.slice(8))).toBe('Coach, 80 %')
	})

	it('laesst Leeres weg', () => {
		expect(Object.keys(parse(id3v23({})).frames)).toEqual([])
	})
})

describe('syncsafe', () => {
	it('verteilt auf 7 Bit je Byte', () => {
		expect(syncsafe(0x7F)).toEqual([0, 0, 0, 0x7F])
		expect(syncsafe(0x80)).toEqual([0, 0, 1, 0])
		expect(syncsafe(1000000)).toEqual([0, 0x3D, 0x04, 0x40])
	})
})

describe('tagText', () => {
	it('entfernt Steuerzeichen und begrenzt die Laenge', () => {
		expect(tagText('Hal\u0000le\u0007luja')).toBe('Hal le luja')
		expect([...tagText('ä'.repeat(5000))].length).toBe(1000)
	})
})
