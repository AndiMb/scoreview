import { describe, expect, it } from 'vitest'
import { computeCountInDelaysMs, COUNT_IN_LEAD_S, estimateBeatsInMeasure, measureClicks, normalizeMetronomeMode, planCountIn, resolveBeatInMeasure } from './metronome.js'

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

describe('normalizeMetronomeMode', () => {
	it('maps the pre-1.16 booleans and rejects unknown values', () => {
		expect(normalizeMetronomeMode(true)).toBe('all')
		expect(normalizeMetronomeMode(false)).toBe('downbeat')
		expect(normalizeMetronomeMode(undefined)).toBe('all')
		expect(normalizeMetronomeMode('eighths')).toBe('eighths')
		expect(normalizeMetronomeMode('downbeat')).toBe('downbeat')
		expect(normalizeMetronomeMode('sixteenths')).toBe('all')
	})
})

describe('measureClicks', () => {
	// 4/4 at quarter = 80: 3000 ms, beats every 750 ms (wwimf measurement).
	const measure = [12000, 15000]

	it('clicks every estimated beat with the downbeat at level 0', () => {
		expect(measureClicks(...measure, 80, 'all')).toEqual([
			{ timeMs: 12000, level: 0 },
			{ timeMs: 12750, level: 1 },
			{ timeMs: 13500, level: 1 },
			{ timeMs: 14250, level: 1 },
		])
	})

	it('clicks only the downbeat in downbeat mode', () => {
		expect(measureClicks(...measure, 80, 'downbeat')).toEqual([{ timeMs: 12000, level: 0 }])
	})

	it('halves every beat in eighths mode, the halves at level 2', () => {
		const clicks = measureClicks(...measure, 80, 'eighths')
		expect(clicks).toHaveLength(8)
		expect(clicks.map((c) => c.level)).toEqual([0, 2, 1, 2, 1, 2, 1, 2])
		expect(clicks[1].timeMs).toBe(12375)
		expect(clicks[7].timeMs).toBe(14625)
	})

	it('keeps a 3/4 measure at three beats and six eighths', () => {
		expect(measureClicks(0, 2250, 80, 'all').map((c) => c.timeMs)).toEqual([0, 750, 1500])
		expect(measureClicks(0, 2250, 80, 'eighths')).toHaveLength(6)
	})

	it('divides a pickup measure evenly (the estimate rounds it to one beat)', () => {
		expect(measureClicks(0, 750, 80, 'all')).toEqual([{ timeMs: 0, level: 0 }])
		expect(measureClicks(0, 750, 80, 'eighths').map((c) => c.timeMs)).toEqual([0, 375])
	})

	it('takes beats and subdivision from a meter when given (6/8: two beats in three)', () => {
		const clicks = measureClicks(0, 1800, 120, 'eighths', { beats: 2, subdivisions: 3 })
		expect(clicks.map((c) => [c.timeMs, c.level])).toEqual([[0, 0], [300, 2], [600, 2], [900, 1], [1200, 2], [1500, 2]])
		expect(measureClicks(0, 1800, 120, 'all', { beats: 2, subdivisions: 3 }).map((c) => c.timeMs)).toEqual([0, 900])
	})

	it('understands the old booleans', () => {
		expect(measureClicks(...measure, 80, false)).toHaveLength(1)
		expect(measureClicks(...measure, 80, true)).toHaveLength(4)
	})

	it('returns nothing for a measure without duration', () => {
		expect(measureClicks(5, 5, 80)).toEqual([])
	})
})

describe('resolveBeatInMeasure', () => {
	// 4/4-Takt bei Viertel = 80: 3000ms, Schläge alle 750ms (wwimf-Messwert).
	const measure = [12000, 15000]

	it('liefert den Taktanfang mit Index 0', () => {
		expect(resolveBeatInMeasure(...measure, 12000, 80)).toEqual({ index: 0, timeMs: 12000, level: 0 })
	})

	it('liefert den laufenden Schlag samt seiner exakten Zeit', () => {
		expect(resolveBeatInMeasure(...measure, 13600, 80)).toEqual({ index: 2, timeMs: 13500, level: 1 })
	})

	it('bleibt am letzten Schlag, wenn die Zeit über den Takt hinausläuft', () => {
		// Kommt durch den Vorlauf vor (ScoreViewer.vue fragt leicht in die
		// Zukunft) - der nächste Takt bringt dann seinen eigenen Anfang mit.
		expect(resolveBeatInMeasure(...measure, 15200, 80)).toEqual({ index: 3, timeMs: 14250, level: 1 })
	})

	it('klickt auf Wunsch nur den Taktanfang', () => {
		expect(resolveBeatInMeasure(...measure, 13600, 80, 'downbeat')).toEqual({ index: 0, timeMs: 12000, level: 0 })
		expect(resolveBeatInMeasure(...measure, 13600, 80, false)).toEqual({ index: 0, timeMs: 12000, level: 0 })
	})

	it('finds the subdivision in eighths mode', () => {
		expect(resolveBeatInMeasure(...measure, 12400, 80, 'eighths')).toEqual({ index: 1, timeMs: 12375, level: 2 })
		expect(resolveBeatInMeasure(...measure, 12750, 80, 'eighths')).toEqual({ index: 2, timeMs: 12750, level: 1 })
	})

	it('stays on the downbeat for a time before the measure (backwards jump)', () => {
		expect(resolveBeatInMeasure(...measure, 11000, 80)).toEqual({ index: 0, timeMs: 12000, level: 0 })
	})

	it('liefert null, wenn der Takt keine Dauer hat', () => {
		expect(resolveBeatInMeasure(12000, 12000, 12000, 80)).toBeNull()
	})
})
