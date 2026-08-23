// Reine, DOM-freie Zuordnungslogik zwischen Wiedergabezeit und
// Seiten-Koordinate, für den Overlay-Cursor aus Phase 8 (siehe PLAN.md
// Abschnitt 2 - der Cursor ist ein Overlay über bekannten SVG-Koordinaten,
// kein Renderer-interner Zustand wie beim vorherigen OSMD-Cursor).

import { findStepIndex } from './timingSync.js'

/**
 * @typedef {{events: Array<{elid:number,timeMs:number}>, elements: Object<string,{page:number,x:number,y:number,w:number,h:number}>}} TimingJson
 * @typedef {{events: Array<{elid:number,timeMs:number}>, times: number[], elements: Object<string,{page:number,x:number,y:number,w:number,h:number}>}} Timeline
 */

/**
 * @param {TimingJson} timingJson vom Sidecar bereits sortiert und mit
 *   Koordinaten in SVG-Einheiten geliefert (siehe sidecar/README.md)
 * @returns {Timeline}
 */
export function buildTimeline(timingJson) {
	const events = timingJson.events ?? []
	return {
		events,
		times: events.map((e) => e.timeMs),
		elements: timingJson.elements ?? {},
	}
}

/**
 * Liefert das Rechteck (in SVG-Einheiten der jeweiligen Seite) des Elements,
 * das zur gegebenen Wiedergabezeit aktuell ist, oder null, wenn die Timeline
 * leer ist. Ein `elid` kann mehrfach in `events` auftreten (Wiederholungen/
 * Volta, siehe PLAN.md M7) - das ist hier kein Sonderfall: es wird einfach
 * jedes Mal dieselbe Koordinate nachgeschlagen, wenn die Zeit erneut über
 * dieses `elid` läuft.
 *
 * @param {Timeline} timeline
 * @param {number} timeMs
 * @returns {{page:number,x:number,y:number,w:number,h:number}|null}
 */
export function resolveCursorRect(timeline, timeMs) {
	if (timeline.events.length === 0) {
		return null
	}
	const index = findStepIndex(timeline.times, timeMs)
	const elid = timeline.events[index].elid
	return timeline.elements[String(elid)] ?? null
}

/**
 * Parst `viewBox="minX minY width height"` aus einem SVG-Wurzelelement.
 * Eigener schlanker Parser statt DOMParser, weil das nur auf den Anfang des
 * Textes zugreifen muss (kein voller SVG-Parse-Overhead pro Seite) - siehe
 * PLAN.md M4 für die Bedeutung dieser Werte (SVG-Koordinatenraum, in den
 * die Sidecar-Timingkoordinaten bereits umgerechnet sind).
 *
 * @param {string} svgText
 * @returns {{minX:number,minY:number,width:number,height:number}|null}
 */
export function parseViewBox(svgText) {
	const match = svgText.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/)
	if (!match) {
		return null
	}
	const [minX, minY, width, height] = match.slice(1).map(Number)
	return { minX, minY, width, height }
}

/**
 * Zeitpunkt, an dem Takt `measureNumber` (1-indiziert, wie im gedruckten
 * Notenbild) zum ERSTEN Mal erklingt - für "springe zu Takt N" (Phase 10).
 * `measures.json`s `elid` ist die Dokumentreihenfolge der Takte (0-indiziert,
 * siehe sidecar/README.md) - Takt N entspricht also elid N-1. Bei
 * Wiederholungen kann derselbe Takt mehrfach in `events` auftauchen (M7);
 * `.find()` liefert bewusst das chronologisch erste Vorkommen, weil "spring
 * zu Takt 5" in einer Probe intuitiv "zum ersten Mal, wo Takt 5 gespielt
 * wird" meint.
 *
 * @param {Timeline} measuresTimeline aus measures.json (buildTimeline)
 * @param {number} measureNumber 1-indiziert
 * @returns {number|null}
 */
export function findMeasureStartTime(measuresTimeline, measureNumber) {
	const targetElid = measureNumber - 1
	const event = measuresTimeline.events.find((e) => e.elid === targetElid)
	return event ? event.timeMs : null
}

/**
 * Findet das Element auf einer Seite, dessen Rechteck den Klickpunkt
 * enthält, sonst das nächstgelegene (Mittelpunktabstand) - Umkehrung von
 * M4 (Koordinate -> elid) für "Klick auf eine Note springt dorthin"
 * (Phase 10).
 *
 * @param {Timeline['elements']} elements
 * @param {number} page
 * @param {number} x SVG-Einheiten der Seite
 * @param {number} y SVG-Einheiten der Seite
 * @returns {number|null} elid
 */
