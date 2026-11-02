import { describe, expect, it } from 'vitest'
import { canMapStavesToParts, extractStaffLines, findStaffBands, groupBandsIntoSystems, partOfStaff, staffOfPart, stavesOfPart } from './staffBands.js'

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

	// Die Form der Engine (lokaler Weg, M10), wie sie eine SATB-Seite
	// ausliefert: Klasse an der Gruppe, Lage als Transformation.
	const engineZeile = (st, y) => `<g class="StaffLines st-${st} vc-0">
<g transform="matrix(1 0 0 1 1345.086 ${y})">
${[0, 82.677, 165.354, 248.031, 330.709].map((dy) => `<polyline points="0,${dy} 7873.422,${dy}" fill="none" stroke="#000000" stroke-width="10.335" stroke-linejoin="bevel"/>`).join('\n')}
</g>
</g>`

	it('liest auch die Engine-Form mit Transformation', () => {
		const linien = extractStaffLines(engineZeile(0, 1303.268))
		expect(linien).toHaveLength(5)
		expect(linien[0]).toEqual({ y: 1303.268, left: 1345.086, right: 1345.086 + 7873.422, staff: 0 })
		expect(linien[4].y).toBeCloseTo(1303.268 + 330.709)
	})

	it('liest in der Engine-Form nur bis zum Ende der Gruppe', () => {
		// Eine Polyline hinter der Gruppe (Bogen, Hilfslinie) ist keine Notenlinie.
		const svg = engineZeile(0, 1000) + '<g class="Slur"><polyline points="0,0 50,50"/></g><polyline points="1,1 2,2"/>'
		expect(extractStaffLines(svg)).toHaveLength(5)
	})

	it('verrechnet verschachtelte Transformationen', () => {
		const svg = '<g class="StaffLines" transform="translate(100, 50)"><g transform="matrix(2 0 0 2 10 20)"><polyline points="0,5 30,5"/></g></g>'
		expect(extractStaffLines(svg)).toEqual([{ y: 50 + 20 + 10, left: 110, right: 170 }])
	})

	it('findet in der Engine-Form die Zeilen und Systeme einer SATB-Seite', () => {
		const svg = [1303.268, 2494.176, 3525.434, 4834.499].map((y, i) => engineZeile(i, y)).join('\n')
		const bands = findStaffBands(svg)
		expect(bands).toHaveLength(4)
		const systems = groupBandsIntoSystems(bands, [{ page: 0, x: 1345, y: 1303.27, w: 7873, h: 3862 }])
		expect(systems).toHaveLength(1)
		expect(canMapStavesToParts(systems, 4)).toBe(true)
	})

	it('traegt die Zeilennummer der Engine bis in die Zeile', () => {
		expect(findStaffBands(engineZeile(3, 1000))[0].staff).toBe(3)
		// Die Sidecar-Form nennt keine Nummer - dann fehlt das Feld ganz.
		expect(findStaffBands(svgMitZeilen([1000]))[0]).not.toHaveProperty('staff')
	})

	// Duckwerk, Seite 1 (gemessen): fuenf Stimmen, im ersten System ist die
	// leere Alt-Zeile ausgeblendet - st-0, st-2, st-3, st-4.
	it('ordnet ein System mit ausgeblendeter Zeile ueber die Nummern zu', () => {
		const svg = [[0, 1000], [2, 2000], [3, 3000], [4, 4000], [0, 6000], [1, 7000], [2, 8000], [3, 9000], [4, 10000]]
			.map(([st, y]) => engineZeile(st, y)).join('\n')
		const systems = groupBandsIntoSystems(findStaffBands(svg), [systemRect(900, 4500), systemRect(5900, 4500)])
		expect(systems.map((s) => s.staves.length)).toEqual([4, 5])
		expect(canMapStavesToParts(systems, 5)).toBe(true)
		// Tenor (Stimme 2) ist im ersten System die zweite Zeile, nicht die dritte.
		expect(stavesOfPart(systems, 2).map((b) => b.top)).toEqual([2000, 8000])
		// Alt fehlt im ersten System - keine Ersatzzeile.
		expect(stavesOfPart(systems, 1).map((b) => b.top)).toEqual([7000])
		expect(partOfStaff(systems[0], 1)).toBe(2)
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

	const nummeriert = (...nummern) => ({ staves: nummern.map((staff) => ({ staff })) })

	it('erlaubt sie mit Zeilennummern auch bei fehlender Zeile', () => {
		expect(canMapStavesToParts([nummeriert(0, 2, 3, 4), nummeriert(0, 1, 2, 3, 4)], 5)).toBe(true)
	})

	it('verweigert sie, wenn eine Nummer ueber die Stimmen hinausgeht', () => {
		// Mehr Zeilen als Stimmen: ein Klavierauszug, keine Zeile je Stimme.
		expect(canMapStavesToParts([nummeriert(0, 1, 2)], 2)).toBe(false)
	})

	it('verweigert sie bei doppelter Nummer', () => {
		expect(canMapStavesToParts([nummeriert(0, 0, 1)], 3)).toBe(false)
	})

	it('zaehlt ohne Nummer an jeder Zeile wieder ab', () => {
		// Eine Zeile ohne Nummer macht das System zur Sidecar-Form.
		expect(canMapStavesToParts([{ staves: [{ staff: 0 }, {}, { staff: 2 }] }], 4)).toBe(false)
		expect(canMapStavesToParts([{ staves: [{ staff: 0 }, {}, { staff: 2 }] }], 3)).toBe(true)
	})

	it('verweigert sie ohne Systeme oder ohne Stimmen', () => {
		expect(canMapStavesToParts([], 4)).toBe(false)
		expect(canMapStavesToParts(zweiSysteme([4]), 0)).toBe(false)
	})
})

describe('staffOfPart / partOfStaff', () => {
	const luecke = { staves: [{ top: 1, staff: 0 }, { top: 3, staff: 2 }] }
	const ohneNummer = { staves: [{ top: 1 }, { top: 2 }] }

	it('sucht mit Nummern nach der Nummer', () => {
		expect(staffOfPart(luecke, 2)).toEqual({ top: 3, staff: 2 })
		expect(staffOfPart(luecke, 1)).toBeNull()
		expect(partOfStaff(luecke, 1)).toBe(2)
	})

	it('zaehlt ohne Nummern nach der Lage', () => {
		expect(staffOfPart(ohneNummer, 1)).toEqual({ top: 2 })
		expect(partOfStaff(ohneNummer, 1)).toBe(1)
	})

	it('vertraegt fehlende Angaben', () => {
		expect(staffOfPart(null, 0)).toBeNull()
		expect(staffOfPart(luecke, null)).toBeNull()
		expect(partOfStaff(luecke, 5)).toBeNull()
		expect(partOfStaff(luecke, null)).toBeNull()
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
