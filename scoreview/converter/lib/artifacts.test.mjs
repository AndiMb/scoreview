import { describe, expect, it } from 'vitest'
import { checkPromises, checkScoreFacts, toPositions } from './artifacts.mjs'

/**
 * Diese Umformung ist die Stelle, an der der lokale Konvertierungsweg das
 * Cache-Format der App treffen muss (docs/architecture.md E3). Trifft sie
 * daneben, ist das im Viewer nur als verrutschter Cursor oder als fehlende
 * Taktnavigation sichtbar - nie als Fehler.
 */
describe('toPositions', () => {
	const raw = {
		pageSize: { width: 10200, height: 13200 },
		elements: [
			{ id: 0, page: 0, x: 2175, y: 2148, sx: 162.03874348776716, sy: 2619.9325502203455 },
			{ id: 1, page: 1, x: 2725.006, y: 2148.004, sx: 162, sy: 2619 },
		],
		events: [
			{ elid: 1, position: 1500 },
			{ elid: 0, position: 0 },
		],
	}

	it('benennt sx/sy in w/h um und schluesselt Elemente nach id', () => {
		expect(toPositions(raw).elements).toEqual({
			0: { page: 0, x: 2175, y: 2148, w: 162.04, h: 2619.93 },
			1: { page: 1, x: 2725.01, y: 2148, w: 162, h: 2619 },
		})
	})

	it('macht aus position ein timeMs und sortiert nach Zeit', () => {
		// timingSync.js sucht in dieser Folge binaer - unsortiert waere der
		// Cursor still an der falschen Note.
		expect(toPositions(raw).events).toEqual([
			{ elid: 0, timeMs: 0 },
			{ elid: 1, timeMs: 1500 },
		])
	})

	it('haelt die Reihenfolge gleichzeitiger Events (M7: ausgerollte Wiederholungen)', () => {
		const events = toPositions({
			events: [{ elid: 7, position: 500 }, { elid: 3, position: 500 }, { elid: 9, position: 500 }],
		}).events
		expect(events.map((e) => e.elid)).toEqual([7, 3, 9])
	})

	it('vertraegt fehlende Felder, statt zu werfen', () => {
		expect(toPositions({})).toEqual({ events: [], elements: {} })
		expect(toPositions(null)).toEqual({ events: [], elements: {} })
	})
})

