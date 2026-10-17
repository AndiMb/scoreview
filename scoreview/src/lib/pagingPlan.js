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

/**
 * Pages to rows: pages whose vertical extents overlap stand side by side
 * (the two-page spread, spreadLayout.js). In a single column every page is
 * its own row.
 *
 * @param {Array<{top:number, bottom:number}>} pageRects in scroll coordinates
 * @return {Array<{top:number, bottom:number}>} sorted by height
 */
export function groupRows(pageRects) {
	return groupSystems((pageRects ?? []).map((r) => ({ y: r.top, h: r.bottom - r.top })))
}

/**
 * The target of a paging step when two pages stand side by side.
 *
 * The half page turn of nextScrollTop() breaks here: it moves the last
 * system of the row to the top, so the next row is cut in half - and the
 * reader, still on the left page, would lose the top of the right page,
 * which is read later. In a spread the row is the unit of reading, so a
 * step goes from row to row. Only a row taller than the view (zoomed in
 * beyond the pair) is paged through by its systems as before; there no
 * rule keeps the reading order anyway.
 *
 * @param {Array<{top:number, bottom:number}>} rows groupRows() of the pages
 * @param {Array<{top:number, bottom:number}>} systemRects as for nextScrollTop()
 * @param {{height:number, maxScrollTop?:number}} viewport
 * @param {number} scrollTop
 * @param {number} dir +1 forward, -1 back
 * @param {{margin?:number}} [opts]
 * @return {number} new scrollTop
 */
export function nextRowScrollTop(rows, systemRects, viewport, scrollTop, dir, { margin = DEFAULT_MARGIN_PX } = {}) {
	const sorted = [...(rows ?? [])].sort((a, b) => a.top - b.top)
	const maxScrollTop = viewport.maxScrollTop ?? Infinity
	const clamp = (value) => Math.min(Math.max(0, value), maxScrollTop)
	const viewTop = scrollTop
	const viewBottom = scrollTop + viewport.height
	// The row the view starts in: the first one that reaches below its top
	// edge. After a step the view starts in the gap just above the row.
	const index = sorted.findIndex((r) => r.bottom > viewTop + EPS_PX)
	if (index === -1) {
		return nextScrollTop(systemRects, viewport, scrollTop, dir, { margin })
	}
	const row = sorted[index]
	// "In view" with a little slack: at "fit whole page" a row is exactly as
	// high as the view, but the scroll element's padding puts the first row
	// 12 px down - measured, the first PgDn then moved 20 px instead of a row.
	const slack = Math.max(EPS_PX, 2 * margin)
	if (dir >= 0) {
		const next = sorted[index + 1]
		if (next && row.bottom <= viewBottom + slack) {
			return clamp(next.top - margin)
		}
		if (row.bottom > viewBottom + slack) {
			// Taller than the view: page within the row, but not past its end.
			return Math.min(nextScrollTop(systemRects, viewport, scrollTop, dir, { margin }), clamp(row.bottom + margin - viewport.height))
		}
		return clamp(viewBottom - margin)
	}
	if (row.top < viewTop - EPS_PX - margin) {
		// Inside the row: back to its start, or by systems if it is taller.
		const back = row.bottom - row.top + 2 * margin <= viewport.height
			? row.top - margin
			: nextScrollTop(systemRects, viewport, scrollTop, dir, { margin })
		return clamp(Math.max(back, row.top - margin))
	}
	const previous = sorted[index - 1]
	return previous ? clamp(previous.top - margin) : clamp(row.top - margin)
}
