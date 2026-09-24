import { describe, expect, it } from 'vitest'
import { anchorFromTap, layoutStamps, STAMP_CODES } from './stampLayout.js'

// Zwei Takte in einem System aus vier Notenzeilen (SATB), Linienabstand 10.
const measures = {
	0: { page: 0, x: 100, y: 1000, w: 400, h: 400 },
	1: { page: 0, x: 500, y: 1000, w: 200, h: 400 },
	2: { page: 1, x: 100, y: 1000, w: 400, h: 400 },
}
const staves = [0, 1, 2, 3].map((i) => ({ top: 1000 + i * 100, bottom: 1040 + i * 100, left: 100, right: 700 }))
const systems = [{ top: 1000, bottom: 1340, left: 100, right: 700, staves }]

describe('anchorFromTap', () => {
	it('liefert Takt und waagerechten Anteil des Tipps', () => {
		expect(anchorFromTap(measures, 0, 200, 1210)).toEqual({ measureNumber: 1, fraction: 0.25 })
		expect(anchorFromTap(measures, 0, 650, 1010)).toEqual({ measureNumber: 2, fraction: 0.75 })
	})

	it('nimmt einen Tipp knapp ueber dem System noch fuer den Takt', () => {
		expect(anchorFromTap(measures, 0, 300, 950)).toEqual({ measureNumber: 1, fraction: 0.5 })
	})

	it('beachtet die Seite und ignoriert Tipps weit daneben', () => {
		expect(anchorFromTap(measures, 1, 300, 1100)).toEqual({ measureNumber: 3, fraction: 0.5 })
		expect(anchorFromTap(measures, 0, 300, 5000)).toBeNull()
		expect(anchorFromTap({}, 0, 300, 1100)).toBeNull()
	})
})

describe('layoutStamps', () => {
	const atem = { id: 1, stamp: 'breath', fraction: 0.25, measureRect: measures[0], elementRect: null, targetIndices: [] }

	it('setzt x aus Takt und Anteil, ueber das System', () => {
		const [s] = layoutStamps([atem], systems, true)
		expect(s.x).toBe(200)
		expect(s.space).toBe(10)
		expect(s.y).toBeCloseTo(1000 - 6)
		expect(s).not.toHaveProperty('measureRect')
	})

	it('nimmt das Notenrechteck, wenn der Aufrufer eines mitgibt', () => {
		const [s] = layoutStamps([{ ...atem, elementRect: { x: 333, y: 1000, w: 10, h: 40 } }], systems, true)
		expect(s.x).toBe(333)
	})

	it('steht bei einer Stimmnotiz ueber der Zeile jeder Zielstimme', () => {
		const placed = layoutStamps([{ ...atem, targetIndices: [2, 3] }], systems, true)
		expect(placed.map((p) => p.y)).toEqual([1200 - 6, 1300 - 6])
	})

	it('faellt ohne zulaessige Zuordnung auf das System zurueck', () => {
		const [s] = layoutStamps([{ ...atem, targetIndices: [2] }], systems, false)
		expect(s.y).toBeCloseTo(994)
		// Eine Zielstimme, die es auf der Seite nicht gibt, ebenso.
		expect(layoutStamps([{ ...atem, targetIndices: [9] }], systems, true)[0].y).toBeCloseTo(994)
	})

	it('nimmt ohne erkannte Notenzeilen MuseScores Vorgabe, nie die Hoehe eines ganzen Systems', () => {
		const [s] = layoutStamps([atem], [], true)
		expect(s.y).toBeLessThan(1000)
		// 1,75 mm bei 1200 DPI; ein System aus fuenf Zeilen (h = 4800) darf
		// daraus keinen fuenffach zu grossen Stempel machen.
		expect(s.space).toBeCloseTo(82.68, 1)
		expect(layoutStamps([{ ...atem, measureRect: { ...measures[0], h: 4800 } }], [], true)[0].space).toBeCloseTo(82.68, 1)
		// Eine einzelne kleine Zeile bleibt klein.
		expect(layoutStamps([{ ...atem, measureRect: { ...measures[0], h: 40 } }], [], true)[0].space).toBe(10)
	})

	it('stapelt Stempel an derselben Stelle', () => {
		const placed = layoutStamps([atem, { ...atem, id: 2, stamp: 'p' }, { ...atem, id: 3, fraction: 0.9 }], systems, true)
		expect(placed[1].y).toBeLessThan(placed[0].y - 20)
		// Weiter rechts im Takt ist nichts belegt.
		expect(placed[2].y).toBeCloseTo(placed[0].y)
	})

	it('skaliert nicht mit dem Zoom - die Werte sind SVG-Einheiten', () => {
		// Ein Zoom aendert weder measures.json noch die Notenzeilen; dieselbe
		// Eingabe ergibt dieselbe Lage (skaliert wird ueber die viewBox).
		expect(layoutStamps([atem], systems, true)).toEqual(layoutStamps([atem], systems, true))
	})

	it('klemmt den Anteil und ueberspringt Stempel ohne Takt', () => {
		const placed = layoutStamps([{ ...atem, fraction: 7 }, { ...atem, id: 9, measureRect: null }], systems, true)
		expect(placed).toHaveLength(1)
		expect(placed[0].x).toBe(500)
	})
})

describe('STAMP_CODES', () => {
	it('entspricht der Liste des Servers (Annotation::STAMPS)', () => {
		expect([...STAMP_CODES].sort()).toEqual(['a_tempo', 'attention', 'breath', 'caesura', 'cresc', 'cue', 'dim', 'f', 'fermata', 'ff', 'mf', 'mp', 'p', 'pp', 'rit'])
	})
})
