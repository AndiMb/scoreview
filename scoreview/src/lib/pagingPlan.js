// Blaettern um einen Ausschnitt: Das letzte
// vollstaendig sichtbare System kommt nach oben. Das ist die halbe Seitenwende
// aus dem Notenheft, uebertragen auf ein Scroll-Layout - es geht nie eine
// Zeile verloren, und die Zeile, die man gerade zu Ende liest, bleibt als
// Anschluss stehen.
//
// Rein, ohne DOM: Der Aufrufer (usePaging.js) misst die Systeme in
// Scroll-Koordinaten und wendet das Ziel an. Hier faellt nur die
// Entscheidung, wohin.

/** Abstand des Systems zum Rand des Ausschnitts in px. */
const DEFAULT_MARGIN_PX = 8

/**
 * Ohne ein einziges vollstaendiges System (starker Zoom, Orchesterpartitur)
 * gibt es keine Zeile, an der sich ausrichten liesse. Dann um diesen Anteil
 * des Ausschnitts weiter - der Rest bleibt als Ueberlappung stehen, damit das
 * Auge den Anschluss findet.
 */
const FALLBACK_STEP = 0.85

/**
 * Ein Schritt, der den Ausschnitt um weniger als diesen Anteil bewegt, zaehlt
 * als „steht schon oben". Gemessen an Duckwerk: Am Seitenwechsel war das
 * letzte vollstaendige System oft das erste im Bild, knapp unter dem Rand -
 * PageDown schob dann nur 10-50 px weiter, und das Pedal wirkte kaputt.
 */
const MIN_STEP = 0.25

/** Rundungsrauschen aus getBoundingClientRect() bei gebrochenem Zoom. */
const EPS_PX = 1

/**
 * Taktrechtecke einer Seite (measures.json, SVG-Einheiten) zu Systemen:
 * Takte, die sich senkrecht ueberlappen, stehen im selben System.
 *
 * @param {Array<{y:number, h:number}>} measureRects
 * @return {Array<{top:number, bottom:number}>} nach Hoehe sortiert
 */
export function groupSystems(measureRects) {
	const sorted = [...(measureRects ?? [])]
		.filter((r) => Number.isFinite(r?.y) && Number.isFinite(r?.h))
		.sort((a, b) => a.y - b.y)
	const systems = []
	for (const rect of sorted) {
		const last = systems[systems.length - 1]
		if (last && rect.y < last.bottom) {
			last.bottom = Math.max(last.bottom, rect.y + rect.h)
		} else {
			systems.push({ top: rect.y, bottom: rect.y + rect.h })
		}
	}
	return systems
}

/**
 * Das Ziel fuer einen Blaetterschritt.
 *
 * @param {Array<{top:number, bottom:number}>} systemRects Systeme in
 *   Scroll-Koordinaten (scrollTop-Basis), beliebige Reihenfolge
 * @param {{height:number, maxScrollTop?:number}} viewport sichtbare Hoehe und
 *   groesstes erlaubtes scrollTop
 * @param {number} scrollTop aktuelles scrollTop
 * @param {number} dir +1 vorwaerts (PageDown), -1 zurueck (PageUp)
 * @param {{margin?:number}} [opts]
 * @return {number} neues scrollTop
 */
export function nextScrollTop(systemRects, viewport, scrollTop, dir, { margin = DEFAULT_MARGIN_PX } = {}) {
	const height = viewport.height
	const maxScrollTop = viewport.maxScrollTop ?? Infinity
	const clamp = (value) => Math.min(Math.max(0, value), maxScrollTop)
	const systems = [...(systemRects ?? [])].sort((a, b) => a.top - b.top)
	const viewTop = scrollTop
	const viewBottom = scrollTop + height
	const isFullyVisible = (s) => s.top >= viewTop - EPS_PX && s.bottom <= viewBottom + EPS_PX
	const fully = systems.filter(isFullyVisible)

	if (dir >= 0) {
		if (fully.length > 0) {
			const last = fully[fully.length - 1]
			const target = last.top - margin
			if (target > scrollTop + height * MIN_STEP) {
				return clamp(target)
			}
			// Es passt nur dieses eine System (oder es steht schon fast oben) -
			// dann das naechste nach oben,
			// aber nie weiter als bis zum bisherigen unteren Rand: Was
			// dazwischen steht (ein Seitenkopf, ein grosser Abstand), wurde
			// noch nicht gesehen.
			const next = systems.find((s) => s.top > last.top + EPS_PX)
			const limit = viewBottom - margin
			return clamp(next ? Math.min(next.top - margin, limit) : limit)
		}
		// Kein vollstaendiges System: Beginnt unten eines, das angeschnitten
		// ist, kommt es nach oben - sonst ein fester Schritt mit Ueberlappung.
		const cut = systems.find((s) => s.top - margin > scrollTop + EPS_PX && s.top < viewBottom)
		if (cut) {
			return clamp(cut.top - margin)
		}
		return clamp(scrollTop + height * FALLBACK_STEP)
	}

	// Rueckwaerts spiegelbildlich: das erste vollstaendige System nach unten.
	if (fully.length > 0) {
		const first = fully[0]
		const target = first.bottom + margin - height
		if (target < scrollTop - height * MIN_STEP) {
			return clamp(target)
		}
		const previous = [...systems].reverse().find((s) => s.bottom < first.bottom - EPS_PX)
		const limit = viewTop + margin - height
		return clamp(previous ? Math.max(previous.bottom + margin - height, limit) : limit)
	}
	const cut = [...systems].reverse().find((s) => s.bottom + margin < viewBottom - EPS_PX && s.bottom > viewTop)
	if (cut) {
		return clamp(cut.bottom + margin - height)
	}
	return clamp(scrollTop - height * FALLBACK_STEP)
}
