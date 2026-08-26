import { describe, expect, it } from 'vitest'
import {
	BASE_PAGE_WIDTH_PX,
	buildTimeline,
	computeActualSizeZoom,
	computeFitPageZoom,
	computeFitWidthZoom,
	computePinchZoom,
	findElementAtPoint,
	findMeasureStartTime,
	findNearestOccurrenceTimeMs,
	MAX_ZOOM,
	measurePositionToTimeMs,
	MIN_ZOOM,
	parseSvgSizeMm,
	parseViewBox,
	resolveCursorRect,
	resolveMeasurePosition,
} from './scoreLayout.js'

describe('buildTimeline / resolveCursorRect', () => {
	// Nachgebildet aus der echten M7-Messung gegen
	// sidecar/testdata/repeat-test.mscz: elid 0-3 (Takt 1) läuft wegen der
	// Wiederholung zweimal durch, mit unterschiedlichen timeMs-Werten.
	const timingJson = {
		events: [
			{ elid: 0, timeMs: 0 },
			{ elid: 1, timeMs: 500 },
			{ elid: 4, timeMs: 2000 },
			{ elid: 0, timeMs: 4000 },
			{ elid: 1, timeMs: 4500 },
		],
		elements: {
			0: { page: 0, x: 10, y: 20, w: 5, h: 5 },
			1: { page: 0, x: 15, y: 20, w: 5, h: 5 },
			4: { page: 0, x: 30, y: 20, w: 5, h: 5 },
		},
	}

	it('löst eine Zeit auf das jeweils aktuelle Element auf', () => {
		const timeline = buildTimeline(timingJson)
		expect(resolveCursorRect(timeline, 0)).toEqual({ page: 0, x: 10, y: 20, w: 5, h: 5 })
		expect(resolveCursorRect(timeline, 600)).toEqual({ page: 0, x: 15, y: 20, w: 5, h: 5 })
		expect(resolveCursorRect(timeline, 999999)).toEqual({ page: 0, x: 15, y: 20, w: 5, h: 5 })
	})

	it('liefert für ein wiederholtes elid bei jedem Durchlauf dieselbe Koordinate', () => {
		const timeline = buildTimeline(timingJson)
		// elid 0 taucht zweimal auf (t=0 und t=4000) - beide Male dieselbe
		// Koordinate, kein Sonderfall (siehe docs/architecture.md M7).
		expect(resolveCursorRect(timeline, 0)).toEqual(resolveCursorRect(timeline, 4000))
	})

	it('liefert null für eine leere Timeline', () => {
		const timeline = buildTimeline({ events: [], elements: {} })
		expect(resolveCursorRect(timeline, 100)).toBeNull()
	})

	it('liefert null, wenn ein elid keine Koordinate hat (unerwartete Sidecar-Antwort)', () => {
		const timeline = buildTimeline({ events: [{ elid: 99, timeMs: 0 }], elements: {} })
		expect(resolveCursorRect(timeline, 0)).toBeNull()
	})
})

describe('findMeasureStartTime', () => {
	// Nachgebildet aus der echten M7-Messung: measures.json fuer
	// sidecar/testdata/repeat-test.mscz (5 Takte, Takt 1 = elid 0 spielt
	// wegen der Wiederholung zweimal, bei t=0 und t=4000).
	const measuresTimeline = buildTimeline({
		events: [
			{ elid: 0, timeMs: 0 },
			{ elid: 1, timeMs: 2000 },
			{ elid: 0, timeMs: 4000 },
			{ elid: 2, timeMs: 6000 },
			{ elid: 3, timeMs: 8000 },
			{ elid: 4, timeMs: 10000 },
		],
		elements: {},
	})

	it('findet den ERSTEN Durchlauf eines Taktes, nicht spätere Wiederholungen', () => {
		expect(findMeasureStartTime(measuresTimeline, 1)).toBe(0)
	})

	it('findet spätere Takte unabhängig von vorherigen Wiederholungen', () => {
		expect(findMeasureStartTime(measuresTimeline, 3)).toBe(6000)
		expect(findMeasureStartTime(measuresTimeline, 5)).toBe(10000)
	})

	it('liefert null für eine nicht vorhandene Taktnummer', () => {
		expect(findMeasureStartTime(measuresTimeline, 99)).toBeNull()
	})
})

