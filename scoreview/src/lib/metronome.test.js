import { describe, expect, it } from 'vitest'
import { computeCountInDelaysMs, COUNT_IN_LEAD_S, estimateBeatsInMeasure, planCountIn, resolveBeatInMeasure } from './metronome.js'

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

describe('planCountIn', () => {
	it('puts every click on one grid from a common base, after the lead', () => {
		const { clickAt } = planCountIn(10, [0, 500, 1000, 1500], 500)
		expect(clickAt[0]).toBeCloseTo(10 + COUNT_IN_LEAD_S)
		const gaps = clickAt.slice(1).map((t, i) => t - clickAt[i])
		gaps.forEach((g) => expect(g).toBeCloseTo(0.5))
	})

	it('starts playback one beat after the last click', () => {
		const { clickAt, playAt } = planCountIn(2, [0, 750, 1500], 750, 0.2)
		expect(playAt - clickAt[clickAt.length - 1]).toBeCloseTo(0.75)
		expect(playAt).toBeCloseTo(2 + 0.2 + 2.25)
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
