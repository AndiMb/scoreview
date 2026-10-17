import { describe, expect, it } from 'vitest'
import { capabilitiesOf, unavailableReason } from './capabilities.js'

const engineMeta = {
	hasLyrics: 'true',
	keySigs: [{ measure: 1, concertKey: -3, mode: 'minor' }],
	lyricSyllables: [{ elid: 0, staff: 0, voice: 0, verse: 0, syllabic: 'begin', text: 'Hal' }],
	noteSpellings: [{ elid: 0, staff: 0, voice: 0, tick: 0, notes: [[67, 15]] }],
	measureFacts: [{ measure: 1, tick: 0, sigN: 4, sigD: 4, ticks: 1920 }],
}
// So sieht meta.json auf dem Sidecar aus (gemessen M-B/M-F): flacher
// Liedtext, keine Listen, keine Tonarten.
const sidecarMeta = { hasLyrics: 'true', lyrics: 'Hal le lu ja', keysig: -3 }

describe('capabilitiesOf', () => {
	it('erkennt alles, was die Engine liefert', () => {
		expect(capabilitiesOf({ meta: engineMeta, svgHasSegIds: true }))
			.toEqual({ segIds: true, lyrics: true, spellings: true, keyModes: true, meters: true })
	})

	it('liefert auf Sidecar-Artefakten nichts davon', () => {
		expect(capabilitiesOf({ meta: sidecarMeta, svgHasSegIds: false }))
			.toEqual({ segIds: false, lyrics: false, spellings: false, keyModes: false, meters: false })
	})

	it('counts meters only with a tick on every spelling (engine before v4.7.5-engine.5)', () => {
		const older = { ...engineMeta, noteSpellings: [{ elid: 0, staff: 0, voice: 0, notes: [[67, 15]] }] }
		expect(capabilitiesOf({ meta: older, svgHasSegIds: true }).meters).toBe(false)
		expect(capabilitiesOf({ meta: { ...engineMeta, measureFacts: [] }, svgHasSegIds: true }).meters).toBe(false)
	})

	it('zaehlt eine Tonart ohne Modus nicht als Modus', () => {
		const cap = capabilitiesOf({ meta: { keySigs: [{ measure: 1, concertKey: 0, mode: null }] } })
		expect(cap.keyModes).toBe(false)
	})

	it('vertraegt fehlende Eingaben', () => {
		expect(capabilitiesOf()).toEqual({ segIds: false, lyrics: false, spellings: false, keyModes: false, meters: false })
	})

	it('wertet eine leere Silbenliste nicht als Liedtext', () => {
		expect(capabilitiesOf({ meta: { lyricSyllables: [] }, svgHasSegIds: true }).lyrics).toBe(false)
	})
})

describe('unavailableReason', () => {
	const all = capabilitiesOf({ meta: engineMeta, svgHasSegIds: true })
	const none = capabilitiesOf({ meta: sidecarMeta, svgHasSegIds: false })

	it('laesst Seiten und Systemband immer zu', () => {
		expect(unavailableReason(none, 'pages', sidecarMeta)).toBeNull()
		expect(unavailableReason(none, 'band', sidecarMeta)).toBeNull()
	})

	it('laesst Liedtext und Tonnamen mit Engine-Daten zu', () => {
		expect(unavailableReason(all, 'lyrics', engineMeta)).toBeNull()
		expect(unavailableReason(all, 'noteNames', engineMeta)).toBeNull()
	})

	it('nennt fehlende Daten auf Sidecar-Artefakten', () => {
		expect(unavailableReason(none, 'lyrics', sidecarMeta)).toBe('no-data')
		expect(unavailableReason(none, 'noteNames', sidecarMeta)).toBe('no-data')
		expect(unavailableReason(none, 'counts', sidecarMeta)).toBe('no-data')
	})

	it('allows beat numbers only with meters, spellings and segment ids', () => {
		expect(unavailableReason(all, 'counts', engineMeta)).toBeNull()
		const noMeters = capabilitiesOf({ meta: { ...engineMeta, measureFacts: undefined }, svgHasSegIds: true })
		expect(unavailableReason(noMeters, 'counts', engineMeta)).toBe('no-data')
	})

	it('sagt, wenn die Partitur keinen Liedtext hat', () => {
		const meta = { ...engineMeta, hasLyrics: 'false', lyricSyllables: [] }
		const cap = capabilitiesOf({ meta, svgHasSegIds: true })
		expect(unavailableReason(cap, 'lyrics', meta)).toBe('no-lyrics')
	})

	it('erkennt die weggelassene Liste einer zu grossen Partitur', () => {
		const meta = { ...engineMeta, lyricSyllables: undefined }
		const cap = capabilitiesOf({ meta, svgHasSegIds: true })
		expect(unavailableReason(cap, 'lyrics', meta)).toBe('too-large')
	})

	it('sperrt Unbekanntes', () => {
		expect(unavailableReason(all, 'karaoke', engineMeta)).toBe('no-data')
	})
})