describe('resolveMeasurePosition / measurePositionToTimeMs', () => {
	// sidecar/testdata/repeat-test.mscz-Struktur (M7): Takt 1 (elid 0) t=0,
	// Takt 2 (elid 1) t=2000, Takt 1 zweiter Durchlauf t=4000, Takt 3
	// (elid 2) t=6000, Takt 4 (elid 3) t=8000, Takt 5 (elid 4) t=10000.
	// Stückende (Annahme) t=11500.
	const measuresTimeline = buildTimeline({
		events: [
			{ elid: 0, timeMs: 0 },
			{ elid: 1, timeMs: 2000 },
			{ elid: 0, timeMs: 4000 },
			{ elid: 2, timeMs: 6000 },
			{ elid: 3, timeMs: 8000 },
			{ elid: 4, timeMs: 10000 },
		],
		elements: {},
	})
	const DURATION_MS = 11500

	it('löst eine Zeit in Taktnummer + Bruchteil auf', () => {
		expect(resolveMeasurePosition(measuresTimeline, 0, DURATION_MS)).toEqual({ measureNumber: 1, fraction: 0 })
		expect(resolveMeasurePosition(measuresTimeline, 1000, DURATION_MS)).toEqual({ measureNumber: 1, fraction: 0.5 })
		expect(resolveMeasurePosition(measuresTimeline, 10750, DURATION_MS)).toEqual({ measureNumber: 5, fraction: 0.5 })
	})

	it('behandelt eine Wiederholung als eigenen (späteren) Zeitpunkt desselben Taktes', () => {
		// t=4500 liegt im ZWEITEN Durchlauf von Takt 1 (t=4000-6000).
		expect(resolveMeasurePosition(measuresTimeline, 4500, DURATION_MS)).toEqual({ measureNumber: 1, fraction: 0.25 })
	})

	it('ist die Umkehrung von findMeasureStartTime/measurePositionToTimeMs für den ersten Durchlauf', () => {
		expect(measurePositionToTimeMs(measuresTimeline, 1, 0, DURATION_MS)).toBe(0)
		expect(measurePositionToTimeMs(measuresTimeline, 1, 0.5, DURATION_MS)).toBe(1000)
		expect(measurePositionToTimeMs(measuresTimeline, 5, 0.5, DURATION_MS)).toBe(10750)
	})

	it('liefert null für eine nicht vorhandene Taktnummer', () => {
		expect(measurePositionToTimeMs(measuresTimeline, 99, 0, DURATION_MS)).toBeNull()
	})

	it('liefert null für eine leere Timeline', () => {
		expect(resolveMeasurePosition(buildTimeline({ events: [] }), 100, DURATION_MS)).toBeNull()
	})
})

describe('findElementAtPoint', () => {
	const elements = {
		0: { page: 0, x: 10, y: 10, w: 5, h: 5 },
		1: { page: 0, x: 30, y: 10, w: 5, h: 5 },
		2: { page: 1, x: 10, y: 10, w: 5, h: 5 },
	}

	it('trifft ein Element direkt, wenn der Punkt in seinem Rechteck liegt', () => {
		expect(findElementAtPoint(elements, 0, 12, 12)).toBe(0)
		expect(findElementAtPoint(elements, 0, 32, 12)).toBe(1)
	})

	it('findet das nächstgelegene Element, wenn kein Rechteck getroffen wird', () => {
		expect(findElementAtPoint(elements, 0, 11, 11)).toBe(0)
		expect(findElementAtPoint(elements, 0, 29, 11)).toBe(1)
	})

	it('berücksichtigt nur Elemente der angegebenen Seite', () => {
		expect(findElementAtPoint(elements, 1, 12, 12)).toBe(2)
	})

	it('liefert null ohne Elemente auf der Seite', () => {
		expect(findElementAtPoint(elements, 5, 0, 0)).toBeNull()
	})

	// --- Trefferradius -----------------------------------------

	it('liefert null, wenn nichts innerhalb des Trefferradius liegt', () => {
		// Weit weg vom naechsten Rechteck (Rand der Seite, leerer Raum unter
		// dem letzten System): frueher sprang die Wiedergabe trotzdem.
		expect(findElementAtPoint(elements, 0, 10000, 10000)).toBeNull()
	})

	it('nimmt einen knappen Fehlgriff noch an', () => {
		// Direkt neben dem Rechteck von Element 0 - das ist "gezielt und knapp
		// daneben", nicht "irgendwo hin geklickt".
		expect(findElementAtPoint(elements, 0, 9, 12)).toBe(0)
		expect(findElementAtPoint(elements, 0, 12, 8)).toBe(0)
	})

	it('nimmt den Radius als Parameter entgegen', () => {
		// Abstand zum Rechteck von Element 0 ist genau 5 (x=20 gegen
		// rechte Kante bei 15).
		expect(findElementAtPoint(elements, 0, 20, 12, 5)).toBe(0)
		expect(findElementAtPoint(elements, 0, 20, 12, 4)).toBeNull()
	})

	it('misst den Abstand zum Rechteck, nicht zum Mittelpunkt', () => {
		// Der Fall aus mehrsystemigen Partituren: ein sehr hohes Element
		// (Systemhoehe, gemessen bis 4531 Einheiten) neben einem kleinen.
		// Der Punkt liegt IM hohen Rechteck - der Mittelpunktabstand haette
		// das kleine Element bevorzugt und damit eine Zeile zu hoch gesprungen.
		const hoch = {
			0: { page: 0, x: 0, y: 0, w: 10, h: 1000 },
			1: { page: 0, x: 40, y: 480, w: 10, h: 10 },
		}
		expect(findElementAtPoint(hoch, 0, 5, 900)).toBe(0)
	})
})

