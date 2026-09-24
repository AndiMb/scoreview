import { ref, watch } from 'vue'

// Ab dieser Breite (px) passen Transport UND Werkzeuge nebeneinander.
// Gerechnet, nicht geraten: 9 Icon-Knoepfe zu 44px (Touch-Zielgroesse, siehe
// das Override von --default-clickable-area im CSS des Viewers) plus
// Wiedergabe, Tempoanzeige, Taktfeld, Suchlauf und Zwischenraeume ergeben rund
// 780px. Darunter braeche die Reihe um - auf einem Telefon (360-412px) auf
// drei Zeilen, rund 18% der Bildschirmhoehe.
const COMPACT_BAR_WIDTH_PX = 700

// Wie lange die Leiste im Vollbild stehen bleibt, bevor sie sich waehrend der
// Wiedergabe zur Fortschrittslinie zusammenzieht.
const BAR_IDLE_MS = 3000

/**
 * Die Gestalt der Bedienleiste: kompakt oder breit, Werkzeuge auf Abruf,
 * im Vollbild waehrend der Wiedergabe eingefahren.
 *
 * `compact` haengt an der GEMESSENEN Breite, nicht an einer Media Query: Der
 * Viewer sitzt mal in Nextclouds Viewer, mal im eigenen Modal, mal im
 * Vollbild - massgeblich ist die Breite, die er tatsaechlich hat, nicht die
 * des Fensters. Und die Umschaltung ist strukturell (Popovers in einem
 * eigenen Streifen statt daneben), das kann CSS allein nicht leisten.
 *
 * @param {object} deps
 * @param {() => ?Element} deps.rootEl das Wurzelelement des Viewers
 * @param {() => boolean} deps.isFullscreen
 * @param {() => boolean} deps.isPlaying
 */
export function useBarLayout({ rootEl, isFullscreen, isPlaying }) {
	const compact = ref(false)
	const toolsOpen = ref(false)
	const collapsed = ref(false)
	let idleHandle = null
	let observer = null

	function clearIdle() {
		if (idleHandle) {
			clearTimeout(idleHandle)
			idleHandle = null
		}
	}

	/**
	 * Die Leiste nach einer Ruhefrist einfahren - aber nur im Vollbild und
	 * nur waehrend der Wiedergabe. Ausserhalb davon wird bedient, und eine
	 * Leiste, die dabei verschwindet, waere eine Zumutung.
	 */
	function scheduleCollapse() {
		clearIdle()
		if (!isFullscreen() || !isPlaying()) {
			return
		}
		idleHandle = setTimeout(() => {
			idleHandle = null
			collapsed.value = true
			toolsOpen.value = false
		}, BAR_IDLE_MS)
	}

	/** Die Leiste ausfahren und die Ruhefrist neu starten. */
	function show() {
		collapsed.value = false
		scheduleCollapse()
	}

	/**
	 * Die Breite beobachten. Beobachtet wird das Wurzelelement, nicht die
	 * Leiste selbst: Deren Breite haengt an ihrem Inhalt, das waere ein
	 * Kreisverkehr.
	 */
	function observe() {
		stopObserver()
		const el = rootEl()
		if (typeof ResizeObserver === 'undefined' || !el) {
			return
		}
		observer = new ResizeObserver(([entry]) => {
			compact.value = entry.contentRect.width < COMPACT_BAR_WIDTH_PX
		})
		observer.observe(el)
	}

	function stopObserver() {
		observer?.disconnect()
		observer = null
	}

	/** Beim Aushaengen: Beobachter und Ruhefrist abbauen. */
	function stop() {
		stopObserver()
		clearIdle()
	}

	// Einfahren waehrend der Wiedergabe - als Watcher statt am Play-Knopf
	// verdrahtet, damit JEDER Weg, der die Wiedergabe startet
	// (Tastaturkuerzel, Einzaehler-Ende, Loop-Neustart), automatisch erfasst
	// ist. Angehalten wird bedient - dann gehoert die Leiste hin.
	watch(isPlaying, (playing) => (playing ? scheduleCollapse() : show()))

	// Die eingefahrene Leiste gibt es nur im Vollbild: Nur dort ist der
	// Platz das eigentliche Thema, und nur dort gibt es keine
	// Nextcloud-Umgebung drumherum, in der ein leerer Streifen irritierte.
	watch(isFullscreen, (fullscreen) => (fullscreen ? scheduleCollapse() : show()))

	return { compact, toolsOpen, collapsed, show, scheduleCollapse, observe, stop }
}
