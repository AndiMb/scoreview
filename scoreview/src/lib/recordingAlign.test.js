import { describe, expect, it } from 'vitest'
import {
	captureToScoreMs,
	inputLatencyMs,
	playbackSchedule,
	recordingToScoreMs,
	scoreTimeAt,
	scoreToRecordingSec,
	tempoAfterListening,
} from './recordingAlign.js'

const anker = { contextTimeSec: 10, scoreMs: 4000 }

describe('inputLatencyMs', () => {
	it('addiert Spur- und Kontextlatenz', () => {
		expect(inputLatencyMs({ trackLatencySec: 0.02, baseLatencySec: 0.01 })).toBeCloseTo(30)
	})

	it('nimmt, was der Browser nennt, und nichts Kaputtes', () => {
		expect(inputLatencyMs({ trackLatencySec: undefined, baseLatencySec: 0.005 })).toBeCloseTo(5)
		expect(inputLatencyMs({ trackLatencySec: NaN, baseLatencySec: null })).toBe(0)
		expect(inputLatencyMs({ trackLatencySec: 5, baseLatencySec: 0 })).toBe(0)
	})
})

describe('scoreTimeAt', () => {
	it('laeuft mit dem Tempo', () => {
		expect(scoreTimeAt(11, anker, 1)).toBe(5000)
		expect(scoreTimeAt(11, anker, 0.5)).toBe(4500)
		expect(scoreTimeAt(9, anker, 1)).toBe(3000)
	})
})

describe('captureToScoreMs', () => {
	it('verschiebt um Aus- plus Eingangslatenz zurueck', () => {
		// Angekommen bei 11 s. Gesungen 30 ms frueher, zu dem, was 200 ms vor
		// dem Hoeren gerendert wurde: gerendert bei 10,77 s -> 4770 ms.
		const ms = captureToScoreMs({ captureContextTimeSec: 11, anchor: anker, tempoFactor: 1, outputLatencyMs: 200, inputLatencyMs: 30 })
		expect(ms).toBeCloseTo(4770)
	})

	it('rechnet die Latenz in Echtzeit, die Partitur im Tempo', () => {
		const ms = captureToScoreMs({ captureContextTimeSec: 11, anchor: anker, tempoFactor: 0.5, outputLatencyMs: 200, inputLatencyMs: 0 })
		// 0,8 s Echtzeit nach dem Anker, halbes Tempo -> 400 ms Partitur.
		expect(ms).toBeCloseTo(4400)
	})
})

describe('Rundreise Aufnahme <-> Partitur', () => {
	const aufnahme = { scoreStartMs: 1000, tempoFactor: 0.8, durationMs: 10000 }

	it('sind Umkehrungen', () => {
		expect(recordingToScoreMs(aufnahme, 2.5)).toBeCloseTo(3000)
		expect(scoreToRecordingSec(aufnahme, 3000)).toBeCloseTo(2.5)
	})
})

describe('playbackSchedule', () => {
	it('startet mitten in der Aufnahme an der passenden Stelle', () => {
		const aufnahme = { scoreStartMs: 1000, tempoFactor: 1, durationMs: 10000 }
		const plan = playbackSchedule({ recording: aufnahme, anchor: anker, tempoFactor: 1, leadSec: 0.05 })
		expect(plan.whenSec).toBeCloseTo(10.05)
		// Partitur bei 4050 ms, Aufnahme beginnt bei 1000 ms -> 3,05 s hinein.
		expect(plan.offsetSec).toBeCloseTo(3.05)
	})

	it('wartet, wenn die Aufnahme erst spaeter in der Partitur beginnt', () => {
		const aufnahme = { scoreStartMs: 6000, tempoFactor: 1, durationMs: 10000 }
		const plan = playbackSchedule({ recording: aufnahme, anchor: anker, tempoFactor: 1, leadSec: 0 })
		expect(plan.offsetSec).toBe(0)
		expect(plan.whenSec).toBeCloseTo(12)
	})

	it('liefert nichts hinter dem Ende', () => {
		const aufnahme = { scoreStartMs: 0, tempoFactor: 1, durationMs: 1000 }
		expect(playbackSchedule({ recording: aufnahme, anchor: anker, tempoFactor: 1 })).toBeNull()
	})

	it('trifft auch bei langsamem Tempo dieselbe Partiturstelle', () => {
		const aufnahme = { scoreStartMs: 0, tempoFactor: 0.5, durationMs: 20000 }
		const plan = playbackSchedule({ recording: aufnahme, anchor: anker, tempoFactor: 0.5, leadSec: 0 })
		// Partitur 4000 ms bei halbem Tempo = 8 s in die Aufnahme.
		expect(plan.offsetSec).toBeCloseTo(8)
		expect(recordingToScoreMs(aufnahme, plan.offsetSec)).toBeCloseTo(scoreTimeAt(plan.whenSec, anker, 0.5))
	})
})

describe('tempoAfterListening', () => {
	it('stellt das eigene Tempo wieder her', () => {
		expect(tempoAfterListening({ before: 1, listened: 0.75, current: 0.75 })).toBe(1)
	})

	it('laesst ein waehrend des Abhoerens umgestelltes Tempo stehen', () => {
		expect(tempoAfterListening({ before: 1, listened: 0.75, current: 0.9 })).toBeNull()
	})

	it('tut nichts, wenn beide Tempi gleich waren', () => {
		expect(tempoAfterListening({ before: 0.75, listened: 0.75, current: 0.75 })).toBeNull()
	})

	it('tut nichts ohne gemerktes Tempo', () => {
		expect(tempoAfterListening({ before: null, listened: 0.75, current: 0.75 })).toBeNull()
		expect(tempoAfterListening({ before: 1, listened: null, current: 1 })).toBeNull()
	})
})
