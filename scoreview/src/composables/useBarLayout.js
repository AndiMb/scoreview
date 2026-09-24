import { ref, watch } from 'vue'
import { initialBarFit, nextBarFit } from '../lib/barFit.js'

// Wie lange die Leiste im Vollbild stehen bleibt, bevor sie sich waehrend der
// Wiedergabe zur Fortschrittslinie zusammenzieht.
const BAR_IDLE_MS = 3000

/**
 * Die Gestalt der Bedienleiste: kompakt oder breit, Werkzeuge auf Abruf,
 * im Vollbild waehrend der Wiedergabe eingefahren.
 *
 * `compact` haengt am gemessenen UEBERLAUF der breiten Leiste
 * (lib/barFit.js), nicht an einer Media Query und nicht an einer
 * Breitenschwelle: Der Viewer sitzt mal in Nextclouds Viewer, mal im eigenen
 * Modal, mal im Vollbild, und was in der Leiste steht, haengt an Rechten und
 * Modus. Den Ueberlauf meldet ScoreBar.vue (`reportOverflow`), die Breite des
 * Viewers misst `observe`.
 *
 * @param {object} deps
 * @param {() => ?Element} deps.rootEl das Wurzelelement des Viewers
 * @param {() => boolean} deps.isFullscreen
 * @param {() => boolean} deps.isPlaying
 * @param {() => string} deps.contentKey was in der Leiste steht - aendert es
 *   sich, wird die breite Gestalt neu versucht
 */
export function useBarLayout({ rootEl, isFullscreen, isPlaying, contentKey }) {
	const compact = ref(false)
	const toolsOpen = ref(false)
	const collapsed = ref(false)
	let idleHandle = null
	let observer = null
	let fit = { ...initialBarFit(), contentKey: contentKey() }
	let rootWidth = 0
	let overflowing = false

	function applyFit() {
		fit = nextBarFit(fit, { rootWidth, overflowing, contentKey: contentKey() })
		compact.value = fit.compact
	}

	/**
	 * Von ScoreBar.vue: ob der Transport der breiten Leiste gerade ueberlaeuft.
	 *
	 * @param {boolean} isOverflowing
	 */
	function reportOverflow(isOverflowing) {
		overflowing = isOverflowing
		applyFit()
	}

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
			rootWidth = entry.contentRect.width
			applyFit()
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

	// Neuer Inhalt (Auffuehrungsmodus, Leitungsrolle, ...): Die gemerkte
	// Breite gilt nicht mehr. Der Versuch in breiter Gestalt rendert, und
	// ScoreBar misst gleich danach (updated) und noch vor dem Zeichnen - ein
	// Flackern gibt es deshalb nicht.
	watch(contentKey, () => {
		overflowing = false
		applyFit()
	})

	return { compact, toolsOpen, collapsed, show, scheduleCollapse, observe, stop, reportOverflow }
}
