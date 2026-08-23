import { describe, expect, it } from 'vitest'
import { computeCountInDelaysMs, estimateBeatsInMeasure } from './metronome.js'

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
