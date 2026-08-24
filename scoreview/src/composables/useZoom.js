import { computed, ref, shallowRef } from 'vue'
import {
	computeActualSizeZoom,
	computeFitPageZoom,
	computeFitWidthZoom,
	computePinchZoom,
	MAX_ZOOM,
	MIN_ZOOM,
} from '../lib/scoreLayout.js'

// Zoomschritt fuer Tastatur (+/-) und Strg+Mausrad - multiplikativ, damit sich
// die gefuehlte Schrittweite ueber den ganzen Bereich (0,25-4) gleich anfuehlt.
const ZOOM_STEP = 1.2

/**
 * Alles, was die Größe des Notenbilds bestimmt: Zoomfaktor, Presets, die
 * Kopplung an die Fensterbreite, Vollbild und die Pinch-Geste.
 *
 * Drittes Composable aus der Zerlegung von `ScoreViewer.vue`
 * (Codereview-Befund B1, Phase 23/Schritt 6). Die fünf Bereiche gehören
 * zusammen, weil sie sich gegenseitig bedingen: Vollbild erzwingt „ganze
 * Seite", das schaltet die Breitenkopplung ab, und die muss beim Verlassen
 * wiederhergestellt werden. Verteilt auf drei Composables wäre genau diese
 * Verschränkung unsichtbar geworden.
 *
 * Die reine Rechnung bleibt in `scoreLayout.js` (dort ohne DOM testbar);
 * hier steht ausschließlich die DOM-Messung und der Zustand.
 *
 * @param {object} deps
 * @param {() => HTMLElement|null} deps.rootEl Wurzelelement des Viewers
 *   (für Vollbild und den ResizeObserver)
 * @param {() => HTMLElement|null} deps.scrollEl das scrollende Element
 */
export function useZoom({ rootEl, scrollEl }) {
	const zoom = ref(1)
	// Solange niemand selbst gezoomt hat, folgt der Zoom der Fenstergröße
	// („Seitenbreite") - das ist das Verhalten, das die Seite bis Phase 21
	// zwangsläufig hatte (`width: 100%`). Ab dem ersten eigenen Zoom gilt der
	// gewählte Faktor absolut, sonst würde die App die Entscheidung der
	// Nutzerin bei jedem Drehen des Tablets wieder verwerfen.
	const followsWidth = ref(true)
	const isFullscreen = ref(false)
	// Geometrie der jeweils zuletzt geladenen Seite je Index (Zoom-Presets) -
	// {viewBox, sizeMm}, gefüllt über ScorePage.vue "loaded".
	const pageDimensions = shallowRef({})

	const percent = computed(() => Math.round(zoom.value * 100))

	// Ob der Zoom vor dem Vollbild der Fensterbreite folgte - Vollbild
	// erzwingt „ganze Seite" und schaltet die Kopplung dabei ab.
	let followedWidthBeforeFullscreen = false
	let viewportObserver = null
	let isPinching = false
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
	}

	function by(factor) {
		set(zoom.value * factor)
	}

	function onInput(event) {
		set(Number(event.target.value))
	}

	/**
	 * Strg+Mausrad zoomt die Partitur, nicht die Nextcloud-Oberfläche
	 * (dasselbe Motiv wie beim Pinch-Zoom aus Phase 19). Ohne Strg bleibt das
	 * Rad gewöhnliches Scrollen.
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
	}

	/** @param {'width'|'page'|'actual'} preset */
	function applyPreset(preset) {
		const scroll = scrollEl()
		const pagesEl = scroll?.querySelector('.scoreview-pages')
		if (!pagesEl) {
			return
		}
		// Seite 0 ist praktisch immer zuerst geladen (Phase 8: sichtbare
		// Seiten zuerst) - als Fallback irgendeine geladene Seite, falls die
		// Partitur mit Seite 0 aus dem Bild gescrollt sein sollte.
		const dims = pageDimensions.value[0] ?? Object.values(pageDimensions.value)[0]
		if (preset === 'width') {
			// Als einziger Zoomweg OHNE followsWidth = false: „an die Breite
			// anpassen" ist genau die Ansage, dass es das auch nach dem
			// nächsten Drehen/Vergrößern noch tun soll.
			zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, computeFitWidthZoom(pagesEl.clientWidth)))
			followsWidth.value = true
			return
		}
		if (preset === 'page') {
			if (!dims?.viewBox) {
				return
			}
			// Die Leiste liegt seit Phase 22 außerhalb des Scroll-Elements -
			// dessen clientHeight IST die verfügbare Höhe, es ist nichts mehr
			// abzuziehen (vorher: Höhe der beiden sticky Leisten).
			set(computeFitPageZoom(dims.viewBox, pagesEl.clientWidth, scroll.clientHeight))
		} else if (preset === 'actual') {
			set(computeActualSizeZoom(dims?.sizeMm ?? null))
		}
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
			console.error('ScoreView: Vollbild konnte nicht umgeschaltet werden.', err)
		}
	}

	function onFullscreenChange() {
		const wasFollowingWidth = followsWidth.value
		isFullscreen.value = document.fullscreenElement === rootEl()
		if (isFullscreen.value) {
			followedWidthBeforeFullscreen = wasFollowingWidth
			applyPreset('page')
		} else if (followedWidthBeforeFullscreen) {
			// Beim Verlassen nicht mit dem Vollbild-Zoom im kleinen Fenster
			// zurückbleiben (Phase 22) - dort passte „ganze Seite" zu einer
			// Fläche, die es nicht mehr gibt.
			applyPreset('width')
		}
	}

	// --- Pinch (Phase 19) ---------------------------------------------------
	// Reagiert nur auf echte Zweifinger-Gesten; ein einzelner Finger scrollt
	// normal weiter (kein preventDefault dafür).

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
			// Unterdrueckt den nativen Browser-Seiten-Zoom waehrend der Geste
			// (der wuerde sonst die GESAMTE Nextcloud-Oberflaeche vergroessern,
			// nicht nur die Partitur).
			event.preventDefault()
			set(computePinchZoom(pinchStartDistance, touchDistance(event.touches), pinchStartZoom))
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
	}

	function reset() {
		stop()
		zoom.value = 1
		followsWidth.value = true
		pageDimensions.value = {}
		isPinching = false
	}

	return {
		zoom,
		followsWidth,
		isFullscreen,
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
		observeViewport,
		toggleFullscreen,
		onFullscreenChange,
		onTouchStart,
		onTouchMove,
		onTouchEnd,
		stop,
		reset,
	}
}
