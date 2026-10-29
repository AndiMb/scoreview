import { ref } from 'vue'
import { cursorInContent, isManualScrollEnd, planAutoScroll, planHorizontalScroll, shouldSuppressAutoScroll, spanInView } from '../lib/scrollPlan.js'

// Pausendauer für das Nachführen nach manuellem Scrollen (siehe
// scrollPlan.js) - lang genug, um in Ruhe zu lesen, kurz genug, um nicht wie
// ein Hänger zu wirken. Sie läuft ab dem ENDE der Geste.
const MANUAL_SCROLL_RESUME_MS = 2500

// Ab dieser Strecke (in Vielfachen der Viewporthöhe) wird gesprungen statt
// weich gescrollt. Ein weiches Scrollen über mehrere Bildschirmhöhen ist auf
// einem Telefon weder schön noch billig - und an genau dieser Strecke zerbricht
// eine Heuristik, die nach Zeitfenstern statt nach Strecke entscheidet.
const BIG_JUMP_VIEWPORTS = 1.5

// Wie oft und in welchem Abstand das Nachfuehren erneut misst, solange die
// Zielseite ihren Cursor noch nicht hat (Seite wird erst geladen) - zusammen
// rund 3 s, so lange braucht eine Seite am Telefon hoechstens.
const RETRY_MS = 150
const RETRY_MAX = 20

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
 * gebraucht, um den Cursor auf dem Bildschirm zu finden, und gehören damit
 * zu dieser Aufgabe.
 *
 * The measuring happens rarely, not per note change: the page boxes, the
 * container's size and its scroll position are kept (`geometry`) until a
 * ResizeObserver or MutationObserver reports that something in the scroll
 * area moved, and the cursor's place on its page comes from the page itself
 * without a DOM read (ScorePage.vue#getCursorBox, scrollPlan.js#cursorInContent).
 * A forced update (an own jump, a zoom) always measures afresh - the
 * observers report only after the next layout.
 *
 * @param {object} deps
 * @param {() => HTMLElement|null} deps.scrollEl das scrollende Element
 * @param {() => boolean} [deps.enabled] whether to follow the playback at
 *   all (the user's switch, issue #12) - `force` still scrolls
 */
export function useAutoScroll({ scrollEl, enabled = () => true }) {
	// Referenzen auf die ScorePage-Komponenten, je Seitenindex.
	const pageRefs = []
	// Zeitstempel (Date.now()) des Endes der letzten Nutzergeste.
	let lastManualScrollAt = null
	// Ob gerade ein Finger auf dem Glas liegt bzw. die Maustaste unten ist.
	let gestureActive = false
	// Beginn des eigenen, noch laufenden Nachfuehrens (null = keins) und der
	// letzten Geste - fuer die Deutung von `scrollend` (scrollPlan.js).
	let ownScrollAt = null
	let lastGestureAt = null
	// Nachmessen, bis die Zielseite geladen ist (siehe update()).
	let retryTimer = null
	let retries = 0
	// The last cursor handed to update() - re-measured after a manual scroll.
	let lastRect = null
	// With autoscroll off: whether the cursor has left the screen, for the
	// button back to it. Only measured while switched off - switched on, the
	// view brings the cursor back by itself.
	const cursorOutOfView = ref(false)
	// Measured layout of the scroll area, or null when it has to be read
	// again (see the header): {scrollTop, scrollLeft, clientHeight,
	// clientWidth, scrollWidth, pages: [{top, left, width, height}] in
	// content px}.
	let geometry = null
	let watchedEl = null
	let resizeObserver = null
	let mutationObserver = null

	function invalidate() {
		geometry = null
	}

	function onScroll() {
		if (geometry && watchedEl) {
			geometry.scrollTop = watchedEl.scrollTop
			geometry.scrollLeft = watchedEl.scrollLeft
		}
	}

	/**
	 * Watches the scroll area for anything that moves a page: a size change
	 * of the container, of what sits in it (a hint above the pages) or of a
	 * page (zoom, load), and added, removed or restyled elements. The
	 * attribute filter leaves out the cursor's geometry, which changes per
	 * note and moves nothing else.
	 *
	 * @param {HTMLElement} el
	 */
	function watch(el) {
		if (el === watchedEl) {
			return
		}
		unwatch()
		watchedEl = el
		el.addEventListener?.('scroll', onScroll, { passive: true })
		if (typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(invalidate)
		}
		if (typeof MutationObserver !== 'undefined' && typeof Node !== 'undefined' && el instanceof Node) {
			mutationObserver = new MutationObserver(invalidate)
			mutationObserver.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })
		}
	}

	function unwatch() {
		watchedEl?.removeEventListener?.('scroll', onScroll)
		resizeObserver?.disconnect()
		mutationObserver?.disconnect()
		resizeObserver = null
		mutationObserver = null
		watchedEl = null
		geometry = null
	}

	/**
	 * Reads the layout of the scroll area - the one forced layout, now only
	 * after something moved.
	 *
	 * @param {HTMLElement} el
	 * @return {object}
	 */
	function measure(el) {
		watch(el)
		const box = el.getBoundingClientRect()
		const next = {
			scrollTop: el.scrollTop,
			scrollLeft: el.scrollLeft,
			clientHeight: el.clientHeight,
			clientWidth: el.clientWidth,
			scrollWidth: el.scrollWidth,
			pages: [],
		}
		// observe() is idempotent: elements that came in since are added here.
		resizeObserver?.observe(el)
		for (const child of el.children ?? []) {
			resizeObserver?.observe(child)
		}
		pageRefs.forEach((page, index) => {
			const pageEl = page?.$el
			if (!pageEl?.getBoundingClientRect) {
				return
			}
			resizeObserver?.observe(pageEl)
			const r = pageEl.getBoundingClientRect()
			next.pages[index] = {
				top: next.scrollTop + r.top - box.top,
				left: next.scrollLeft + r.left - box.left,
				width: r.width,
				height: r.height,
			}
		})
		geometry = next
		return next
	}

	/**
	 * The cursor in content px and the layout it was placed in, or null
	 * while its page has no cursor yet (not loaded).
	 *
	 * @param {HTMLElement} el
	 * @param {{page: number}} rect
	 * @param {boolean} fresh measure even if the kept layout looks valid
	 * @return {?{cursor: object, geo: object}}
	 */
	function locate(el, rect, fresh) {
		const share = pageRefs[rect.page]?.getCursorBox?.()
		if (!share) {
			return null
		}
		let geo = fresh || el !== watchedEl ? null : geometry
		if (!geo?.pages[rect.page]) {
			geo = measure(el)
		}
		const page = geo.pages[rect.page]
		return page ? { cursor: cursorInContent(page, share), geo } : null
	}

	function setPageRef(el, index) {
		if (el) {
			if (pageRefs[index] !== el) {
				geometry = null
			}
			pageRefs[index] = el
		} else if (index in pageRefs) {
			delete pageRefs[index]
			geometry = null
		}
	}

	// One callback per page index, the same on every render. An inline
	// `(el) => setPageRef(el, i)` in the template is a new function per
	// render, and Vue answers that by unsetting and setting every page ref -
	// which here would also throw away the kept layout once per note.
	const pageRefCallbacks = new Map()

	/**
	 * @param {number} index
	 * @return {(el: ?object) => void} a function ref for the page `index`
	 */
	function pageRef(index) {
		let callback = pageRefCallbacks.get(index)
		if (!callback) {
			callback = (el) => setPageRef(el, index)
			pageRefCallbacks.set(index, callback)
		}
		return callback
	}

	function scrollTo(targetScrollTop, targetScrollLeft = null) {
		const el = scrollEl()
		if (!el) {
			return
		}
		const clamp = (value, max) => Math.min(Math.max(0, value), Math.max(0, max))
		const top = targetScrollTop === null ? null : clamp(targetScrollTop, el.scrollHeight - el.clientHeight)
		const left = targetScrollLeft === null ? null : clamp(targetScrollLeft, el.scrollWidth - el.clientWidth)
		const distance = Math.max(
			top === null ? 0 : Math.abs(top - el.scrollTop),
			left === null ? 0 : Math.abs(left - el.scrollLeft),
		)
		const options = {
			// Weit springen statt weit gleiten: Ein Seitenwechsel ist keine
			// Bewegung, der man mit den Augen folgt.
			behavior: distance > el.clientHeight * BIG_JUMP_VIEWPORTS ? 'auto' : 'smooth',
		}
		if (top !== null) {
			options.top = top
		}
		if (left !== null) {
			options.left = left
		}
		// Nur wenn sich wirklich etwas bewegt - sonst kaeme kein `scrollend`,
		// und das naechste echte Traegheitsscrollen gaelte als eigenes.
		if (distance >= 1) {
			ownScrollAt = Date.now()
		}
		el.scrollTo(options)
		// A jump is there at once, before any `scroll` event; a glide
		// reports its way through them (onScroll).
		if (geometry && options.behavior === 'auto') {
			if (top !== null) {
				geometry.scrollTop = top
			}
			if (left !== null) {
				geometry.scrollLeft = left
			}
		}
	}

	/**
	 * Läuft bei jedem Notenwechsel (siehe useScoreSync.js), nicht jeden
	 * rAF-Frame - plus einmal nach jedem Zoomwechsel, dann mit `force`: ein
	 * Zoomwechsel ist eine ausdrückliche Handlung, keine Störung des Lesens
	 * wie ein manueller Scroll.
	 *
	 * @param {{page:number,x:number,y:number,w:number,h:number}|null} rect
	 * @param {boolean} [force] Nachführen auch kurz nach manuellem Scrollen
	 * @param {boolean} [retry] ein Nachmessen aus update() selbst
	 */
	function update(rect, force = false, retry = false) {
		if (retryTimer !== null) {
			clearTimeout(retryTimer)
			retryTimer = null
		}
		if (!retry) {
			retries = 0
		}
		const el = scrollEl()
		lastRect = rect
		if (!rect || !el) {
			return
		}
		if (!force && !enabled()) {
			measureVisibility(rect)
			return
		}
		if (!force && (gestureActive || shouldSuppressAutoScroll(lastManualScrollAt, Date.now(), MANUAL_SCROLL_RESUME_MS))) {
			return
		}
		const pageEl = pageRefs[rect.page]
		const found = locate(el, rect, force)
		if (!found) {
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
				scrollTo(el.scrollTop + (pageClientRect.top - el.getBoundingClientRect().top))
			}
			// Im Stillstand kommt kein naechster Notenwechsel - nach einem
			// Sprung der Leitung oder ins Taktfeld bliebe die Ansicht am
			// Seitenanfang stehen, waagerecht womoeglich ganz woanders. Also
			// selbst nachmessen, bis die Seite ihren Cursor hat; ein neuer
			// Aufruf loest das ab.
			if (retries < RETRY_MAX) {
				retries++
				retryTimer = setTimeout(() => update(rect, force, true), RETRY_MS)
			}
			return
		}
		const { cursor, geo } = found
		const target = planAutoScroll({
			cursorTop: cursor.top,
			cursorHeight: cursor.height,
			scrollTop: geo.scrollTop,
			viewportHeight: geo.clientHeight,
		})
		// Waagerecht nur, wenn die Seite überhaupt breiter als das Bild ist
		// (siehe ScorePage.vue) - sonst wäre jeder Aufruf eine überflüssige
		// DOM-Schreiboperation.
		let targetLeft = null
		if (geo.scrollWidth > geo.clientWidth) {
			targetLeft = planHorizontalScroll({
				cursorLeft: cursor.left,
				cursorWidth: cursor.width,
				scrollLeft: geo.scrollLeft,
				viewportWidth: geo.clientWidth,
			})
		}
		if (target !== null || targetLeft !== null) {
			scrollTo(target, targetLeft)
		}
		cursorOutOfView.value = false
	}

	/**
	 * Same measurement as update(), but without scrolling - per note change
	 * and after a manual scroll, never per frame.
	 *
	 * @param {{page:number}|null} rect
	 */
	function measureVisibility(rect) {
		const el = scrollEl()
		if (!rect || !el || enabled()) {
			cursorOutOfView.value = false
			return
		}
		const found = locate(el, rect, false)
		if (!found) {
			// Page not loaded yet: it is far away from what is on screen.
			cursorOutOfView.value = true
			return
		}
		const { cursor, geo } = found
		cursorOutOfView.value = !(
			spanInView({ start: cursor.top, size: cursor.height, viewStart: geo.scrollTop, viewSize: geo.clientHeight })
			&& spanInView({ start: cursor.left, size: cursor.width, viewStart: geo.scrollLeft, viewSize: geo.clientWidth })
		)
	}

	// --- Manuelles Scrollen erkennen ----------------------------------------
	//
	// An der GESTE, nicht an scroll-Ereignissen. Vorher galt jedes
	// scroll-Ereignis außerhalb eines 700-ms-Fensters nach dem eigenen
	// scrollTo() als Nutzereingriff - eine Vermutung über die Dauer eines
	// weichen Scrollens, die auf dem Telefon aus zwei Gründen gleichzeitig
	// bricht: Die Strecken sind dort länger als 700 ms (eine A4-Seite steht
	// bei „Seitenbreite" mehrere Bildschirmhöhen hoch), und mobile Browser
	// blenden ihre Adress-/Aktionsleiste beim Scrollen ein und aus, was die
	// Viewporthöhe ändert und weitere scroll-Ereignisse erzeugt, die von
	// keinem Finger stammen. Die App deutete daraufhin ihr eigenes Nachführen
	// als Nutzereingriff, setzte 2,5 s aus, lief aus dem Bild, holte weiter
	// nach - und stieß sich damit erneut selbst an.
	//
	// Ob ein Finger auf dem Glas liegt, meldet der Browser aber. Also wird es
	// gefragt statt erschlossen.

	/** Finger aufgesetzt / Maustaste unten (auch auf dem Scrollbalken). */
	function onUserGestureStart() {
		gestureActive = true
		lastManualScrollAt = Date.now()
		lastGestureAt = lastManualScrollAt
	}

	/**
	 * Finger gehoben. Die Nachlauffrist beginnt hier - das Trägheitsscrollen
	 * danach verlängert sie über `scrollend`, wo der Browser das Ereignis
	 * kennt (sonst läuft die Frist ab dem Loslassen, wie zuvor).
	 */
	function onUserGestureEnd() {
		gestureActive = false
		lastManualScrollAt = Date.now()
	}

	/**
	 * Ein Nutzereingriff ohne Anfang und Ende: Mausrad, Trägheitsscrollen
	 * (`scrollend`), Tastatur (Bild auf/ab).
	 */
	function noteManualScroll() {
		lastManualScrollAt = Date.now()
	}

	/**
	 * `scrollend`: am Ende einer Geste (Traegheit) ein Eingriff, am Ende des
	 * eigenen Nachfuehrens nicht (scrollPlan.js#isManualScrollEnd).
	 */
	function onScrollEnd() {
		const manual = isManualScrollEnd({ ownScrollAt, lastGestureAt })
		ownScrollAt = null
		if (manual) {
			noteManualScroll()
			if (!enabled()) {
				measureVisibility(lastRect)
			}
		}
	}

	function reset() {
		if (retryTimer !== null) {
			clearTimeout(retryTimer)
			retryTimer = null
		}
		pageRefs.length = 0
		unwatch()
		lastManualScrollAt = null
		gestureActive = false
		ownScrollAt = null
		lastGestureAt = null
		lastRect = null
		cursorOutOfView.value = false
	}

	/**
	 * Die Seitenkomponenten, je Seitenindex - fuer das Blaettern
	 * (usePaging.js), das dieselben Seiten ausmisst.
	 *
	 * @return {Array<object>}
	 */
	function pages() {
		return pageRefs
	}

	return { setPageRef, pageRef, pages, update, cursorOutOfView, onUserGestureStart, onUserGestureEnd, noteManualScroll, onScrollEnd, reset }
}
