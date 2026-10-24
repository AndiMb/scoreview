import { computed, nextTick, ref, shallowRef } from 'vue'
import {
	computeActualSizeZoom,
	computeFitPageZoom,
	computeFitWidthZoom,
	computePinchZoom,
	MAX_ZOOM,
	MIN_ZOOM,
} from '../lib/scoreLayout.js'
import { fitSpreadPageZoom, fitSpreadWidthZoom } from '../lib/spreadLayout.js'

// Zoomschritt fuer Tastatur (+/-) und Strg+Mausrad - multiplikativ, damit sich
// die gefuehlte Schrittweite ueber den ganzen Bereich (0,25-4) gleich anfuehlt.
const ZOOM_STEP = 1.2

/**
 * Alles, was die Größe des Notenbilds bestimmt: Zoomfaktor, Presets, die
 * Kopplung an die Fensterbreite, Vollbild und die Pinch-Geste.
 *
 * Drittes Composable aus der Zerlegung von `ScoreViewer.vue`. Die fünf
 * Bereiche gehören zusammen, weil sie sich gegenseitig bedingen: Vollbild
 * erzwingt „ganze Seite", das schaltet die Breitenkopplung ab, und die
 * muss beim Verlassen wiederhergestellt werden. Verteilt auf drei
 * Composables wäre genau diese Verschränkung unsichtbar geworden.
 *
 * Die reine Rechnung bleibt in `scoreLayout.js` (dort ohne DOM testbar);
 * hier steht ausschließlich die DOM-Messung und der Zustand.
 *
 * @param {object} deps
 * @param {() => HTMLElement|null} deps.rootEl Wurzelelement des Viewers
 *   (für Vollbild und den ResizeObserver)
 * @param {() => HTMLElement|null} deps.scrollEl das scrollende Element
 * @param {() => boolean} [deps.spread] whether two pages stand side by side
 *   (A2) - the presets then fit the pair, not one page
 * @param {(widthPx: number) => void} [deps.onWidth] the measured width of
 *   the page area, before the width preset is applied - the spread rule
 *   (spreadLayout.js) depends on it, and the preset on the rule
 */
