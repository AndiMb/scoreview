import { describe, expect, it } from 'vitest'
import { computeCountInDelaysMs, estimateBeatsInMeasure, resolveBeatInMeasure } from './metronome.js'

describe('estimateBeatsInMeasure', () => {
	it('schätzt 4 Schläge für einen Takt bei Viertel = 80 (wwimf-Messwert, 4/4)', () => {
		// Ein 4/4-Takt bei 80bpm dauert 4 * 60000/80 = 3000ms.
		expect(estimateBeatsInMeasure(3000, 80)).toBe(4)
	})

	it('rundet auf die nächste ganze Schlagzahl', () => {
		expect(estimateBeatsInMeasure(2950, 80)).toBe(4)
	})

	it('nimmt 4/4 an, wenn keine Tempoangabe vorliegt (M8: tempo kann 0 sein)', () => {
		expect(estimateBeatsInMeasure(3000, 0)).toBe(4)
	})

	it('nimmt 4/4 an, wenn die Taktdauer unbekannt/0 ist', () => {
		expect(estimateBeatsInMeasure(0, 80)).toBe(4)
	})

	it('liefert mindestens 1', () => {
		expect(estimateBeatsInMeasure(100, 80)).toBeGreaterThanOrEqual(1)
	})
})

describe('computeCountInDelaysMs', () => {
	it('verteilt die Klicks gleichmäßig ab 0', () => {
		expect(computeCountInDelaysMs(4, 500)).toEqual([0, 500, 1000, 1500])
	})

	it('liefert mindestens einen Klick', () => {
		expect(computeCountInDelaysMs(0, 500)).toEqual([0])
	})
})

describe('resolveBeatInMeasure', () => {
	// 4/4-Takt bei Viertel = 80: 3000ms, Schläge alle 750ms (wwimf-Messwert).
	const measure = [12000, 15000]

	it('liefert den Taktanfang mit Index 0', () => {
		expect(resolveBeatInMeasure(...measure, 12000, 80)).toEqual({ index: 0, timeMs: 12000 })
	})

	it('liefert den laufenden Schlag samt seiner exakten Zeit', () => {
		expect(resolveBeatInMeasure(...measure, 13600, 80)).toEqual({ index: 2, timeMs: 13500 })
	})

	it('bleibt am letzten Schlag, wenn die Zeit über den Takt hinausläuft', () => {
		// Kommt durch den Vorlauf vor (ScoreViewer.vue fragt leicht in die
		// Zukunft) - der nächste Takt bringt dann seinen eigenen Anfang mit.
		expect(resolveBeatInMeasure(...measure, 15200, 80)).toEqual({ index: 3, timeMs: 14250 })
	})

	it('klickt auf Wunsch nur den Taktanfang', () => {
		expect(resolveBeatInMeasure(...measure, 13600, 80, false)).toEqual({ index: 0, timeMs: 12000 })
	})

	it('liefert null, wenn der Takt keine Dauer hat', () => {
		expect(resolveBeatInMeasure(12000, 12000, 12000, 80)).toBeNull()
	})
})
