import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { allowed } from '../lib/interactionPolicy.js'

/**
 * Wie lange das Schloss zum Verlassen gehalten werden muss. Lang
 * genug, dass ein Tipp am Notenstaender es nicht ausloest, kurz genug, dass
 * es niemand fuer kaputt haelt - der Fortschrittsring zeigt, dass etwas
 * passiert.
 */
export const EXIT_HOLD_MS = 1000

/**
 * Aufführungsmodus: Nur Blaettern, Zoom und „naechstes Stueck" wirken,
 * alles andere ist gesperrt - ein versehentlicher Tipp darf nichts ausloesen,
 * was man hoert oder was die Stelle verliert.
 *
 * Gesperrt wird nicht hier und nicht in jedem Handler einzeln, sondern in
 * lib/interactionPolicy.js; dieses Composable liefert nur den Zustand dazu
 * (`can(action)`). Wer eine neue Bedienung einbaut, fragt `can()` - vergisst
 * er es, ist sie im Aufführungsmodus trotzdem gesperrt, weil die Policy
 * Unbekanntes sperrt.
 *
 * **Tasten ohne Fokus:** Ein Bluetooth-Pedal sendet an das Dokument, und im
 * Aufführungsmodus tippt niemand erst in den Viewer, um ihm den Fokus zu
 * geben. Solange der Modus an ist, haengt deshalb ein zweiter Listener am
 * `document` - Ereignisse, die ohnehin aus dem Viewer kommen, laesst er
 * durch, die behandelt der Listener am Viewer selbst.
 *
 * @param {object} deps
 * @param {() => HTMLElement|null} deps.rootEl Wurzel des Viewers
 * @param {(event: KeyboardEvent) => void} deps.onKeydown derselbe Handler wie am Viewer
 * @param {() => void} [deps.onEnter] beim Einschalten (Panels schliessen, Ton aus)
 * @param {() => boolean} [deps.following] ob gerade einer Leitung gefolgt wird (spaeter)
 * @return {object}
 */
export function usePerformanceMode({ rootEl, onKeydown, onEnter = () => {}, following = () => false }) {
	const active = ref(false)
	// 0..1 waehrend das Schloss gehalten wird - treibt den Fortschrittsring.
	const exitProgress = ref(0)
	let holdStart = null
	let frame = null

	const context = computed(() => ({ performance: active.value, following: following() }))

	/**
	 * @param {string} action eine Bedienung aus interactionPolicy.ACTIONS
	 * @return {boolean}
	 */
	function can(action) {
		return allowed(action, context.value)
	}

	function enter() {
		if (active.value) {
			return
		}
		active.value = true
		onEnter()
	}

	function exit() {
		cancelHold()
		active.value = false
	}

	function tick() {
		const elapsed = performance.now() - holdStart
		exitProgress.value = Math.min(1, elapsed / EXIT_HOLD_MS)
		if (exitProgress.value >= 1) {
			frame = null
			exit()
			return
		}
		frame = requestAnimationFrame(tick)
	}

	/** Schloss gedrueckt: aus → an sofort, an → aus erst nach dem Halten. */
	function lockDown() {
		if (!active.value) {
			enter()
			return
		}
		if (holdStart !== null) {
			return
		}
		holdStart = performance.now()
		frame = requestAnimationFrame(tick)
	}

	/** Losgelassen oder abgebrochen, bevor die Zeit um ist: nichts passiert. */
	function cancelHold() {
		if (frame !== null) {
			cancelAnimationFrame(frame)
			frame = null
		}
		holdStart = null
		exitProgress.value = 0
	}

	/**
	 * Tastatur am Schloss: Enter/Leertaste gedrueckt halten wie den Finger.
	 * `repeat` wird ignoriert, sonst startete jede Wiederholung neu.
	 *
	 * @param {KeyboardEvent} event
	 */
	function lockKeydown(event) {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return
		}
		// Nicht zum Viewer durchreichen: Dort hiesse die Leertaste „Wiedergabe".
		event.preventDefault()
		event.stopPropagation()
		if (!event.repeat) {
			lockDown()
		}
	}

	function lockKeyup(event) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault()
			cancelHold()
		}
	}

	function onDocumentKeydown(event) {
		const root = rootEl()
		if (root && event.target instanceof Node && root.contains(event.target)) {
			return
		}
		onKeydown(event)
	}

	watch(active, (an) => {
		if (an) {
			document.addEventListener('keydown', onDocumentKeydown)
		} else {
			document.removeEventListener('keydown', onDocumentKeydown)
		}
	})

	onBeforeUnmount(() => {
		cancelHold()
		document.removeEventListener('keydown', onDocumentKeydown)
	})

	function reset() {
		exit()
	}

	return { active, exitProgress, can, enter, exit, lockDown, cancelHold, lockKeydown, lockKeyup, reset }
}
