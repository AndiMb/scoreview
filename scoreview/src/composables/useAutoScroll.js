import { planAutoScroll, planHorizontalScroll, shouldSuppressAutoScroll } from '../lib/scrollPlan.js'

// Pausendauer für das Nachführen nach manuellem Scrollen (siehe
// scrollPlan.js) - lang genug, um in Ruhe zu lesen, kurz genug, um nicht wie
// ein Hänger zu wirken. Sie läuft ab dem ENDE der Geste.
const MANUAL_SCROLL_RESUME_MS = 2500

// Ab dieser Strecke (in Vielfachen der Viewporthöhe) wird gesprungen statt
// weich gescrollt. Ein weiches Scrollen über mehrere Bildschirmhöhen ist auf
// einem Telefon weder schön noch billig - und es war die Strecke, an der die
// frühere Zeitfenster-Heuristik zerbrach.
const BIG_JUMP_VIEWPORTS = 1.5

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
	// Zeitstempel (Date.now()) des Endes der letzten Nutzergeste.
	let lastManualScrollAt = null
	// Ob gerade ein Finger auf dem Glas liegt bzw. die Maustaste unten ist.
	let gestureActive = false

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
		if (!force && (gestureActive || shouldSuppressAutoScroll(lastManualScrollAt, Date.now(), MANUAL_SCROLL_RESUME_MS))) {
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

	function reset() {
		pageRefs.length = 0
		lastManualScrollAt = null
		gestureActive = false
	}

	return { setPageRef, update, onUserGestureStart, onUserGestureEnd, noteManualScroll, reset }
}