export function useZoom({ rootEl, scrollEl, spread = () => false, onWidth = () => {} }) {
	const zoom = ref(1)
	// Solange niemand selbst gezoomt hat, folgt der Zoom der Fenstergröße
	// („Seitenbreite"). Ab dem ersten eigenen Zoom gilt der gewählte Faktor
	// absolut, sonst würde die App die Entscheidung der Nutzerin bei jedem
	// Drehen des Tablets wieder verwerfen.
	const followsWidth = ref(true)
	// Das zuletzt gewaehlte Preset ('width' | 'page' | 'actual'), null nach
	// einem eigenen Zoom. Beim Stueckwechsel einer Setliste gilt es fuer das
	// naechste Stueck weiter - ein fester Faktor passte dort nicht,
	// wenn das naechste Stueck ein anderes Seitenformat hat.
	const chosen = ref('width')
	// Ein Preset, das auf die Masse der ersten Seite wartet (siehe restore()).
	let pendingPreset = null
	const isFullscreen = ref(false)
	// Fullscreen inside the page, where the browser offers none (issue #20):
	// the viewer covers its window, and the bar retracts as in fullscreen.
	const pageFullscreen = ref(false)

	/**
	 * Ob diese Umgebung Vollbild ueberhaupt anbietet.
	 *
	 * Gemessen in der WebView der Nextcloud-Android-App (Galaxy S23,
	 * NC-App ueber Direct Editing): `document.fullscreenEnabled === false` -
	 * die App setzt in ihrem WebChromeClient kein `onShowCustomView`, und
	 * ohne das gibt es dort kein Vollbild. Derselbe Fall tritt in einem
	 * iframe mit entsprechender Permissions-Policy auf.
	 *
	 * Abgefragt wird die Faehigkeit des Browsers, NICHT der Weg, auf dem die
	 * Seite ausgeliefert wurde: Der Viewer ist auf allen drei Einstiegen
	 * derselbe und soll nicht danach verzweigen. Einmal beim Aufbau
	 * ermittelt - der Wert aendert sich zur Laufzeit nicht.
	 */
	const fullscreenPossible = typeof document !== 'undefined' && document.fullscreenEnabled === true
	// Geometrie der jeweils zuletzt geladenen Seite je Index (Zoom-Presets) -
	// {viewBox, sizeMm}, gefüllt über ScorePage.vue "loaded".
	const pageDimensions = shallowRef({})

	const percent = computed(() => Math.round(zoom.value * 100))

	// Ob der Zoom vor dem Vollbild der Fensterbreite folgte - Vollbild
	// erzwingt „ganze Seite" und schaltet die Kopplung dabei ab.
	let followedWidthBeforeFullscreen = false
	let viewportObserver = null
	let isPinching = false
	// One zoom change per frame during a pinch: touchmove fires faster than
	// the screen refreshes on many devices, and every change re-lays out all
	// pages.
	let pinchFrame = null
	let pinchZoom = null
	let pinchStartDistance = 0
	let pinchStartZoom = 1

	/**
	 * Einziger Weg, `zoom` zu setzen, außer der Fensterbreiten-Automatik
	 * (`applyPreset('width')`/`observeViewport()`): jeder selbst gewählte Zoom
	 * schaltet `followsWidth` ab, sonst würde die Automatik ihn beim nächsten
	 * Resize wieder überschreiben.
	 *
	 * @param {number} value
	 */
	function set(value) {
		zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
		followsWidth.value = false
		chosen.value = null
	}

	function by(factor) {
		set(zoom.value * factor)
	}

	function onInput(event) {
		set(Number(event.target.value))
	}

	/**
	 * Strg+Mausrad zoomt die Partitur, nicht die Nextcloud-Oberfläche
	 * (dasselbe Motiv wie beim Pinch-Zoom). Ohne Strg bleibt das Rad
	 * gewöhnliches Scrollen.
	 *
	 * @param {WheelEvent} event
	 */
	function onWheel(event) {
		if (!event.ctrlKey) {
			return
		}
		event.preventDefault()
		by(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
	}

	/**
	 * Seitengeometrie für die Presets - ScorePage.vue kennt nur die eigene
	 * Seite, hier wird sie gesammelt.
	 *
	 * @param {{index: number, viewBox: object, sizeMm: object}} page
	 */
	function onPageLoaded({ index, viewBox, sizeMm }) {
		// Neues Objekt statt Mutation: pageDimensions ist ein shallowRef,
		// eine Mutation im Inneren würde nichts auslösen.
		pageDimensions.value = { ...pageDimensions.value, [index]: { viewBox, sizeMm } }
		if (pendingPreset !== null) {
			const wanted = pendingPreset
			pendingPreset = null
			applyPreset(wanted)
		}
	}

	/** @param {'width'|'page'|'actual'} preset */
	function applyPreset(preset) {
		const scroll = scrollEl()
		const pagesEl = scroll?.querySelector('.scoreview-pages')
		if (!pagesEl) {
			return
		}
		// Seite 0 ist praktisch immer zuerst geladen (sichtbare Seiten
		// zuerst) - als Fallback irgendeine geladene Seite, falls die
		// Partitur mit Seite 0 aus dem Bild gescrollt sein sollte.
		const dims = pageDimensions.value[0] ?? Object.values(pageDimensions.value)[0]
		if (preset === 'width') {
			// Als einziger Zoomweg OHNE followsWidth = false: „an die Breite
			// anpassen" ist genau die Ansage, dass es das auch nach dem
			// nächsten Drehen/Vergrößern noch tun soll.
			const fit = spread() ? fitSpreadWidthZoom(pagesEl.clientWidth) : computeFitWidthZoom(pagesEl.clientWidth)
			zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit))
			followsWidth.value = true
			chosen.value = 'width'
			return
		}
		if (preset === 'page') {
			if (!dims?.viewBox) {
				return
			}
			// Die Leiste liegt außerhalb des Scroll-Elements - dessen
			// clientHeight IST die verfügbare Höhe, es ist nichts mehr
			// abzuziehen.
			set(spread()
				? fitSpreadPageZoom(dims.viewBox, pagesEl.clientWidth, scroll.clientHeight)
				: computeFitPageZoom(dims.viewBox, pagesEl.clientWidth, scroll.clientHeight))
		} else if (preset === 'actual') {
			set(computeActualSizeZoom(dims?.sizeMm ?? null))
		}
		// Nach set(), das jeden Zoom als eigenen wertet.
		chosen.value = preset
	}

	/**
	 * Width of the page area. Measured on `.scoreview-pages` when it is
	 * there; in the band and lyrics views it is not, and the scroll
	 * element's content box has the same width (the pages are a block in it).
	 *
	 * @return {number}
	 */
	function pagesWidth() {
		const scroll = scrollEl()
		const pagesEl = scroll?.querySelector('.scoreview-pages')
		if (pagesEl) {
			return pagesEl.clientWidth
		}
		if (!scroll) {
			return 0
		}
		const style = getComputedStyle(scroll)
		return scroll.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
	}

	/**
	 * Hält den Zoom an der Fensterbreite, solange niemand selbst gezoomt hat.
	 * Beobachtet wird `.scoreview-body`, nicht das Scroll-Element: dessen
	 * Innenbreite hängt am Scrollbalken, und ein Zoom, der den Scrollbalken
	 * erscheinen/verschwinden lässt, würde sich über den Beobachter selbst
	 * wieder anstoßen.
	 */
	function observeViewport() {
		viewportObserver?.disconnect()
		const bodyEl = rootEl()?.querySelector('.scoreview-body')
		if (!bodyEl || typeof ResizeObserver === 'undefined') {
			return
		}
		viewportObserver = new ResizeObserver(() => {
			onWidth(pagesWidth())
			if (followsWidth.value) {
				applyPreset('width')
			}
		})
		viewportObserver.observe(bodyEl)
	}

	/**
	 * Vollbild des ganzen Viewers (nicht nur einer Seite), damit die
	 * Transportleiste bedienbar bleibt; „ganze Seite"-Zoom übernimmt das
	 * Ausfüllen der Höhe.
	 */
	async function toggleFullscreen() {
		if (!fullscreenPossible) {
			await setPageFullscreen(!pageFullscreen.value)
			return
		}
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen()
			} else {
				await rootEl()?.requestFullscreen()
			}
		} catch (err) {
			// z.B. Fullscreen per Permissions-Policy im umgebenden iframe
			// gesperrt - Notenansicht bleibt trotzdem nutzbar, nur ohne Vollbild.
			// eslint-disable-next-line no-console
			console.error('ScoreView: could not toggle fullscreen.', err)
		}
	}

	function onFullscreenChange() {
		fullscreenChanged(document.fullscreenElement === rootEl())
	}

	/**
	 * Fullscreen inside the page - for the Nextcloud Android app, whose
	 * WebView reports no Fullscreen API (`onShowCustomView` missing, see
	 * docs/limits.md), the iPhone and iframes without the permission. It
	 * cannot hide the system bars; it gives the score the whole page instead -
	 * over Nextcloud's own header in Files - and lets the bar retract like
	 * real fullscreen (barCollapse.js).
	 *
	 * The back button leaves it, as it leaves real fullscreen on Android:
	 * a history entry on the way in, `popstate` on the way out.
	 *
	 * @param {boolean} on
	 */
	async function setPageFullscreen(on) {
		if (on === pageFullscreen.value) {
			return
		}
		pageFullscreen.value = on
		if (on) {
			history.pushState({ ...history.state, scoreviewFullscreen: true }, '')
			window.addEventListener('popstate', onPopState)
			window.addEventListener('keydown', onEscape)
		} else {
			window.removeEventListener('popstate', onPopState)
			window.removeEventListener('keydown', onEscape)
			if (history.state?.scoreviewFullscreen) {
				// Left by the button: take the own entry back, so that the next
				// back press goes where it went before.
				history.back()
			}
		}
		// The page covers its window only after the next render - measure then.
		await nextTick()
		fullscreenChanged(on)
	}

	function onPopState() {
		setPageFullscreen(false)
	}

	/**
	 * @param {KeyboardEvent} event
	 */
	function onEscape(event) {
		if (event.key === 'Escape') {
			setPageFullscreen(false)
		}
	}

	/** On unmount: no listener and no history entry left behind. */
	function disposeFullscreen() {
		if (pageFullscreen.value) {
			setPageFullscreen(false)
		}
	}

	/**
	 * Both kinds of fullscreen take the same way in and out: "whole page" on
	 * entering, back to the width on leaving.
	 *
	 * @param {boolean} on
	 */
	function fullscreenChanged(on) {
		const wasFollowingWidth = followsWidth.value
		isFullscreen.value = on
		if (isFullscreen.value) {
			followedWidthBeforeFullscreen = wasFollowingWidth
			applyPreset('page')
		} else if (followedWidthBeforeFullscreen) {
			// Beim Verlassen nicht mit dem Vollbild-Zoom im kleinen Fenster
			// zurückbleiben - dort passte „ganze Seite" zu einer Fläche, die es
			// nicht mehr gibt.
			applyPreset('width')
		}
	}

	// --- Pinch ---------------------------------------------------------------
	// Reagiert nur auf echte Zweifinger-Gesten; ein einzelner Finger scrollt
	// normal weiter. The browser's own pinch zoom is switched off by
	// `touch-action` on the pages (ScoreViewer.vue), so the listeners are
	// passive and call no preventDefault().

	function touchDistance(touches) {
		const dx = touches[0].clientX - touches[1].clientX
		const dy = touches[0].clientY - touches[1].clientY
		return Math.sqrt((dx * dx) + (dy * dy))
	}

	function onTouchStart(event) {
		if (event.touches.length === 2) {
			isPinching = true
			pinchStartDistance = touchDistance(event.touches)
			pinchStartZoom = zoom.value
		}
	}

	function onTouchMove(event) {
		if (isPinching && event.touches.length === 2) {
			pinchZoom = computePinchZoom(pinchStartDistance, touchDistance(event.touches), pinchStartZoom)
			if (pinchFrame === null) {
				pinchFrame = requestAnimationFrame(() => {
					pinchFrame = null
					set(pinchZoom)
				})
			}
		}
	}

	function cancelPinchFrame() {
		if (pinchFrame !== null) {
			cancelAnimationFrame(pinchFrame)
			pinchFrame = null
		}
	}

	function onTouchEnd(event) {
		if (event.touches.length < 2) {
			isPinching = false
		}
	}

	function stop() {
		viewportObserver?.disconnect()
		viewportObserver = null
		cancelPinchFrame()
	}

	/**
	 * Fuer eine neue Partitur im selben Viewer: Seitenmasse vergessen, den
	 * Zoom aber NICHT - ihn waehlt die Nutzerin, nicht die Partitur.
	 * Welcher Faktor dann gilt, entscheidet restore().
	 */
	function reset() {
		stop()
		pageDimensions.value = {}
		pendingPreset = null
		isPinching = false
	}

	/**
	 * Das gewaehlte Preset auf die gerade geladene Partitur anwenden. „Ganze
	 * Seite" und „Originalgroesse" brauchen die Masse der ersten Seite; die
	 * kommen erst mit deren SVG (onPageLoaded), bis dahin wartet das Preset.
	 * Nach einem eigenen Zoom bleibt der Faktor, wie er ist.
	 */
	function restore() {
		if (chosen.value === 'width') {
			applyPreset('width')
		} else if (chosen.value !== null) {
			if (Object.keys(pageDimensions.value).length > 0) {
				applyPreset(chosen.value)
			} else {
				pendingPreset = chosen.value
			}
		}
	}

	return {
		zoom,
		followsWidth,
		isFullscreen,
		pageFullscreen,
		fullscreenPossible,
		percent,
		min: MIN_ZOOM,
		max: MAX_ZOOM,
		step: ZOOM_STEP,
		set,
		by,
		onInput,
		onWheel,
		onPageLoaded,
		applyPreset,
		restore,
		preset: chosen,
		observeViewport,
		toggleFullscreen,
		onFullscreenChange,
		disposeFullscreen,
		onTouchStart,
		onTouchMove,
		onTouchEnd,
		stop,
		reset,
	}
}
