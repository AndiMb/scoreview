import { describe, expect, it } from 'vitest'
import { MAX_NAME_LENGTH, practiceTrackName, sanitize } from './practiceTrackName.js'

const labels = { fullMix: 'Gesamtmischung', coach: 'Coach', loop: 'Ausschnitt' }

describe('practiceTrackName', () => {
	it('nennt Titel und Stimme', () => {
		expect(practiceTrackName({ title: 'Ave verum', part: 'Tenor' }, labels)).toBe('Ave verum – Tenor.mp3')
	})

	it('nennt die Gesamtmischung ohne Stimme', () => {
		expect(practiceTrackName({ title: 'Ave verum', part: null }, labels)).toBe('Ave verum – Gesamtmischung.mp3')
	})

	it('haengt Coach, Tempo, Transposition und Ausschnitt an', () => {
		expect(practiceTrackName({ title: 'Ave verum', part: 'Tenor', coach: true, tempoPercent: 80, transpose: -2, loop: true }, labels))
			.toBe('Ave verum – Tenor (Coach, 80 %, −2, Ausschnitt).mp3')
		expect(practiceTrackName({ title: 'X', part: 'Alt', transpose: 3 }, labels)).toBe('X – Alt (+3).mp3')
	})

	it('nennt Coach nicht ohne Stimme', () => {
		expect(practiceTrackName({ title: 'X', part: null, coach: true }, labels)).toBe('X – Gesamtmischung.mp3')
	})

	it('laesst Originaltempo weg, auch gerundet', () => {
		expect(practiceTrackName({ title: 'X', part: 'Bass', tempoPercent: 100.2 }, labels)).toBe('X – Bass.mp3')
	})
})

describe('sanitize', () => {
	it('entfernt Pfadtrenner und Steuerzeichen', () => {
		expect(sanitize('AC/DC\\Live\u0007 Mix')).toBe('AC DC Live Mix')
	})

	it('behaelt Umlaute', () => {
		expect(sanitize('Übe-Track für Bässe')).toBe('Übe-Track für Bässe')
	})

	it('nimmt die Endung weg', () => {
		expect(sanitize('Lied.MP3')).toBe('Lied')
	})

	it('kuerzt auf die Hoechstlaenge', () => {
		expect([...sanitize('ä'.repeat(300))].length).toBe(MAX_NAME_LENGTH)
	})

	it('ersetzt Namen aus Punkten', () => {
		expect(sanitize('..')).toBe('Practice track')
		expect(sanitize(' . ')).toBe('Practice track')
	})
})

describe('Richtungszeichen', () => {
	it('fallen weg wie auf dem Server', () => {
		expect(sanitize('Bass‮gpj.mp3')).toBe('Bassgpj')
	})
})
