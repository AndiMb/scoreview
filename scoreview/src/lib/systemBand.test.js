import { describe, expect, it } from 'vitest'
import { bandAnchor, bandScale, bandWindow, cropIndexAt, frameAt, lyricBaselines, lyricBottomsFor, MAX_SPACE_PX, scrollForAnchor, systemCrops } from './systemBand.js'

// Eine Seite 0..10000 x 0..14000 mit zwei Systemen; Linienabstand 25
const viewBox = { minX: 0, minY: 0, width: 10000, height: 14000 }
const sys = (top, bottom) => ({ top, bottom, left: 1000, right: 9000, staves: [{ top, bottom: top + 100 }] })
const page1 = { page: 1, viewBox, systems: [sys(2000, 2600), sys(4000, 4600)] }

describe('systemCrops', () => {
	it('macht je System einen Ausschnitt in Lesereihenfolge', () => {
		const crops = systemCrops([page1, { ...page1, page: 2 }])
		expect(crops.map((c) => [c.page, c.index])).toEqual([[1, 0], [1, 1], [2, 2], [2, 3]])
	})

	it('laesst links Platz fuer Klammer und Namen, rechts wenig', () => {
		const [c] = systemCrops([page1])
		expect(c.x).toBe(1000 - 9 * 25)
		expect(c.x + c.w).toBe(9000 + 2 * 25)
	})

	it('begrenzt den Rand auf sieben Linienabstaende', () => {
		const [c] = systemCrops([page1])
		expect(c.y).toBe(2000 - 7 * 25)
		expect(c.y + c.h).toBe(2600 + 7 * 25)
	})

	it('nimmt bei engen Systemen die halbe Luecke', () => {
		const tight = { page: 1, viewBox, systems: [sys(2000, 2600), sys(2800, 3400)] }
		const [a, b] = systemCrops([tight])
		expect(a.y + a.h).toBe(2700)
		expect(b.y).toBe(2700)
	})

	it('nimmt Liedtext unter dem System mit', () => {
		const withLyrics = { ...page1, lyricBottoms: [3000, null] }
		const [c] = systemCrops([withLyrics])
		expect(c.y + c.h).toBe(3000 + 25)
	})

	it('bleibt innerhalb der Seite', () => {
		const edge = { page: 1, viewBox, systems: [sys(50, 650)] }
		const [c] = systemCrops([edge])
		expect(c.y).toBe(0)
	})
})

describe('cropIndexAt', () => {
	const crops = systemCrops([page1, { ...page1, page: 2 }])

	it('findet den Ausschnitt der Stelle', () => {
		expect(cropIndexAt(crops, 1, 2300)).toBe(0)
		expect(cropIndexAt(crops, 2, 4300)).toBe(3)
	})

	it('nimmt sonst den naechsten auf derselben Seite', () => {
		expect(cropIndexAt(crops, 1, 3400)).toBe(1)
	})

	it('liefert -1 ohne Ausschnitt auf der Seite', () => {
		expect(cropIndexAt(crops, 9, 100)).toBe(-1)
	})
})

describe('bandScale', () => {
	it('fills the height when the staves stay below the bound', () => {
		// 1000 units in 400 px: 0.4 px per unit, staff space 25 -> 10 px
		const crop = { h: 1000, w: 8000, space: 25 }
		expect(bandScale(crop, viewBox, 400)).toEqual({ pageWidthPx: 4000, cropWidthPx: 3200, cropHeightPx: 400 })
	})

	it('bounds the staff space - a one-staff part held upright', () => {
		// 18 spaces of 25 units in 600 px would be 33 px a space
		const crop = { h: 450, w: 8000, space: 25 }
		const s = bandScale(crop, viewBox, 600)
		expect(s.cropHeightPx).toBeCloseTo(18 * MAX_SPACE_PX)
		expect(s.cropWidthPx / crop.w * crop.space).toBeCloseTo(MAX_SPACE_PX)
	})

	it('multiplies by the zoom, beyond the height too', () => {
		const crop = { h: 1000, w: 8000, space: 25 }
		expect(bandScale(crop, viewBox, 400, { zoom: 2 }).cropHeightPx).toBe(800)
		expect(bandScale(crop, viewBox, 400, { zoom: 0.5 }).cropHeightPx).toBe(200)
	})

	it('only fills the height without a staff space', () => {
		const crop = { h: 1000, w: 8000 }
		expect(bandScale(crop, viewBox, 400).cropHeightPx).toBe(400)
	})

	it('systemCrops gives the staff space along', () => {
		const [c] = systemCrops([page1])
		expect(c.space).toBe(25)
	})
})

