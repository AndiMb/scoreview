import { describe, expect, it } from 'vitest'
import {
	createLatencySmoother,
	createTimeSmoother,
	MAX_PLAUSIBLE_LATENCY_MS,
	resolveLatencyMs,
	toDisplayTimeMs,
} from './playbackTime.js'

describe('resolveLatencyMs', () => {
	it('bevorzugt den gemessenen Wert vor dem gemeldeten', () => {
		expect(resolveLatencyMs({ measuredMs: 210, reportedMs: 40 })).toBe(210)
	})

	it('faellt auf den gemeldeten Wert zurueck, wenn nichts gemessen wurde', () => {
		expect(resolveLatencyMs({ measuredMs: null, reportedMs: 40 })).toBe(40)
	})

	// getOutputTimestamp() liefert in manchen Browsern konstant 0 - das ist
	// keine Messung, sondern eine fehlende Implementierung.
	it('verwirft 0 als Messung und nimmt den gemeldeten Wert', () => {
		expect(resolveLatencyMs({ measuredMs: 0, reportedMs: 40 })).toBe(40)
	})

	it('verwirft unplausibel grosse Werte in beiden Quellen', () => {
		const latenz = resolveLatencyMs({
			measuredMs: MAX_PLAUSIBLE_LATENCY_MS + 1,
			reportedMs: Number.POSITIVE_INFINITY,
		})
		expect(latenz).toBe(0)
	})

	it('addiert den Wert von Hand auf die Automatik', () => {
		expect(resolveLatencyMs({ measuredMs: 120, reportedMs: null, manualOffsetMs: 80 })).toBe(200)
	})

	// Der Fall, auf den es ankommt: Der Browser meldet nichts (kein
	// AVDTP-Delay-Reporting), die Nutzerin stellt die Bluetooth-Latenz selbst
	// nach.
	it('traegt den Wert von Hand allein, wenn der Browser nichts weiss', () => {
		expect(resolveLatencyMs({ measuredMs: null, reportedMs: null, manualOffsetMs: 250 })).toBe(250)
	})

	it('kommt mit fehlenden Angaben aus', () => {
		expect(resolveLatencyMs({})).toBe(0)
	})
})

describe('toDisplayTimeMs', () => {
	it('zieht die Latenz von der Renderzeit ab', () => {
		expect(toDisplayTimeMs(5000, 200)).toBe(4800)
	})

	// Die Latenz ist in echten Sekunden gemessen, die Zeitachse laeuft mit
	// playbackRate - bei halbem Tempo entsprechen 200 ms Ausgabelatenz nur
	// 100 ms Zeitachse.
	it('rechnet die Latenz auf den Tempofaktor um', () => {
		expect(toDisplayTimeMs(5000, 200, 0.5)).toBe(4900)
		expect(toDisplayTimeMs(5000, 200, 1.5)).toBe(4700)
	})

	it('geht am Stueckanfang nicht ins Negative', () => {
		expect(toDisplayTimeMs(50, 200)).toBe(0)
	})

	it('behandelt einen unbrauchbaren Tempofaktor wie 1', () => {
		expect(toDisplayTimeMs(5000, 200, 0)).toBe(4800)
	})
})

describe('createLatencySmoother', () => {
	it('uebernimmt den ersten Wert unveraendert', () => {
		expect(createLatencySmoother(0.5).update(200)).toBe(200)
	})

	it('naehert sich einem neuen Wert an, statt ihm zu folgen', () => {
		const smoother = createLatencySmoother(0.5)
		smoother.update(200)
		expect(smoother.update(300)).toBe(250)
		expect(smoother.update(300)).toBe(275)
	})

	it('behaelt den letzten Wert bei unbrauchbarer Eingabe', () => {
		const smoother = createLatencySmoother(0.5)
		smoother.update(200)
		expect(smoother.update(Number.NaN)).toBe(200)
	})

	it('faengt nach reset() wieder von vorn an', () => {
		const smoother = createLatencySmoother(0.5)
		smoother.update(200)
		smoother.reset()
		expect(smoother.update(400)).toBe(400)
	})
})

describe('createTimeSmoother', () => {
	it('uebernimmt den ersten Wert unveraendert', () => {
		expect(createTimeSmoother().update(1000, 0)).toBe(1000)
	})

	// Der eigentliche Zweck: Die Audiouhr steht zwei Frames lang still
	// (grob fortgeschriebener context.currentTime), die Anzeige laeuft
	// trotzdem weiter.
	it('laeuft weiter, waehrend die Audiouhr stillsteht', () => {
		const smoother = createTimeSmoother()
		smoother.update(1000, 0)
		const zweiterFrame = smoother.update(1000, 16)
		const dritterFrame = smoother.update(1000, 32)
		expect(zweiterFrame).toBeGreaterThan(1000)
		expect(dritterFrame).toBeGreaterThan(zweiterFrame)
	})

	it('bleibt dicht an der Audiouhr, wenn die gleichmaessig laeuft', () => {
		const smoother = createTimeSmoother()
		let ergebnis = smoother.update(1000, 0)
		for (let frame = 1; frame <= 60; frame++) {
			ergebnis = smoother.update(1000 + frame * 16, frame * 16)
		}
		expect(Math.abs(ergebnis - (1000 + 60 * 16))).toBeLessThan(2)
	})

	// Ein Sprung ist kein Stottern: Nach einem seek() waere jede Vorhersage
	// aus der alten Position wertlos.
	it('uebernimmt einen Sprung sofort, statt ihn anzugleichen', () => {
		const smoother = createTimeSmoother()
		smoother.update(1000, 0)
		expect(smoother.update(60000, 16)).toBe(60000)
	})

	it('beruecksichtigt den Tempofaktor bei der Vorhersage', () => {
		const langsam = createTimeSmoother()
		langsam.update(1000, 0)
		const schnell = createTimeSmoother()
		schnell.update(1000, 0)
		// Dieselbe Wanduhrzeit, dieselbe stehende Audiouhr - bei doppeltem
		// Tempo muss die Vorhersage weiter gelaufen sein.
		expect(schnell.update(1000, 20, 1.5)).toBeGreaterThan(langsam.update(1000, 20, 0.5))
	})

	it('faengt nach reset() wieder von vorn an', () => {
		const smoother = createTimeSmoother()
		smoother.update(1000, 0)
		smoother.reset()
		expect(smoother.update(5000, 16)).toBe(5000)
	})
})
