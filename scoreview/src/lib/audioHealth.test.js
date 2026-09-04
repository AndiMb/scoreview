import { describe, expect, it } from 'vitest'
import { createDropoutCounter, createFrameRateMeter } from './audioHealth.js'

describe('createDropoutCounter', () => {
	/**
	 * Spielt Frames ab, bei denen die Audiouhr um `faktor` langsamer laeuft
	 * als die Wanduhr.
	 *
	 * @param {object} counter aus createDropoutCounter()
	 * @param {number} frames Anzahl der Frames a 16 ms
	 * @param {number} faktor 1 = die Audiouhr haelt Schritt
	 * @param {number} [startNowMs]
	 * @return {number} Wanduhrzeit nach dem letzten Frame
	 */
	function spiele(counter, frames, faktor, startNowMs = 0) {
		for (let i = 0; i <= frames; i++) {
			const nowMs = startNowMs + i * 16
			counter.update((nowMs - startNowMs) * faktor, nowMs, true)
		}
		return startNowMs + frames * 16
	}

	it('zaehlt nichts, solange die Audiouhr Schritt haelt', () => {
		const counter = createDropoutCounter()
		spiele(counter, 200, 1)
		expect(counter.count()).toBe(0)
		expect(counter.lostMs()).toBe(0)
	})

	it('zaehlt ein Fenster, in dem die Audiouhr deutlich zurueckbleibt', () => {
		const counter = createDropoutCounter()
		spiele(counter, 200, 0.5)
		expect(counter.count()).toBeGreaterThan(0)
		expect(counter.lostMs()).toBeGreaterThan(0)
	})

	// Die Audiouhr wird in Bloecken fortgeschrieben - im 16-ms-Raster sieht
	// sie deshalb immer ungleichmaessig aus. Das ist kein Aussetzer.
	it('haelt eine knappe Abweichung fuer normal', () => {
		const counter = createDropoutCounter()
		spiele(counter, 200, 0.95)
		expect(counter.count()).toBe(0)
	})

	it('zaehlt nur, solange gespielt wird', () => {
		const counter = createDropoutCounter()
		for (let i = 0; i <= 200; i++) {
			counter.update(0, i * 16, false)
		}
		expect(counter.count()).toBe(0)
	})

	// Ein Loop-Neustart setzt die Audiozeit zurueck - das ist kein
	// Rueckstand, sondern ein Sprung.
	it('wertet einen Rueckwaertssprung nicht als Aussetzer', () => {
		const counter = createDropoutCounter()
		counter.update(60000, 0, true)
		counter.update(1000, 1200, true)
		counter.update(1200, 1400, true)
		expect(counter.count()).toBe(0)
	})

	it('rechnet den Tempofaktor ein', () => {
		const counter = createDropoutCounter()
		// Bei halbem Tempo ist eine halb so schnell laufende Audiouhr richtig.
		for (let i = 0; i <= 200; i++) {
			counter.update(i * 16 * 0.5, i * 16, true, 0.5)
		}
		expect(counter.count()).toBe(0)
	})

	it('faengt nach reset() wieder bei null an', () => {
		const counter = createDropoutCounter()
		spiele(counter, 200, 0.5)
		counter.reset()
		expect(counter.count()).toBe(0)
		expect(counter.lostMs()).toBe(0)
	})
})

describe('createFrameRateMeter', () => {
	it('meldet 0, solange nichts gemessen wurde', () => {
		expect(createFrameRateMeter().fps()).toBe(0)
	})

	it('misst 60 Hz bei 16,7-ms-Abstaenden', () => {
		const meter = createFrameRateMeter(0.5)
		for (let i = 0; i < 40; i++) {
			meter.update(i * (1000 / 60))
		}
		expect(meter.fps()).toBe(60)
	})

	it('misst eine eingebrochene Bildrate', () => {
		const meter = createFrameRateMeter(0.5)
		for (let i = 0; i < 40; i++) {
			meter.update(i * 100)
		}
		expect(meter.fps()).toBe(10)
	})

	// Ein Tab im Hintergrund bekommt keine Frames; der erste danach ist
	// Sekunden alt und wuerde den Mittelwert unbrauchbar machen.
	it('ignoriert eine lange Pause zwischen zwei Frames', () => {
		const meter = createFrameRateMeter(0.5)
		for (let i = 0; i < 40; i++) {
			meter.update(i * (1000 / 60))
		}
		meter.update(40 * (1000 / 60) + 30000)
		expect(meter.fps()).toBe(60)
	})

	it('faengt nach reset() wieder von vorn an', () => {
		const meter = createFrameRateMeter(0.5)
		meter.update(0)
		meter.update(16)
		meter.reset()
		expect(meter.fps()).toBe(0)
	})
})