export function findElementAtPoint(elements, page, x, y) {
	let best = null
	let bestDistSq = Infinity
	for (const [elidStr, rect] of Object.entries(elements)) {
		if (rect.page !== page) {
			continue
		}
		if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
			return Number(elidStr)
		}
		const cx = rect.x + rect.w / 2
		const cy = rect.y + rect.h / 2
		const distSq = (cx - x) ** 2 + (cy - y) ** 2
		if (distSq < bestDistSq) {
			bestDistSq = distSq
			best = Number(elidStr)
		}
	}
	return best
}

/**
 * Ein `elid` kann mehrfach in `events` vorkommen (Wiederholungen, M7) - ein
 * Klick auf eine Note ist deshalb zeitlich mehrdeutig. Springt zum
 * Vorkommen, das der aktuellen Wiedergabezeit am nächsten liegt (fühlt sich
 * beim Klicken nahe der aktuellen Position wie eine Feinkorrektur an, statt
 * quer durchs Stück zu springen), nicht immer zum ersten.
 *
 * @param {Array<{elid:number,timeMs:number}>} events
 * @param {number} elid
 * @param {number} referenceTimeMs
 * @returns {number|null}
 */
export function findNearestOccurrenceTimeMs(events, elid, referenceTimeMs) {
	const matches = events.filter((e) => e.elid === elid)
	if (matches.length === 0) {
		return null
	}
	return matches.reduce((best, e) => (
		Math.abs(e.timeMs - referenceTimeMs) < Math.abs(best.timeMs - referenceTimeMs) ? e : best
	)).timeMs
}

/**
 * Zerlegt eine Wiedergabezeit in einen musikalischen Anker (Taktnummer +
 * Bruchteil innerhalb des Taktes) - der Anker für private Notizen (Phase
 * 11, siehe Migration `Version000100Date20260823130000`). Bewusst
 * musikalisch statt Pixel-/Renderer-Index, weil nur das ein Neurendern und
 * die meisten Quelldatei-Bearbeitungen übersteht.
 *
 * @param {Timeline} measuresTimeline aus measures.json
 * @param {number} timeMs
 * @param {number} totalDurationMs Fallback-Taktende für den letzten Takt
 *   (measures.json liefert keinen Endzeitpunkt für den allerletzten Takt)
 * @returns {{measureNumber:number, fraction:number}|null}
 */
export function resolveMeasurePosition(measuresTimeline, timeMs, totalDurationMs) {
	if (measuresTimeline.events.length === 0) {
		return null
	}
	const index = findStepIndex(measuresTimeline.times, timeMs)
	const event = measuresTimeline.events[index]
	const measureStartMs = event.timeMs
	const nextMs = index + 1 < measuresTimeline.events.length
		? measuresTimeline.events[index + 1].timeMs
		: totalDurationMs
	const span = nextMs - measureStartMs
	const fraction = span > 0 ? Math.min(1, Math.max(0, (timeMs - measureStartMs) / span)) : 0
	return { measureNumber: event.elid + 1, fraction }
}

/**
 * Umkehrung von `resolveMeasurePosition` - löst einen gespeicherten Anker
 * wieder in eine Wiedergabezeit auf (Phase 11, "zu einer Notiz springen").
 * Verwendet wie `findMeasureStartTime` bewusst das ERSTE Vorkommen des
 * Taktes (siehe dort) - eine Notiz zeigt auf "diesen Takt", nicht auf einen
 * bestimmten Wiederholungsdurchgang.
 *
 * @param {Timeline} measuresTimeline
 * @param {number} measureNumber
 * @param {number} fraction
 * @param {number} totalDurationMs
 * @returns {number|null}
 */
export function measurePositionToTimeMs(measuresTimeline, measureNumber, fraction, totalDurationMs) {
	const targetElid = measureNumber - 1
	const index = measuresTimeline.events.findIndex((e) => e.elid === targetElid)
	if (index === -1) {
		return null
	}
	const measureStartMs = measuresTimeline.events[index].timeMs
	const nextMs = index + 1 < measuresTimeline.events.length
		? measuresTimeline.events[index + 1].timeMs
		: totalDurationMs
	return measureStartMs + fraction * (nextMs - measureStartMs)
}

// Basisbreite einer Seite bei Zoom 1 (px), siehe ScorePage.vue `pageStyle`
// (`maxWidth: BASE_PAGE_WIDTH_PX * zoom`). Einzige Quelle für diese Zahl -
// die Zoom-Presets unten rechnen relativ dazu, damit ScorePage.vue und
// scoreLayout.js nie auseinanderlaufen können.
export const BASE_PAGE_WIDTH_PX = 900

// CSS-px pro mm bei 96 DPI (Standardannahme für den CSS-Pixel, siehe
// CSS Values and Units Module - 1in = 96px = 25.4mm).
const CSS_PX_PER_MM = 96 / 25.4

