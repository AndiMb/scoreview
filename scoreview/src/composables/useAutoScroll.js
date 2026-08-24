import { planAutoScroll, planHorizontalScroll, shouldSuppressAutoScroll } from '../lib/scrollPlan.js'

// Pausendauer für das Nachführen nach manuellem Scrollen (siehe
// scrollPlan.js) - lang genug, um in Ruhe zu lesen, kurz genug, um nicht wie
// ein Hänger zu wirken.
const MANUAL_SCROLL_RESUME_MS = 2500

// Wie lange nach einem selbst ausgelösten scrollTo() eingehende scroll-Events
// als "programmatisch" gelten, nicht als manuelles Scrollen (siehe
// onUserScroll) - großzügig über der CSS-smooth-scroll-Dauer, damit kein
// Nachzittern fälschlich als Nutzereingriff gilt.
const PROGRAMMATIC_SCROLL_WINDOW_MS = 700

/**
 * Führt das Notenbild der Wiedergabe nach und hält sich zurück, solange
 * jemand selbst scrollt.
 *
 * Viertes Composable aus der Zerlegung von `ScoreViewer.vue`. Hier steht
 * ausschließlich die
 * **DOM-Messung**; die Entscheidung „ob und wohin" ist reine Rechnung und
 * bleibt in `scrollPlan.js`, wo sie ohne Browser getestet wird.
 *
 * Auch die Referenzen auf die Seitenkomponenten leben hier: sie werden nur
 * gebraucht, um den Cursor auf dem Bildschirm zu messen
 * (`getCursorClientRect()`), und gehören damit zu dieser Aufgabe.
 *
 * @param {object} deps
 * @param {() => HTMLElement|null} deps.scrollEl das scrollende Element
 */
export function useAutoScroll({ scrollEl }) {
	// Referenzen auf die ScorePage-Komponenten, je Seitenindex.
	const pageRefs = []
	// Zeitstempel (Date.now()) des letzten erkannten MANUELLEN Scrollens.
	let lastManualScrollAt = null
	// Bis zu diesem Zeitpunkt gelten scroll-Events als von uns selbst
	// ausgelöst, nicht als Nutzereingriff.
	let ignoreScrollUntil = 0

	function setPageRef(el, index) {
		if (el) {
			pageRefs[index] = el
		} else {
			delete pageRefs[index]
		}
	}

	function scrollTo(targetScrollTop, targetScrollLeft = null) {
		const el = scrollEl()
		if (!el) {
			return
		}
		const clamp = (value, max) => Math.min(Math.max(0, value), Math.max(0, max))
		const options = { behavior: 'smooth' }
		if (targetScrollTop !== null) {
			options.top = clamp(targetScrollTop, el.scrollHeight - el.clientHeight)
		}
		if (targetScrollLeft !== null) {
			options.left = clamp(targetScrollLeft, el.scrollWidth - el.clientWidth)
		}
		// Markiert die eigenen, dadurch ausgelösten scroll-Events als
		// "programmatisch" (siehe onUserScroll) - sonst würde unser eigenes
		// Nachführen sich selbst als manuellen Scroll auslegen und sofort
		// wieder pausieren.
		ignoreScrollUntil = Date.now() + PROGRAMMATIC_SCROLL_WINDOW_MS
		el.scrollTo(options)
	}

	/**
	 * Läuft bei jedem Notenwechsel (siehe useScoreSync.js), nicht jeden
	 * rAF-Frame - plus einmal nach jedem Zoomwechsel, dann mit `force`: ein
	 * Zoomwechsel ist eine ausdrückliche Handlung, keine Störung des Lesens
	 * wie ein manueller Scroll.
	 *
	 * @param {{page:number,x:number,y:number,w:number,h:number}|null} rect
	 * @param {boolean} [force] Nachführen auch kurz nach manuellem Scrollen
	 */
	function update(rect, force = false) {
		const el = scrollEl()
		if (!rect || !el) {
			return
		}
		if (!force && shouldSuppressAutoScroll(lastManualScrollAt, Date.now(), MANUAL_SCROLL_RESUME_MS)) {
			return
		}
		const pageEl = pageRefs[rect.page]
		const containerRect = el.getBoundingClientRect()
		const cursorClientRect = pageEl?.getCursorClientRect?.()
		if (!cursorClientRect) {
			// Die Zielseite ist noch nicht geladen (IntersectionObserver hat sie
			// noch nicht ausgelöst, siehe ScorePage.vue) - kommt bei einem weiten
			// Sprung vor (z.B. "springe zu Takt 60"), bei dem noch nie in die Nähe
			// dieser Seite gescrollt wurde. Grob zur Seite selbst scrollen (die
			// reserviert ihre Höhe schon vor dem Laden, siehe dortiger Kommentar
			// zu aspectRatio, ist also schon jetzt messbar) - das bringt sie ins
			// Ladefenster, der nächste Notenwechsel-Tick übernimmt dann über den
			// dann verfügbaren Cursor die genaue Position. scrollTo() (nicht
			// scrollIntoView) hier bewusst, damit dieser Scroll ebenfalls als
			// "programmatisch" markiert wird - sonst würde er sich selbst als
			// manuelles Scrollen auslegen und den nachfolgenden genauen Scroll
			// sofort wieder unterdrücken.
			const pageClientRect = pageEl?.$el?.getBoundingClientRect?.()
			if (pageClientRect) {
				scrollTo(el.scrollTop + (pageClientRect.top - containerRect.top))
			}
			return
		}
		const target = planAutoScroll({
			cursorTop: el.scrollTop + (cursorClientRect.top - containerRect.top),
			cursorHeight: cursorClientRect.height,
			scrollTop: el.scrollTop,
			viewportHeight: el.clientHeight,
		})
		// Waagerecht nur, wenn die Seite überhaupt breiter als das Bild ist
		// (siehe ScorePage.vue) - sonst wäre jeder Aufruf eine überflüssige
		// DOM-Schreiboperation.
		let targetLeft = null
		if (el.scrollWidth > el.clientWidth) {
			targetLeft = planHorizontalScroll({
				cursorLeft: el.scrollLeft + (cursorClientRect.left - containerRect.left),
				cursorWidth: cursorClientRect.width,
				scrollLeft: el.scrollLeft,
				viewportWidth: el.clientWidth,
			})
		}
		if (target !== null || targetLeft !== null) {
			scrollTo(target, targetLeft)
		}
	}

	/**
	 * Erkennt manuelles Scrollen ("bei manuellem Scrollen aussetzen und nach
	 * kurzer Zeit wieder übernehmen") - jedes scroll-Event, das nicht
	 * innerhalb des Ignorierfensters eines eigenen scrollTo() liegt, gilt als
	 * Nutzereingriff.
	 */
	function onUserScroll() {
		if (Date.now() < ignoreScrollUntil) {
			return
		}
		lastManualScrollAt = Date.now()
	}

	function reset() {
		pageRefs.length = 0
		lastManualScrollAt = null
		ignoreScrollUntil = 0
	}

	return { setPageRef, update, onUserScroll, reset }
}
