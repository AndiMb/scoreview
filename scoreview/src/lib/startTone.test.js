import { describe, expect, it } from 'vitest'
import { MODE_TONIC, MODE_VOICE, pickToneChannel, pitchName, resolveStartTone } from './startTone.js'

describe('startTone.pickToneChannel', () => {
	it('nimmt den ersten Kanal, den das Stueck nicht benutzt', () => {
		// Wie in duckwerk: Kanaele 0/2/3/1/6 in Spurreihenfolge.
		expect(pickToneChannel([[0], [2], [3], [1], [6]])).toBe(4)
	})

	it('ueberspringt das Schlagzeug auf Kanal 9', () => {
		expect(pickToneChannel([[0], [1], [2], [3], [4], [5], [6], [7], [8]])).toBe(10)
	})

	it('meldet null, wenn kein melodischer Kanal frei ist', () => {
		const alle = Array.from({ length: 16 }, (_, i) => [i]).filter(([c]) => c !== 9)
		expect(pickToneChannel(alle)).toBeNull()
	})

	it('kommt ohne Spurangaben aus', () => {
		expect(pickToneChannel(undefined)).toBe(0)
	})
})

describe('startTone.resolveStartTone', () => {
	const notes = [
		{ onMs: 0, offMs: 500, pitch: 67, channel: 0 },
		{ onMs: 0, offMs: 500, pitch: 60, channel: 1 },
		{ onMs: 1000, offMs: 1500, pitch: 69, channel: 0 },
	]
	const keys = [{ measure: 1, concertKey: -3, mode: 'minor' }, { measure: 4, concertKey: 2, mode: null }]

	it('spielt den Ton meiner Stimme an der Cursorposition', () => {
		expect(resolveStartTone({ mode: MODE_VOICE, notes, myChannels: [0], keys, measureNumber: 1, timeMs: 200 })).toEqual({ pitch: 67 })
		expect(resolveStartTone({ mode: MODE_VOICE, notes, myChannels: [1], keys, measureNumber: 1, timeMs: 200 })).toEqual({ pitch: 60 })
	})

	it('nimmt zwischen zwei Einsaetzen den naechsten', () => {
		expect(resolveStartTone({ mode: MODE_VOICE, notes, myChannels: [0], keys, measureNumber: 1, timeMs: 700 })).toEqual({ pitch: 69 })
	})

	it('nimmt den Einsatz, auf dem der Cursor steht, auch knapp davor', () => {
		const bindung = [
			{ onMs: 0, offMs: 1000, pitch: 66, channel: 0 },
			{ onMs: 1000, offMs: 2000, pitch: 65, channel: 0 },
		]
		expect(resolveStartTone({ mode: MODE_VOICE, notes: bindung, myChannels: [0], keys, measureNumber: 1, timeMs: 999.9 })).toEqual({ pitch: 65 })
		expect(resolveStartTone({ mode: MODE_VOICE, notes: bindung, myChannels: [0], keys, measureNumber: 1, timeMs: 900 })).toEqual({ pitch: 66 })
	})

	it('raet ohne gewaehlte Stimme nicht', () => {
		expect(resolveStartTone({ mode: MODE_VOICE, notes, myChannels: null, keys, measureNumber: 1, timeMs: 0 })).toEqual({ reason: 'noPart' })
	})

	it('meldet fehlende Noten statt eines erfundenen Tons', () => {
		expect(resolveStartTone({ mode: MODE_VOICE, notes: null, myChannels: [0], keys, measureNumber: 1, timeMs: 0 })).toEqual({ reason: 'noNotes' })
		expect(resolveStartTone({ mode: MODE_VOICE, notes, myChannels: [0], keys, measureNumber: 9, timeMs: 5000 })).toEqual({ reason: 'noNotes' })
	})

	it('spielt den Grundton der Tonart am Cursor - vor und nach einer Modulation verschieden', () => {
		const vorher = resolveStartTone({ mode: MODE_TONIC, notes, myChannels: null, keys, measureNumber: 3, timeMs: 0 })
		const nachher = resolveStartTone({ mode: MODE_TONIC, notes, myChannels: null, keys, measureNumber: 4, timeMs: 0 })
		// c-Moll (3 b) = C4, D-Dur ohne Modus = D4.
		expect(vorher).toEqual({ pitch: 60 })
		expect(nachher).toEqual({ pitch: 62 })
	})

	it('braucht fuer den Grundton keine Stimme, aber eine Tonart', () => {
		expect(resolveStartTone({ mode: MODE_TONIC, notes, myChannels: null, keys: [], measureNumber: 1, timeMs: 0 })).toEqual({ reason: 'noKey' })
	})
})

describe('startTone.pitchName', () => {
	it('nennt den Ton so, wie ihn die Vorzeichen schreiben', () => {
		expect(pitchName(63, -3)).toBe('E♭4')
		expect(pitchName(63, 2)).toBe('D♯4')
		expect(pitchName(63, null)).toBe('D♯4')
		expect(pitchName(60, 0)).toBe('C4')
		expect(pitchName(57, 0)).toBe('A3')
	})
})