/**
 * Parst die physische Seitengröße `width="…mm" height="…mm"` aus dem
 * SVG-Wurzelelement (Phase 16, Zoom-Preset "100%") - getrennt von
 * `parseViewBox`, weil beide Angaben unabhängig gebraucht werden (viewBox
 * für Koordinaten, diese hier nur für die echte Größe).
 *
 * @param {string} svgText
 * @returns {{widthMm:number,heightMm:number}|null}
 */
export function parseSvgSizeMm(svgText) {
	const match = svgText.match(/width="([\d.]+)mm"\s+height="([\d.]+)mm"/)
	if (!match) {
		return null
	}
	const [widthMm, heightMm] = match.slice(1).map(Number)
	return { widthMm, heightMm }
}

/**
 * Zoom-Preset "Seitenbreite" (Phase 16): die Seite füllt die verfügbare
 * Breite. Reine Dreisatzrechnung gegen BASE_PAGE_WIDTH_PX, weil
 * ScorePage.vue seine `max-width` genauso ausdrückt.
 *
 * @param {number} containerWidthPx verfügbare Breite (z.B. Breite von
 *   `.scoreview-pages`)
 * @returns {number} zoom
 */
export function computeFitWidthZoom(containerWidthPx) {
	return containerWidthPx / BASE_PAGE_WIDTH_PX
}

/**
 * Zoom-Preset "ganze Seite" (Phase 16): die komplette A4-Seite (Breite UND
 * Höhe) muss in den verfügbaren Bereich passen. Weil ScorePage.vue Höhe nur
 * indirekt über `aspect-ratio` aus der Breite ableitet (siehe dortiger
 * Kommentar zur "höhenbezogenen Skalierung"), rechnet diese Funktion die
 * Höhenschranke in eine äquivalente Breite um: bei fester `aspect-ratio` legt
 * die Breite die Höhe vollständig fest, ein zweiter CSS-Mechanismus ist
 * dafür nicht nötig.
 *
 * @param {{width:number,height:number}} viewBox aus parseViewBox()
 * @param {number} containerWidthPx
 * @param {number} containerHeightPx
 * @returns {number} zoom
 */
export function computeFitPageZoom(viewBox, containerWidthPx, containerHeightPx) {
	const widthForFullHeight = containerHeightPx * (viewBox.width / viewBox.height)
	const targetWidthPx = Math.min(containerWidthPx, widthForFullHeight)
	return targetWidthPx / BASE_PAGE_WIDTH_PX
}

/**
 * Zoom-Preset "100%" (Phase 16): die Seite in ihrer echten physischen Größe
 * (A4 = 210mm Breite), umgerechnet auf CSS-Pixel bei 96 DPI - unabhängig vom
 * gewählten BASE_PAGE_WIDTH_PX-Basiswert.
 *
 * @param {{widthMm:number,heightMm:number}|null} sizeMm aus parseSvgSizeMm()
 * @returns {number} zoom, 1 falls sizeMm unbekannt (z.B. Seite noch nicht geladen)
 */
export function computeActualSizeZoom(sizeMm) {
	if (!sizeMm) {
		return 1
	}
	return (sizeMm.widthMm * CSS_PX_PER_MM) / BASE_PAGE_WIDTH_PX
}

/**
 * Pinch-Zoom (Phase 19): reine Verhältnisrechnung aus zwei Fingerabständen,
 * relativ zum Zoom bei Gestenbeginn - die eigentliche Touch-Ereignisverarbeitung
 * (Geste erkennen, Abstand messen, Browser-eigenen Seiten-Zoom währenddessen
 * unterdrücken) lebt in ScoreViewer.vue, hier nur die Zahl.
 *
 * @param {number} startDistance Fingerabstand (px) beim Start der Geste
 * @param {number} currentDistance Fingerabstand (px) aktuell
 * @param {number} startZoom Zoom-Wert bei Gestenbeginn
 * @param {{min?:number,max?:number}} [bounds] wie beim stufenlosen Zoom-Regler (0,5-2)
 * @returns {number}
 */
export function computePinchZoom(startDistance, currentDistance, startZoom, { min = 0.5, max = 2 } = {}) {
	if (startDistance <= 0) {
		return startZoom
	}
	const zoom = startZoom * (currentDistance / startDistance)
	return Math.min(max, Math.max(min, zoom))
}

// `sanitizeSvg()` lebte bis Phase 20 hier als regexbasierte Fassung und ist
// nach `svgSanitizer.js` gewandert (DOMPurify, echtes Parsen statt
// Textersetzung). Grund war eine Messung, keine Stilfrage: die alte Fassung
// liess 9 von 15 geprueften Umgehungsmustern durch - siehe PLAN.md Phase 20
// und den Kommentar in svgSanitizer.js. Diese Datei bleibt bewusst DOM-frei
// (CLAUDE.md), der Sanitizer braucht dagegen ein DOM.