describe('findNearestOccurrenceTimeMs', () => {
	const events = [
		{ elid: 0, timeMs: 0 },
		{ elid: 1, timeMs: 500 },
		{ elid: 0, timeMs: 4000 },
		{ elid: 0, timeMs: 9000 },
	]

	it('wählt das zeitlich nächstgelegene Vorkommen eines wiederholten elid', () => {
		expect(findNearestOccurrenceTimeMs(events, 0, 3500)).toBe(4000)
		expect(findNearestOccurrenceTimeMs(events, 0, 100)).toBe(0)
		expect(findNearestOccurrenceTimeMs(events, 0, 7000)).toBe(9000)
	})

	it('liefert null für ein elid ohne Vorkommen', () => {
		expect(findNearestOccurrenceTimeMs(events, 99, 0)).toBeNull()
	})
})

describe('parseViewBox', () => {
	it('parst viewBox-Attribute aus einem SVG-Wurzelelement', () => {
		const svg = '<svg width="210mm" height="297mm" viewBox="0 0 9924 14028" xmlns="http://www.w3.org/2000/svg">'
		expect(parseViewBox(svg)).toEqual({ minX: 0, minY: 0, width: 9924, height: 14028 })
	})

	it('liefert null ohne viewBox-Attribut', () => {
		expect(parseViewBox('<svg width="1" height="1">')).toBeNull()
	})
})

describe('parseSvgSizeMm', () => {
	it('parst die physische Seitengröße aus dem SVG-Wurzelelement', () => {
		const svg = '<svg width="210.058mm" height="296.926mm" viewBox="0 0 9924 14028" xmlns="http://www.w3.org/2000/svg">'
		expect(parseSvgSizeMm(svg)).toEqual({ widthMm: 210.058, heightMm: 296.926 })
	})

	it('liefert null ohne mm-Größenangabe', () => {
		expect(parseSvgSizeMm('<svg viewBox="0 0 1 1">')).toBeNull()
	})
})

describe('Zoom-Presets', () => {
	it('computeFitWidthZoom liefert 1 bei Basisbreite, skaliert linear', () => {
		expect(computeFitWidthZoom(BASE_PAGE_WIDTH_PX)).toBe(1)
		expect(computeFitWidthZoom(BASE_PAGE_WIDTH_PX * 2)).toBe(2)
		expect(computeFitWidthZoom(BASE_PAGE_WIDTH_PX / 2)).toBe(0.5)
	})

	it('computeFitPageZoom wählt die engere von Breiten-/Höhenschranke (Hochformat, niedriger Container)', () => {
		// A4-Seitenverhältnis (aus M4: viewBox 0 0 9924 14028). Container ist
		// breiter als hoch (Querformat-Fullscreen) - die Höhe limitiert.
		const viewBox = { width: 9924, height: 14028 }
		const zoom = computeFitPageZoom(viewBox, 2000, 800)
		// äquivalente Breite für volle Höhe: 800 * (9924/14028)
		const expectedWidthPx = 800 * (9924 / 14028)
		expect(zoom).toBeCloseTo(expectedWidthPx / BASE_PAGE_WIDTH_PX, 6)
	})

	it('computeFitPageZoom wählt die Breitenschranke, wenn die Höhe reichlich vorhanden ist', () => {
		const viewBox = { width: 9924, height: 14028 }
		const zoom = computeFitPageZoom(viewBox, 400, 5000)
		expect(zoom).toBeCloseTo(400 / BASE_PAGE_WIDTH_PX, 6)
	})

	it('computeActualSizeZoom rechnet A4-Breite (210mm) auf CSS-Pixel bei 96dpi um', () => {
		const zoom = computeActualSizeZoom({ widthMm: 210, heightMm: 297 })
		const expectedWidthPx = 210 * (96 / 25.4)
		expect(zoom).toBeCloseTo(expectedWidthPx / BASE_PAGE_WIDTH_PX, 6)
	})

	it('computeActualSizeZoom liefert 1 ohne bekannte Seitengröße', () => {
		expect(computeActualSizeZoom(null)).toBe(1)
	})
})

// Die sanitizeSvg-Tests sind nach svgSanitizer.test.js gewandert (DOMPurify
// statt Regex - braucht ein DOM, siehe dortiger @vitest-environment-Hinweis).
// Diese Datei bleibt DOM-frei.

describe('computePinchZoom', () => {
	it('verdoppelt den Zoom, wenn sich der Fingerabstand verdoppelt', () => {
		expect(computePinchZoom(100, 200, 1)).toBe(2)
	})

	it('halbiert den Zoom, wenn sich der Fingerabstand halbiert', () => {
		expect(computePinchZoom(200, 100, 1)).toBe(0.5)
	})

	it('begrenzt auf die Standardgrenzen (MIN_ZOOM-MAX_ZOOM)', () => {
		expect(computePinchZoom(100, 1000, 1)).toBe(MAX_ZOOM)
		expect(computePinchZoom(100, 10, 1)).toBe(MIN_ZOOM)
	})

	it('erlaubt eigene Grenzen', () => {
		expect(computePinchZoom(100, 1000, 1, { min: 0.2, max: 3 })).toBe(3)
	})

	it('liefert den Startzoom unverändert bei ungültigem Startabstand (Divisionsschutz)', () => {
		expect(computePinchZoom(0, 100, 1.5)).toBe(1.5)
	})
})
