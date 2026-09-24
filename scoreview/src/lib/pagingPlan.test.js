import { describe, expect, it } from 'vitest'
import { groupSystems, nextScrollTop } from './pagingPlan.js'

// Ein Ausschnitt von 600 px, Systeme zu 150 px mit 30 px Abstand.
const VIEW = { height: 600, maxScrollTop: 10000 }
function systeme(n, { start = 20, hoehe = 150, abstand = 30 } = {}) {
	return Array.from({ length: n }, (_, i) => ({ top: start + i * (hoehe + abstand), bottom: start + i * (hoehe + abstand) + hoehe }))
}

describe('pagingPlan.groupSystems', () => {
	it('fasst die Takte eines Systems zusammen und trennt die Systeme', () => {
		const takte = [
			{ y: 100, h: 80 },
			{ y: 100, h: 80 },
			{ y: 101, h: 79 },
			{ y: 250, h: 80 },
			{ y: 250, h: 90 },
		]
		expect(groupSystems(takte)).toEqual([{ top: 100, bottom: 180 }, { top: 250, bottom: 340 }])
	})

	it('uebersteht fehlende oder kaputte Rechtecke', () => {
		expect(groupSystems(null)).toEqual([])
		expect(groupSystems([{ y: 'x', h: 3 }, { y: 5, h: 5 }])).toEqual([{ top: 5, bottom: 10 }])
	})
})

describe('pagingPlan.nextScrollTop', () => {
	it('legt das letzte vollstaendig sichtbare System nach oben', () => {
		// Sichtbar 0..600: Systeme bei 20, 200, 380 vollstaendig, 560 angeschnitten.
		expect(nextScrollTop(systeme(10), VIEW, 0, 1)).toBe(380 - 8)
	})

	it('nimmt das naechste System, wenn nur eines passt', () => {
		const gross = systeme(5, { hoehe: 500, abstand: 40 })
		// Bei scrollTop 12 steht System 0 (20..520) genau oben.
		expect(nextScrollTop(gross, VIEW, 12, 1)).toBe(560 - 8)
	})

	it('macht keinen Minischritt, wenn das letzte vollstaendige System schon fast oben steht', () => {
		// Sichtbar 1000..1600: System 1010..1400 vollstaendig, das naechste
		// (Seitenwechsel) beginnt bei 1500 und ist angeschnitten.
		const layout = [{ top: 1010, bottom: 1400 }, { top: 1500, bottom: 1900 }]
		expect(nextScrollTop(layout, VIEW, 1000, 1)).toBe(1500 - 8)
		expect(nextScrollTop([{ top: 400, bottom: 800 }, { top: 1100, bottom: 1590 }], VIEW, 1000, -1)).toBe(1000 + 8 - 600)
	})

	it('springt nie ueber ungesehenen Inhalt, auch bei grossem Abstand', () => {
		// Ein System, dann eine Luecke von 2000 px (etwa ein Seitenkopf).
		const luecke = [{ top: 10, bottom: 400 }, { top: 2400, bottom: 2600 }]
		const ziel = nextScrollTop(luecke, VIEW, 2, 1)
		expect(ziel).toBeLessThanOrEqual(2 + 600)
		expect(ziel).toBeGreaterThan(2)
	})

	it('faellt ohne vollstaendiges System auf einen Schritt mit Ueberlappung zurueck', () => {
		const riesig = [{ top: 0, bottom: 3000 }]
		expect(nextScrollTop(riesig, VIEW, 100, 1)).toBe(100 + 600 * 0.85)
		expect(nextScrollTop([], VIEW, 100, 1)).toBe(100 + 600 * 0.85)
	})

	it('legt rueckwaerts das erste vollstaendige System nach unten', () => {
		// Sichtbar 900..1500: Systeme bei 920, 1100, 1280 vollstaendig.
		const ziel = nextScrollTop(systeme(20), VIEW, 900, -1)
		expect(ziel).toBe(920 + 150 + 8 - 600)
	})

	it('bleibt in den Grenzen', () => {
		expect(nextScrollTop(systeme(3), VIEW, 0, -1)).toBe(0)
		expect(nextScrollTop(systeme(50), { height: 600, maxScrollTop: 500 }, 400, 1)).toBe(500)
	})

	/**
	 * Die eigentliche Zusage: Es geht nie eine Zeile verloren. An vielen
	 * zufaelligen Layouts geprueft, nicht an einem Beispiel - Systeme
	 * unterschiedlicher Hoehe, Seitenluecken, auch welche hoeher als der
	 * Ausschnitt.
	 */
	it('verliert bei zufaelligen Layouts nie eine Zeile (PageDown und PageUp)', () => {
		let seed = 42
		const zufall = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648
			return seed / 2147483648
		}
		for (let lauf = 0; lauf < 500; lauf++) {
			const layout = []
			let y = zufall() * 40
			const anzahl = 3 + Math.floor(zufall() * 30)
			for (let i = 0; i < anzahl; i++) {
				const hoehe = 40 + zufall() * (zufall() < 0.1 ? 900 : 300)
				layout.push({ top: y, bottom: y + hoehe })
				y += hoehe + 10 + (zufall() < 0.15 ? zufall() * 700 : zufall() * 60)
			}
			const hoeheAusschnitt = 300 + zufall() * 700
			const view = { height: hoeheAusschnitt, maxScrollTop: Math.max(0, y - hoeheAusschnitt) }
			const scrollTop = zufall() * view.maxScrollTop
			const unten = scrollTop + hoeheAusschnitt

			const vor = nextScrollTop(layout, view, scrollTop, 1)
			if (scrollTop < view.maxScrollTop - 1) {
				// Fortschritt, und keine Luecke zwischen altem unterem und neuem oberem Rand.
				expect(vor).toBeGreaterThan(scrollTop)
				expect(vor).toBeLessThanOrEqual(unten)
				// Das erste noch nicht vollstaendig gesehene System, das in den
				// Ausschnitt passt, beginnt nicht oberhalb des neuen Randes.
				const offen = layout.find((s) => s.bottom > unten + 1 && s.bottom - s.top <= hoeheAusschnitt - 16)
				if (offen && offen.top >= scrollTop) {
					expect(vor).toBeLessThanOrEqual(offen.top)
				}
			}

			const zurueck = nextScrollTop(layout, view, scrollTop, -1)
			if (scrollTop > 1) {
				expect(zurueck).toBeLessThan(scrollTop)
				expect(zurueck + hoeheAusschnitt).toBeGreaterThanOrEqual(scrollTop)
				const offen = [...layout].reverse().find((s) => s.top < scrollTop - 1 && s.bottom - s.top <= hoeheAusschnitt - 16)
				if (offen && offen.bottom <= unten) {
					expect(zurueck + hoeheAusschnitt).toBeGreaterThanOrEqual(offen.bottom)
				}
			}
		}
	})
})
