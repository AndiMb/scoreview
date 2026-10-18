import { ref, watch } from 'vue'
import { isTight, shouldCollapse } from '../lib/barCollapse.js'
import { initialBarFit, nextBarFit } from '../lib/barFit.js'

// Wie lange die Leiste stehen bleibt, bevor sie sich zur Fortschrittslinie
// zusammenzieht.
const BAR_IDLE_MS = 3000

/**
 * Die Gestalt der Bedienleiste: kompakt oder breit, Werkzeuge auf Abruf,
 * eingefahren im Vollbild oder auf knappem Platz, solange sie niemand
 * braucht (wann genau: lib/barCollapse.js).
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
 * @param {() => boolean} deps.isPerformance Auffuehrungsmodus
 * @param {() => boolean} deps.isFollowing dieses Geraet folgt einer Leitung
 * @param {() => boolean} deps.isBusy ob gerade in der Leiste bedient wird,
 *   was keinen Pointer-Event an ihr ausloest (ein offener Aufklapper)
 * @param {() => string} deps.contentKey was in der Leiste steht - aendert es
 *   sich, wird die breite Gestalt neu versucht
 */
export function useBarLayout({ rootEl, isFullscreen, isPlaying, isPerformance, isFollowing, isBusy, contentKey }) {
	const compact = ref(false)
	const toolsOpen = ref(false)
	const collapsed = ref(false)
	// The bar takes a noticeable share of the viewer's height (issue #15).
	const tight = ref(false)
	let idleHandle = null
	let observer = null
	let fit = { ...initialBarFit(), contentKey: contentKey() }
	let rootWidth = 0
	let rootHeight = 0
	// Measured while the bar stands, kept while it is retracted (isTight).
	let barHeight = 0
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

	function applyTight() {
		tight.value = isTight(barHeight, rootHeight, tight.value)
	}

	/**
	 * Von ScoreBar.vue: die Hoehe der stehenden Leiste.
	 *
	 * @param {number} height
	 */
	function reportHeight(height) {
		barHeight = height
		applyTight()
	}

	function wanted() {
		return shouldCollapse({
			fullscreen: isFullscreen(),
			tight: tight.value,
			playing: isPlaying(),
			performance: isPerformance(),
			following: isFollowing(),
		})
	}

	function clearIdle() {
		if (idleHandle) {
			clearTimeout(idleHandle)
			idleHandle = null
		}
	}

	/**
	 * Die Leiste nach einer Ruhefrist einfahren - aber nur, wo es Grund
	 * dafuer gibt und sie niemand braucht (lib/barCollapse.js). Ausserhalb
	 * davon wird bedient, und eine Leiste, die dabei verschwindet, waere eine
	 * Zumutung.
	 */
	function scheduleCollapse() {
		clearIdle()
		if (!wanted()) {
			return
		}
		idleHandle = setTimeout(() => {
			idleHandle = null
			// An open popover is teleported out of the bar, so tapping in it
			// never reaches the bar's `activity`. Retracting would unmount it
			// under the user's finger - try again after another idle period.
			if (isBusy()) {
				scheduleCollapse()
				return
			}
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
			rootHeight = entry.contentRect.height
			applyFit()
			applyTight()
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

	// Als Watcher statt an den Knoepfen verdrahtet, damit JEDER Weg, der die
	// Wiedergabe startet (Tastaturkuerzel, Einzaehler-Ende, Loop-Neustart),
	// den Modus wechselt oder ins Vollbild geht, automatisch erfasst ist.
	// Faellt der Anlass weg (angehalten, Modus aus), wird bedient - dann
	// gehoert die Leiste hin.
	watch(wanted, (yes) => (yes ? scheduleCollapse() : show()))

	// Neuer Inhalt (Auffuehrungsmodus, Leitungsrolle, ...): Die gemerkte
	// Breite gilt nicht mehr. Der Versuch in breiter Gestalt rendert, und
	// ScoreBar misst gleich danach (updated) und noch vor dem Zeichnen - ein
	// Flackern gibt es deshalb nicht.
	watch(contentKey, () => {
		overflowing = false
		applyFit()
	})

	return { compact, toolsOpen, collapsed, tight, show, scheduleCollapse, observe, stop, reportOverflow, reportHeight }
}
