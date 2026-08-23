import { describe, expect, it } from 'vitest'
import { planAutoScroll, shouldSuppressAutoScroll } from './scrollPlan.js'

describe('planAutoScroll', () => {
	// Viewport 1000px hoch, Band per Default 350-650px relativ zum sichtbaren
	// Bereich (bandStart 0.35, bandEnd 0.65).
	const base = { scrollTop: 2000, viewportHeight: 1000 }

	it('liefert null, wenn der Cursor bereits im Sichtband liegt', () => {
		// Band liegt bei [2350, 2650] - Cursor mittendrin.
		expect(planAutoScroll({ ...base, cursorTop: 2450, cursorHeight: 40 })).toBeNull()
	})

	it('scrollt nach oben, wenn der Cursor über dem Band liegt', () => {
		const target = planAutoScroll({ ...base, cursorTop: 2100, cursorHeight: 40 })
		// neues scrollTop so, dass die Cursor-Oberkante genau auf bandStart landet
		expect(target).toBe(2100 - 1000 * 0.35)
	})

	it('scrollt nach unten, wenn der Cursor unter dem Band liegt', () => {
		const cursorTop = 2900
		const cursorHeight = 40
		const target = planAutoScroll({ ...base, cursorTop, cursorHeight })
		// neues scrollTop so, dass die Cursor-Unterkante genau auf bandEnd landet
		expect(target).toBe((cursorTop + cursorHeight) - 1000 * 0.65)
	})

	it('behandelt eine Cursor-Unterkante GENAU auf der Bandgrenze noch als im Band', () => {
		// bandBottomAbs = 2650, Cursor endet exakt dort.
		expect(planAutoScroll({ ...base, cursorTop: 2600, cursorHeight: 50 })).toBeNull()
	})

	it('respektiert ein eigenes Sichtband', () => {
		// Band bei bandStart 0.1/bandEnd 0.9 liegt bei [2100, 2900] - mit dem
		// Default-Band (0.35/0.65, [2350, 2650]) wäre derselbe Cursor außerhalb.
		const target = planAutoScroll({
			...base, cursorTop: 2150, cursorHeight: 10, bandStart: 0.1, bandEnd: 0.9,
		})
		expect(target).toBeNull()
	})

	// Regression: bei SATB-/Mehrsystem-Partituren deckt das Cursor-Rechteck
	// die ganze Notenzeile ab (siehe scrollPlan.js-Kommentar) und kann damit
	// höher als das Band selbst sein - dann darf die Funktion nicht
	// abwechselnd "Oberkante ins Band" und "Unterkante ins Band" verlangen
	// (das wären zwei unerfüllbare, sich widersprechende Ziele), sonst
	// springt der Viewport bei jedem Notenwechsel hin und her, obwohl sich
	// die Note gar nicht bewegt hat. Nachgestellt am real beobachteten Fall.
	it('oszilliert nicht, wenn der Cursor höher als das Band ist', () => {
		const params = { cursorTop: 1000, cursorHeight: 500, viewportHeight: 1000 }
		const firstTarget = planAutoScroll({ ...params, scrollTop: 0 })
		expect(firstTarget).not.toBeNull()
		// Zweiter Aufruf mit UNVERÄNDERTER Cursorposition (wie bei mehreren
		// Noten im selben System, siehe PLAN.md M4-Nachbarschaft), aber dem
		// soeben berechneten scrollTop - muss sich stabilisieren (null),
		// nicht ein neues, gegenläufiges Ziel liefern.
		const secondTarget = planAutoScroll({ ...params, scrollTop: firstTarget })
		expect(secondTarget).toBeNull()
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
