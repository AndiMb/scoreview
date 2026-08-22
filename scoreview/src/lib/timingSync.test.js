import { describe, expect, it } from 'vitest'
import { buildStepTimes, findStepIndex } from './timingSync.js'

// Diese Datei ist der Kern der Cursor-Synchronisation: ein Fehler hier
// äußert sich als Cursor, der zu weit springt oder hinter der Wiedergabe
// zurückbleibt - genau der Bug, der im Spike (main.js) erst live im
// Browser auffiel (Off-by-one bei currentIndex, Nearest-Neighbour-
// Snapping bei mpos). Diese Tests fixieren beide Lektionen.

describe('buildStepTimes', () => {
	it('übernimmt die Zeiten direkt, wenn Cursor-Schritte und Events exakt übereinstimmen', () => {
		const events = [{ elid: 0, timeMs: 0 }, { elid: 1, timeMs: 1000 }, { elid: 2, timeMs: 2500 }]
		const result = buildStepTimes(3, events)
		expect(result.exact).toBe(true)
		expect(result.times).toEqual([0, 1000, 2500])
	})

	it('interpoliert linear, wenn es mehr Cursor-Schritte als Events gibt', () => {
		// 2 Events (0ms, 1000ms), aber 3 Cursor-Schritte: der mittlere Schritt
		// muss zwischen die beiden Events fallen statt einem der beiden
		// Zeitstempel gleichzusetzen (das wäre Nearest-Neighbour-Snapping und
		// führt zu Mehrfach-Sprüngen, siehe Moduldoku).
		const events = [{ elid: 0, timeMs: 0 }, { elid: 1, timeMs: 1000 }]
		const result = buildStepTimes(3, events)
		expect(result.exact).toBe(false)
		expect(result.times).toEqual([0, 500, 1000])
	})

	it('liefert für jeden Schritt einen eigenen, streng monoton steigenden Zeitwert bei starkem Übergewicht der Cursor-Schritte', () => {
		// Regressionstest für den mpos-Fund aus Phase 1: 63 Events auf 357
		// Cursor-Schritte (reales Verhältnis aus dem Spike) darf keine zwei
		// Schritte auf denselben Zeitwert legen.
		const events = Array.from({ length: 63 }, (_, i) => ({ elid: i, timeMs: i * 3000 }))
		const result = buildStepTimes(357, events)
		for (let i = 1; i < result.times.length; i++) {
			expect(result.times[i]).toBeGreaterThan(result.times[i - 1])
		}
	})

	it('liefert leere Ausgabe, wenn Events oder Cursor-Schritte fehlen', () => {
		expect(buildStepTimes(0, [{ elid: 0, timeMs: 0 }])).toEqual({ times: [], exact: false })
		expect(buildStepTimes(5, [])).toEqual({ times: [], exact: false })
	})
})

describe('findStepIndex', () => {
	const times = [0, 1000, 2500, 2500, 4000]

	it('findet den größten Index, dessen Zeit nicht größer als die gesuchte Zeit ist', () => {
		expect(findStepIndex(times, 0)).toBe(0)
		expect(findStepIndex(times, 500)).toBe(0)
		expect(findStepIndex(times, 1000)).toBe(1)
		expect(findStepIndex(times, 4000)).toBe(4)
		expect(findStepIndex(times, 999999)).toBe(4)
	})

	it('liefert bei mehreren Schritten mit gleichem Zeitstempel den letzten davon', () => {
		// Bewusstes Verhalten (nicht der erste Treffer) - relevant für den
		// Off-by-one-Bug aus dem Spike: currentIndex muss beim allerersten
		// Tick bereits 0 sein, sonst wird 0 als "ein Schritt weiter" (-1 + 1)
		// fehlinterpretiert und der Cursor springt sofort über die erste Note.
		expect(findStepIndex(times, 3000)).toBe(3)
	})

	it('liefert 0 für eine Zeit vor dem ersten Event', () => {
		expect(findStepIndex(times, -1)).toBe(0)
	})

	it('liefert 0 für eine leere Zeitliste', () => {
		expect(findStepIndex([], 1234)).toBe(0)
	})
})
