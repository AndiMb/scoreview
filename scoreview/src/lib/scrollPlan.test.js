import { describe, expect, it } from 'vitest'
import { planAutoScroll, planHorizontalScroll, shouldSuppressAutoScroll } from './scrollPlan.js'

describe('planAutoScroll', () => {
	// Viewport 1000px hoch, Default-Rand 24px.
	const base = { scrollTop: 2000, viewportHeight: 1000 }

	it('liefert null, solange das System vollständig sichtbar ist', () => {
		expect(planAutoScroll({ ...base, cursorTop: 2450, cursorHeight: 40 })).toBeNull()
	})

	it('führt nach oben nach, wenn das System über der Oberkante steht', () => {
		const target = planAutoScroll({ ...base, cursorTop: 1900, cursorHeight: 40 })
		// freier Platz = 1000 - 40 - 48 = 912, davon 35% über dem System
		expect(target).toBe(1900 - (24 + 912 * 0.35))
	})

	it('führt nach unten nach, wenn das System unter der Unterkante steht', () => {
		const target = planAutoScroll({ ...base, cursorTop: 2990, cursorHeight: 40 })
		expect(target).toBe(2990 - (24 + 912 * 0.35))
	})

	it('führt schon nach, wenn nur die Unterkante knapp abgeschnitten ist', () => {
		// Unterkante bei 2990, sichtbar bis 2976 (Viewportende minus Rand) -
		// mit der alten Sichtband-Regel hätte hier "alles gut" gestanden,
		// obwohl die letzten Notenzeilen unter der Kante lagen.
		expect(planAutoScroll({ ...base, cursorTop: 2600, cursorHeight: 390 })).not.toBeNull()
	})

	// Regression aus Phase 16/17: bei SATB-/Mehrsystem-Partituren deckt das
	// Cursor-Rechteck die ganze Notenzeile ab und kann höher als der Viewport
	// sein. Dann darf kein Ziel entstehen, das beim nächsten Aufruf sofort
	// wieder korrigiert wird (real beobachtetes Hoch-Runter-Springen).
	it('stabilisiert sich, wenn das System höher als der Viewport ist', () => {
		const params = { cursorTop: 1000, cursorHeight: 1200, viewportHeight: 1000 }
		const firstTarget = planAutoScroll({ ...params, scrollTop: 0 })
		expect(firstTarget).not.toBeNull()
		expect(planAutoScroll({ ...params, scrollTop: firstTarget })).toBeNull()
	})

	// Dasselbe für den Normalfall: das berechnete Ziel muss die eigene
	// "vollständig sichtbar"-Bedingung erfüllen, sonst führt jeder Frame
	// erneut nach.
	it('liefert nach einem Nachführen kein zweites Ziel', () => {
		for (const cursorHeight of [10, 200, 800, 950]) {
			const params = { cursorTop: 5000, cursorHeight, viewportHeight: 1000 }
			const target = planAutoScroll({ ...params, scrollTop: 0 })
			expect(target).not.toBeNull()
			expect(planAutoScroll({ ...params, scrollTop: target })).toBeNull()
		}
	})

	it('verschluckt den Rand nicht bei winzigem Viewport', () => {
		// Rand ist auf 10% der Viewporthöhe gedeckelt (hier 12px statt 24px) -
		// ohne den Deckel bliebe bei 120px Höhe kein Platz mehr übrig.
		const params = { cursorTop: 500, cursorHeight: 30, viewportHeight: 120 }
		const target = planAutoScroll({ ...params, scrollTop: 0 })
		expect(planAutoScroll({ ...params, scrollTop: target })).toBeNull()
	})

	it('liefert null bei unbekannter Viewporthöhe', () => {
		expect(planAutoScroll({ cursorTop: 100, cursorHeight: 10, scrollTop: 0, viewportHeight: 0 })).toBeNull()
	})
})

describe('planHorizontalScroll', () => {
	const base = { scrollLeft: 0, viewportWidth: 800 }

	it('liefert null, solange die Stelle waagerecht sichtbar ist', () => {
		expect(planHorizontalScroll({ ...base, cursorLeft: 300, cursorWidth: 40 })).toBeNull()
	})

	it('zentriert eine Stelle rechts außerhalb des Bildes', () => {
		const target = planHorizontalScroll({ ...base, cursorLeft: 1200, cursorWidth: 40 })
		expect(target).toBe(1200 - (800 - 40) / 2)
		expect(planHorizontalScroll({ ...base, scrollLeft: target, cursorLeft: 1200, cursorWidth: 40 })).toBeNull()
	})

	it('legt eine breitere Stelle als das Bild links an', () => {
		const target = planHorizontalScroll({ ...base, cursorLeft: 1000, cursorWidth: 900 })
		expect(target).toBe(1000 - 24)
	})
})

describe('shouldSuppressAutoScroll', () => {
	it('liefert false, wenn noch nie manuell gescrollt wurde', () => {
		expect(shouldSuppressAutoScroll(null, 10000)).toBe(false)
	})

	it('liefert true innerhalb des Pausenfensters nach manuellem Scrollen', () => {
		expect(shouldSuppressAutoScroll(10000, 11000, 2500)).toBe(true)
	})

	it('liefert false, sobald das Pausenfenster abgelaufen ist', () => {
		expect(shouldSuppressAutoScroll(10000, 12501, 2500)).toBe(false)
	})

	it('behandelt das Fensterende (exakt resumeDelayMs später) als abgelaufen', () => {
		expect(shouldSuppressAutoScroll(10000, 12500, 2500)).toBe(false)
	})
})
