import { groupRows, groupSystems, nextRowScrollTop, nextScrollTop } from '../lib/pagingPlan.js'

/**
 * Blaettern um einen Ausschnitt: PageDown/PageUp, im Aufführungsmodus
 * auch die Pfeile (lib/keyMap.js). Hier steht nur die DOM-Messung - wohin
 * geblaettert wird, entscheidet lib/pagingPlan.js.
 *
 * Die Systeme kommen aus measures.json, nicht aus dem SVG: Die Taktrechtecke
 * gibt es fuer JEDE Seite, auch fuer eine, deren Notenbild gerade nicht
 * geladen ist (ScorePage.vue gibt entfernte Seiten frei). Gebraucht wird nur
 * die `viewBox` einer Seite, und die behaelt sie nach dem ersten Laden.
 *
 * @param {object} deps
 * @param {() => HTMLElement|null} deps.scrollEl
 * @param {() => Array<object>} deps.pages ScorePage-Komponenten je Seitenindex
 * @param {(pageIndex: number) => Array<object>} deps.measureRects Taktrechtecke einer Seite
 * @param {() => void} deps.onManualScroll das Autoscroll pausieren (es ist ein Nutzereingriff)
 * @param {() => boolean} [deps.spread] two pages side by side (A2): page by rows
 * @return {{page: (dir: number) => void, systemRects: () => Array}}
 */
export function usePaging({ scrollEl, pages, measureRects, onManualScroll, spread = () => false }) {
	/**
	 * Alle Systeme in Scroll-Koordinaten (scrollTop-Basis).
	 *
	 * @return {Array<{top:number, bottom:number}>}
	 */
	function systemRects() {
		const el = scrollEl()
		if (!el) {
			return []
		}
		const container = el.getBoundingClientRect()
		const result = []
		pages().forEach((page, index) => {
			const box = page?.viewBox
			const pageEl = page?.$el
			if (!box || !pageEl) {
				// Noch nie geladen: Die Seite hat nur eine geschaetzte Hoehe
				// (A4-Naeherung), ihre Systeme lassen sich nicht verorten. Das
				// Blaettern faellt dort auf den festen Schritt zurueck.
				return
			}
			const rect = pageEl.getBoundingClientRect()
			const scale = rect.height / box.height
			const pageTop = el.scrollTop + (rect.top - container.top)
			for (const system of groupSystems(measureRects(index))) {
				result.push({
					top: pageTop + (system.top - box.minY) * scale,
					bottom: pageTop + (system.bottom - box.minY) * scale,
				})
			}
		})
		return result
	}

	/**
	 * Every page in scroll coordinates - also one that was never loaded: its
	 * estimated height still places it in its row, which is all the row rule
	 * needs.
	 *
	 * @return {Array<{top:number, bottom:number}>}
	 */
	function pageRects() {
		const el = scrollEl()
		if (!el) {
			return []
		}
		const container = el.getBoundingClientRect()
		return pages().filter((page) => page?.$el).map((page) => {
			const rect = page.$el.getBoundingClientRect()
			const top = el.scrollTop + (rect.top - container.top)
			return { top, bottom: top + rect.height }
		})
	}

	/**
	 * Einen Schritt blaettern. Ohne weiches Scrollen: Ein Pedal, zweimal
	 * schnell getreten, muss zweimal genau eine Seitenwende ergeben - waehrend
	 * einer Gleitbewegung stuende der zweite Schritt auf einer
	 * Zwischenposition.
	 *
	 * @param {number} dir +1 vorwaerts, -1 zurueck
	 */
	function page(dir) {
		const el = scrollEl()
		if (!el) {
			return
		}
		const viewport = { height: el.clientHeight, maxScrollTop: Math.max(0, el.scrollHeight - el.clientHeight) }
		const target = spread()
			? nextRowScrollTop(groupRows(pageRects()), systemRects(), viewport, el.scrollTop, dir)
			: nextScrollTop(systemRects(), viewport, el.scrollTop, dir)
		onManualScroll()
		el.scrollTo({ top: target, behavior: 'auto' })
	}

	return { page, systemRects }
}
