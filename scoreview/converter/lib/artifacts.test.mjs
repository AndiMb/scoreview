import { describe, expect, it } from 'vitest'
import { checkPromises, toPositions } from './artifacts.mjs'

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
		expect(details).toEqual({ pages: 1, events: 2, elements: 1, repeatedElids: 1 })
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
})