describe('bandAnchor and scrollForAnchor', () => {
	const frames = [{ left: 8, width: 1000 }, { left: 1020, width: 600 }, { left: 1632, width: 900 }]
	const scaled = frames.map((f, i) => ({ left: 8 + i * 12 + frames.slice(0, i).reduce((a, g) => a + g.width * 1.33, 0), width: f.width * 1.33 }))

	it('keeps the same spot inside a frame when the frames grow', () => {
		const anchor = bandAnchor(frames, 1020 + 300)
		expect(anchor).toEqual({ index: 1, fraction: 0.5, gapPx: 0 })
		expect(scrollForAnchor(scaled, anchor)).toBeCloseTo(scaled[1].left + 0.5 * scaled[1].width)
	})

	it('is exact on the round trip, in a frame and in a gap', () => {
		for (const x of [0, 8, 500, 1008, 1014, 1020, 1700, 2532]) {
			expect(scrollForAnchor(frames, bandAnchor(frames, x))).toBeCloseTo(x)
		}
	})

	it('keeps a gap in px - it does not scale', () => {
		const anchor = bandAnchor(frames, 1008 + 6)
		expect(anchor).toEqual({ index: 0, fraction: 1, gapPx: 6 })
		expect(scrollForAnchor(scaled, anchor)).toBeCloseTo(8 + 1330 + 6)
	})

	it('has nothing to say without frames or with a frame gone', () => {
		expect(bandAnchor([], 100)).toBeNull()
		expect(scrollForAnchor(frames.slice(0, 1), { index: 2, fraction: 0, gapPx: 0 })).toBeNull()
	})
})

describe('lyricBaselines und lyricBottomsFor', () => {
	const svg = '<g class="Lyrics seg-0 st-0 vc-0">\n<g transform="matrix(1 0 0 1 2241.272 2732.246)">x</g></g>'
		+ '<g class="Lyrics seg-0 st-0 vc-0"><g transform="matrix(1 0 0 1 2241.272 2931.446)">y</g></g>'
		+ '<g class="Lyrics seg-0 st-1 vc-0"><g transform="matrix(1 0 0 1 2241.272 4931.4)">z</g></g>'

	it('liest die Grundlinien der Engine-Silben', () => {
		expect(lyricBaselines(svg)).toEqual([2732.246, 2931.446, 4931.4])
	})

	it('findet ohne Klassen nichts', () => {
		expect(lyricBaselines('<path class="Lyrics" d="M0 0"/>')).toEqual([])
	})

	it('ordnet die tiefste Zeile dem System darueber zu', () => {
		const systems = [{ top: 2000, bottom: 2600 }, { top: 4000, bottom: 4600 }]
		expect(lyricBottomsFor(systems, lyricBaselines(svg))).toEqual([2931.446, 4931.4])
		expect(lyricBottomsFor(systems, [])).toEqual([null, null])
	})
})

describe('bandWindow', () => {
	// Frames 500px wide with a 12px gap, screen 800px wide
	const frames = Array.from({ length: 8 }, (_, i) => ({ left: i * 512, width: 500 }))

	it('renders what is on screen plus one screen width either side', () => {
		// on screen: 1000..1800, reach: 200..2600
		expect(bandWindow(frames, 1000, 800)).toEqual({ from: 0, to: 5 })
	})

	it('includes the one after next when frames are narrower than the screen', () => {
		expect(bandWindow(frames, 0, 800, 0)).toEqual({ from: 0, to: 1 })
		expect(bandWindow(frames, 0, 800)).toEqual({ from: 0, to: 3 })
	})

	it('returns null when nothing is in reach', () => {
		expect(bandWindow([], 0, 800)).toBeNull()
		expect(bandWindow(frames, 99999, 800)).toBeNull()
	})
})

describe('frameAt', () => {
	it('findet den zuletzt ueberschrittenen Rahmen', () => {
		const lefts = [8, 320, 640, 900]
		expect(frameAt(lefts, 0)).toBe(0)
		expect(frameAt(lefts, 319)).toBe(1)
		expect(frameAt(lefts, 500)).toBe(1)
		expect(frameAt(lefts, 640)).toBe(2)
		expect(frameAt(lefts, 5000)).toBe(3)
	})

	it('liefert ohne Rahmen 0', () => {
		expect(frameAt([], 100)).toBe(0)
	})
})
