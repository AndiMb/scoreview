import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseMidiNotes } from './midiNotes.js'

// Das MIDI der Testpartitur m1-test (selbst erstellt, abgeleitet aus repeat-test):
// 5 Takte 4/4 bei 120 BPM, Takt 1 und 2 wiederholt (Takt 2 ist die erste
// Volta), Studierbuchstaben A/B/C in Takt 1/3/4, c-Moll ab Takt 1, D-Dur ab
// Takt 4. Ausgerollte Taktfolge laut measures.json: 1, 2, 1, 3, 4, 5 bei
// 0/2000/4000/6000/8000/10000 ms.
const fixture = readFileSync(new URL('./__fixtures__/m1-test.mid', import.meta.url))

/**
 * Bytes aus Hex-Text; alles ab `#` bis Zeilenende ist Kommentar. So bleibt
 * jedes MIDI-Ereignis eine lesbare Zeile.
 *
 * @param {string} text
 * @return {number[]}
 */
function hex(text) {
	return text
		.replace(/#.*$/gm, '')
		.split(/\s+/)
		.filter(Boolean)
		.map((byte) => Number.parseInt(byte, 16))
}

/**
 * Baut eine minimale SMF-Datei (Format 0, eine Spur) um die Rohbytes einer
 * Spur.
 *
 * @param {string} track Hex-Text der Spur
 * @return {Uint8Array}
 */
function smf(track) {
	const bytes = hex(track)
	const len = bytes.length
	const header = hex('4d 54 68 64  00 00 00 06  00 00  00 01  01 e0') // MThd, Format 0, 1 Spur, 480 Ticks je Viertel
	const chunk = [...hex('4d 54 72 6b'), (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]
	return new Uint8Array([...header, ...chunk, ...bytes])
}

describe('parseMidiNotes an der Testpartitur m1-test', () => {
	const midi = parseMidiNotes(fixture)

	it('liest alle Noten mit ausgerollten Wiederholungen', () => {
		// 8 + 4 + 4 + 4 + 4 Viertel: Takt 1-2, Takt 1 erneut, 3, 4, 5.
		expect(midi.notes).toHaveLength(24)
		expect(midi.durationMs).toBe(12000)
	})

	it('legt die Noten auf dieselbe Zeitachse wie timing.json', () => {
		// timing.json der Testpartitur: Segmente alle 500 ms.
		expect(midi.notes.slice(0, 4).map((n) => n.onMs)).toEqual([0, 500, 1000, 1500])
		expect(midi.notes[0]).toMatchObject({ pitch: 60, channel: 0, track: 0 })
		// Der zweite Durchgang von Takt 1 beginnt bei 4000 ms wieder mit c'.
		expect(midi.notes[8]).toMatchObject({ onMs: 4000, pitch: 60 })
	})

	it('liefert das Ende jeder Note vor dem naechsten Einsatz', () => {
		for (const note of midi.notes) {
			expect(note.offMs).toBeGreaterThan(note.onMs)
			expect(note.offMs - note.onMs).toBeLessThanOrEqual(500)
		}
	})

	it('liest die Studierbuchstaben als Marker, bei Wiederholung doppelt', () => {
		expect(midi.markers).toEqual([
			{ timeMs: 0, text: 'A' },
			{ timeMs: 4000, text: 'A' },
			{ timeMs: 6000, text: 'B' },
			{ timeMs: 8000, text: 'C' },
		])
	})

	it('liest die Tonarten mit Vorzeichen, der Modus steht immer auf Dur', () => {
		expect(midi.keySigs).toEqual([
			{ timeMs: 0, sf: -3, mi: 0 },
			{ timeMs: 4000, sf: -3, mi: 0 },
			{ timeMs: 8000, sf: 2, mi: 0 },
		])
	})

	it('nimmt auch einen ArrayBuffer', () => {
		const buffer = fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength)
		expect(parseMidiNotes(buffer).notes).toHaveLength(24)
	})
})

describe('parseMidiNotes mit Tempokarte und Randfaellen', () => {
	it('rechnet einen Tempowechsel mitten im Stueck um', () => {
		const bytes = smf(`
			00 90 3c 64           # c' bei Tick 0
			83 60 80 3c 00        # aus nach 480 Ticks = 500 ms bei 120 BPM
			00 ff 51 03 0f 42 40  # Tempo 1 000 000 us = 60 BPM
			00 90 3e 64
			83 60 80 3e 00        # 480 Ticks bei 60 BPM = 1000 ms
			00 ff 2f 00
		`)
		const { notes, durationMs } = parseMidiNotes(bytes)
		expect(notes).toEqual([
			{ onMs: 0, offMs: 500, pitch: 60, channel: 0, track: 0, velocity: 100 },
			{ onMs: 500, offMs: 1500, pitch: 62, channel: 0, track: 0, velocity: 100 },
		])
		expect(durationMs).toBe(1500)
	})

	it('versteht Laufstatus und Note-on mit Anschlag 0 als Ende', () => {
		const bytes = smf(`
			00 93 40 50     # Kanal 3
			83 60 40 00     # Laufstatus, Anschlag 0 = aus
			00 43 50
			83 60 43 00
			00 ff 2f 00
		`)
		const { notes } = parseMidiNotes(bytes)
		expect(notes.map((n) => [n.onMs, n.offMs, n.pitch, n.channel])).toEqual([
			[0, 500, 64, 3],
			[500, 1000, 67, 3],
		])
	})

	it('beendet eine Note ohne Note-off mit der Spur', () => {
		const bytes = smf(`
			00 90 3c 64
			87 40 ff 2f 00  # Spurende nach 960 Ticks
		`)
		expect(parseMidiNotes(bytes).notes[0]).toMatchObject({ onMs: 0, offMs: 1000 })
	})

	it('liest eine Moll-Tonart und negative Vorzeichen', () => {
		const bytes = smf(`
			00 ff 59 02 fd 01  # 3 b, Moll
			00 ff 2f 00
		`)
		expect(parseMidiNotes(bytes).keySigs).toEqual([{ timeMs: 0, sf: -3, mi: 1 }])
	})

	it('liest Marker als UTF-8 und schneidet Leerraum ab', () => {
		// " Ü1 " in UTF-8: 20 c3 9c 31 20
		const bytes = smf('00 ff 06 05 20 c3 9c 31 20  00 ff 2f 00')
		expect(parseMidiNotes(bytes).markers).toEqual([{ timeMs: 0, text: 'Ü1' }])
	})

	it('liefert bei abgeschnittener Spur, was lesbar war', () => {
		// Die Laengenangabe im Kopf stimmt, der Inhalt endet mitten im Ereignis.
		const bytes = smf('00 90 3c 64  83 60 80 3c 00  00 90')
		expect(parseMidiNotes(bytes).notes).toHaveLength(1)
	})

	it('ueberspringt SysEx-Ereignisse', () => {
		const bytes = smf(`
			00 f0 03 7e 7f f7
			00 90 3c 64  83 60 80 3c 00
			00 ff 2f 00
		`)
		expect(parseMidiNotes(bytes).notes).toHaveLength(1)
	})

	it('wirft bei einer Datei, die kein MIDI ist', () => {
		expect(() => parseMidiNotes(new Uint8Array(hex('01 02 03 04')))).toThrow()
	})
})
