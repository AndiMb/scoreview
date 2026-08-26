import { describe, expect, it } from 'vitest'
import { canMapStavesToParts, extractStaffLines, findStaffBands, groupBandsIntoSystems, stavesOfPart } from './staffBands.js'

/**
 * Diese Ableitung entscheidet, wo „meine Stimme" markiert wird. Trifft sie
 * daneben, markiert die App jemandem die Zeile der Nachbarstimme - und das
 * ist schlimmer als gar keine Markierung, weil es glaubwürdig aussieht.
 * Deshalb liegt der Schwerpunkt hier auf den Fällen, in denen die Zuordnung
 * NICHT zulässig ist.
 */

/** Baut ein SVG mit Notenzeilen an den angegebenen Oberkanten. */
function svgMitZeilen(zeilen, { abstand = 100, links = 1000, rechts = 9000 } = {}) {
	const linien = zeilen.flatMap((oben) => [0, 1, 2, 3, 4].map((i) => {
		const y = oben + i * abstand
		return `<polyline class="StaffLines" fill="none" stroke="#000000" points="${links},${y} ${rechts},${y}" />`
	}))
	return `<svg viewBox="0 0 10200 13200">${linien.join('')}</svg>`
}

/** Ein Taktrechteck je System, wie es measures.json liefert. */
const systemRect = (y, h) => ({ page: 0, x: 1000, y, w: 8000, h })

describe('extractStaffLines', () => {
	it('liest Lage und Breite jeder Notenlinie', () => {
		const linien = extractStaffLines('<polyline class="StaffLines" points="1489.73,2148.84 9491.34,2148.84" />')
		expect(linien).toEqual([{ y: 2148.84, left: 1489.73, right: 9491.34 }])
	})

	it('ignoriert Polylines ohne StaffLines-Klasse', () => {
		// Auf einer Notenseite sind fast 300 Polylines Balken, Bögen und
		// Bindebögen - nur die Notenlinien tragen die Klasse.
		const linien = extractStaffLines('<polyline class="Beam" points="10,10 90,10" /><polyline points="0,0 1,1" />')
		expect(linien).toEqual([])
	})

	it('vertraegt ein SVG ganz ohne Notenlinien', () => {
		expect(extractStaffLines('<svg></svg>')).toEqual([])
	})
})

describe('findStaffBands', () => {
	it('fasst je fuenf Linien zu einer Notenzeile zusammen', () => {
		const bands = findStaffBands(svgMitZeilen([1000, 2000, 3000]))
		expect(bands).toHaveLength(3)
		expect(bands[0]).toEqual({ top: 1000, bottom: 1400, left: 1000, right: 9000 })
	})

	it('trennt Zeilen an der ueberproportionalen Luecke, nicht an einem festen Wert', () => {
		// Eng gesetzt (Linienabstand 40) und weit gesetzt (200) muessen beide
		// funktionieren - eine absolute Schwelle koennte das nicht leisten.
		expect(findStaffBands(svgMitZeilen([500, 900], { abstand: 40 }))).toHaveLength(2)
		expect(findStaffBands(svgMitZeilen([500, 2500], { abstand: 200 }))).toHaveLength(2)
	})

	it('haelt verschieden breite Systeme auseinander', () => {
		// Das erste System einer Partitur ist wegen der Stimmennamen
		// eingerueckt. Wuerden beide Breiten gemeinsam ausgewertet, verzoege
		// das den Median der Abstaende.
		const svg = svgMitZeilen([1000, 2000], { links: 1500 })
			+ svgMitZeilen([5000, 6000], { links: 1000 })
		expect(findStaffBands(svg)).toHaveLength(4)
	})

	it('liefert die Zeilen von oben nach unten', () => {
		const svg = svgMitZeilen([5000], { links: 1000 }) + svgMitZeilen([1000], { links: 1500 })
		expect(findStaffBands(svg).map((b) => b.top)).toEqual([1000, 5000])
	})
})

describe('groupBandsIntoSystems', () => {
	const bands = findStaffBands(svgMitZeilen([1000, 1600, 5000, 5600]))

	it('teilt die Zeilen nach den Taktrechtecken auf', () => {
		const systeme = groupBandsIntoSystems(bands, [
			systemRect(900, 1200),
			systemRect(900, 1200),
			systemRect(4900, 1200),
		])
		expect(systeme.map((s) => s.staves.length)).toEqual([2, 2])
		expect(systeme[0].top).toBe(1000)
		expect(systeme[1].top).toBe(5000)
	})

	it('liefert nichts ohne Taktrechtecke - lieber keine Zuordnung als eine geratene', () => {
		expect(groupBandsIntoSystems(bands, [])).toEqual([])
		expect(groupBandsIntoSystems(bands, undefined)).toEqual([])
	})
})

describe('canMapStavesToParts', () => {
	const zweiSysteme = (zeilenJeSystem) => zeilenJeSystem.map((anzahl) => ({ staves: new Array(anzahl).fill({}) }))

	it('erlaubt die Zuordnung, wenn jedes System so viele Zeilen wie Stimmen hat', () => {
		expect(canMapStavesToParts(zweiSysteme([4, 4, 4]), 4)).toBe(true)
	})

	it('verweigert sie, wenn ein System eine Zeile weniger hat', () => {
		// Genau dieser Fall kommt in echtem Material vor: MuseScore blendet
		// leere Notenzeilen aus, dann verschieben sich alle darunter. An einer
		// Testpartitur nachgemessen (erstes System 4 statt 5 Zeilen).
		expect(canMapStavesToParts(zweiSysteme([4, 5, 5]), 5)).toBe(false)
	})

	it('verweigert sie bei einem Klavierauszug (zwei Zeilen je Stimme)', () => {
		expect(canMapStavesToParts(zweiSysteme([2, 2]), 1)).toBe(false)
	})

	it('verweigert sie ohne Systeme oder ohne Stimmen', () => {
		expect(canMapStavesToParts([], 4)).toBe(false)
		expect(canMapStavesToParts(zweiSysteme([4]), 0)).toBe(false)
	})
})

describe('stavesOfPart', () => {
	it('liefert je System die Zeile dieser Stimme', () => {
		const systeme = [
			{ staves: [{ top: 1 }, { top: 2 }] },
			{ staves: [{ top: 3 }, { top: 4 }] },
		]
		expect(stavesOfPart(systeme, 1)).toEqual([{ top: 2 }, { top: 4 }])
	})

	it('ueberspringt Systeme, in denen es die Zeile nicht gibt', () => {
		const systeme = [{ staves: [{ top: 1 }] }, { staves: [{ top: 3 }, { top: 4 }] }]
		expect(stavesOfPart(systeme, 1)).toEqual([{ top: 4 }])
	})
})