describe('checkPromises', () => {
	/** Ein Ergebnis, das alle Zusagen haelt - Ausgangspunkt jeder Abwandlung. */
	const healthy = () => ({
		pages: 1,
		midi: new Uint8Array([1, 2, 3]),
		meta: { pages: 1 },
		timing: {
			elements: { 0: { page: 0, x: 0, y: 0, w: 1, h: 1 } },
			events: [
				{ elid: 0, timeMs: 0 },
				{ elid: 0, timeMs: 1000 },
			],
		},
	})

	it('meldet nichts, wenn alles stimmt', () => {
		const { problems, details } = checkPromises(healthy())
		expect(problems).toEqual([])
		expect(details).toEqual({
			pages: 1,
			events: 2,
			elements: 1,
			repeatedElids: 1,
			// Ohne uebergebene Seiten bleibt M10 ungeprueft (siehe unten).
			markedSegments: 0,
			maxNoteOffset: 0,
		})
	})

	it('erkennt, dass Wiederholungen nicht mehr ausgerollt werden (M7)', () => {
		const result = healthy()
		result.timing.events = [{ elid: 0, timeMs: 0 }, { elid: 1, timeMs: 1000 }]
		expect(checkPromises(result).problems).toEqual([
			expect.stringContaining('M7'),
		])
	})

	it('erkennt nicht monoton steigende Zeiten', () => {
		const result = healthy()
		result.timing.events = [{ elid: 0, timeMs: 1000 }, { elid: 0, timeMs: 0 }]
		expect(checkPromises(result).problems).toContain('Event-Zeiten sind nicht monoton steigend')
	})

	it('meldet jede verletzte Zusage einzeln, damit ein Versionswechsel diagnostizierbar bleibt', () => {
		const { problems } = checkPromises({ pages: 0, midi: null, meta: {}, timing: { events: [], elements: {} } })
		expect(problems).toHaveLength(6)
	})

	// --- M10: die Kennungen im SVG ---------------------------------------
	//
	// Die Zahlen unten stammen aus der Selbsttest-Partitur gegen den Build
	// v4.7.4-scoreview.7: 20 Segmente, groesster Notenkopf-Versatz 0,93
	// SVG-Einheiten bei 107-162 Einheiten Segmentbreite.

	/** Eine Seite in der Form, die MuseScore mit den Kennungen liefert. */
	const seite = (inhalt) => `<svg viewBox="0 0 10200 13200">${inhalt}</svg>`

	it('nimmt die Kennungen ab, wenn Notenbild und Zeitachse zusammenpassen', () => {
		const result = healthy()
		result.svgs = [seite('<path class="Note seg-0 st-0 vc-0" d="M0.9,2148.8 C1 1"/>')]
		const { problems, details } = checkPromises(result)
		expect(problems).toEqual([])
		expect(details.markedSegments).toBe(1)
		expect(details.maxNoteOffset).toBe(0.9)
	})

	it('erkennt ein SVG ohne Kennungen (Stock-MuseScore oder alter Build)', () => {
		const result = healthy()
		result.svgs = [seite('<path class="Note" d="M0,0"/>')]
		expect(checkPromises(result).problems).toEqual([expect.stringContaining('M10')])
	})

	it('erkennt eine Kennung, zu der es kein Element gibt', () => {
		const result = healthy()
		result.svgs = [seite('<path class="Note seg-7 st-0 vc-0" d="M0,0"/>')]
		expect(checkPromises(result).problems).toEqual([
			expect.stringContaining('kein Element in spos'),
		])
	})

	it('erkennt eine um eins verschobene Nummerierung an der Lage des Notenkopfs', () => {
		// Der Fall, den die gemeinsame Nummerierung verhindern soll: die
		// Kennung ist bekannt, sitzt aber am falschen Notenkopf. Ohne die
		// Lageprobe faende das niemand - der Cursor laege dann dauerhaft ein
		// Segment daneben.
		const result = healthy()
		result.timing.elements = { 0: { page: 0, x: 1000, y: 0, w: 107, h: 900 } }
		result.svgs = [seite('<path class="Note seg-0 st-0 vc-0" d="M1300,500 C1 1"/>')]
		expect(checkPromises(result).problems).toEqual([
			expect.stringContaining('nicht auf ihrer Segmentposition'),
		])
	})

	it('haelt NoteDot fuer keinen Notenkopf', () => {
		// Ein Punkt sitzt rechts neben dem Kopf; als Notenkopf gezaehlt
		// wuerde er die Lageprobe grundlos reissen lassen.
		const result = healthy()
		result.timing.elements = { 0: { page: 0, x: 0, y: 0, w: 10, h: 900 } }
		result.svgs = [seite('<path class="NoteDot seg-0 st-0 vc-0" d="M500,0"/>')]
		const { problems, details } = checkPromises(result)
		expect(problems).toEqual([])
		expect(details.markedSegments).toBe(1)
		expect(details.maxNoteOffset).toBe(0)
	})

	it('liest die Notenkopf-Lage auch aus der Glyph-Form der scoreview-engine', () => {
		// Die Engine zeichnet Notenkoepfe als <use>-Referenz in einer Gruppe
		// mit Translations-Matrix statt als Pfad mit d="M x ..." - die
		// Lageprobe muss beide Schreibweisen lesen, sonst ist sie auf dem
		// Engine-Weg stillschweigend wirkungslos.
		const result = healthy()
		result.svgs = [seite('<g class="Note seg-0 st-0 vc-0">\n<g transform="matrix(1 0 0 1 0.9 2148.8)">\n<use xlink:href="#g4"/>\n</g>\n</g>')]
		const { problems, details } = checkPromises(result)
		expect(problems).toEqual([])
		expect(details.markedSegments).toBe(1)
		expect(details.maxNoteOffset).toBe(0.9)
	})

	it('erkennt die verschobene Nummerierung auch in der Glyph-Form', () => {
		const result = healthy()
		result.timing.elements = { 0: { page: 0, x: 1000, y: 0, w: 107, h: 900 } }
		result.svgs = [seite('<g class="Note seg-0 st-0 vc-0">\n<g transform="matrix(1 0 0 1 1300 500)">\n<use xlink:href="#g4"/>\n</g>\n</g>')]
		expect(checkPromises(result).problems).toEqual([
			expect.stringContaining('nicht auf ihrer Segmentposition'),
		])
	})
})

describe('checkScoreFacts', () => {
	/**
	 * So liefert die Engine die Testpartitur keys-marks-test.mscz - gemessen
	 * an scoreview-engine 4.7.5, Schluesselreihenfolge wie im Original.
	 */
	const engineMeta = () => ({
		measures: 5,
		keySigs: [
			{ concertKey: -3, measure: 1, mode: 'minor', tick: 0 },
			{ concertKey: 2, measure: 4, mode: 'major', tick: 5760 },
		],
		rehearsalMarks: [
			{ measure: 1, text: 'A', tick: 0 },
			{ measure: 3, text: 'B', tick: 3840 },
			{ measure: 4, text: 'C', tick: 5760 },
		],
	})

	it('nimmt c-Moll, den Wechsel nach D-Dur und A/B/C ab', () => {
		expect(checkScoreFacts(engineMeta())).toEqual({
			problems: [],
			details: { keySigs: 2, rehearsalMarks: 3 },
		})
	})

	it('meldet eine Engine ohne die Felder - der Fall Stock-MuseScore', () => {
		const { problems } = checkScoreFacts({ measures: 5 })
		expect(problems).toEqual([
			expect.stringContaining('keySigs'),
			expect.stringContaining('rehearsalMarks'),
		])
	})

	it('erkennt ein verlorenes Moll (mode null wie bei "unknown")', () => {
		const meta = engineMeta()
		meta.keySigs[0].mode = null
		expect(checkScoreFacts(meta).problems).toEqual([expect.stringContaining('c-Moll')])
	})

	it('erkennt Buchstaben mit Markup oder im falschen Takt', () => {
		const meta = engineMeta()
		meta.rehearsalMarks[1] = { measure: 2, text: '<b>B</b>', tick: 1920 }
		expect(checkScoreFacts(meta).problems).toEqual([expect.stringContaining('A@1,<b>B</b>@2,C@4')])
	})
})
