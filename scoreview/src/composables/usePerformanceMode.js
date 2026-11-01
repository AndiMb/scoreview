import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue'
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
 * @param {() => boolean} [deps.offline] ob der Viewer auf der Offline-Seite laeuft (E14)
 * @return {object}
 */
export function usePerformanceMode({ rootEl, onKeydown, onEnter = () => {}, following = () => false, offline = () => false }) {
	const active = ref(false)
	// Whether the lock is being held. The ring fills by a CSS animation of
	// EXIT_HOLD_MS (ScoreLockButton.vue), not by a value written per frame:
	// read in the viewer's template, such a value re-rendered the whole
	// viewer every frame for the second of holding.
	const holding = ref(false)
	let timer = null

	const context = computed(() => ({ performance: active.value, following: following(), offline: offline() }))

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

	/** Schloss gedrueckt: aus → an sofort, an → aus erst nach dem Halten. */
	function lockDown() {
		if (!active.value) {
			enter()
			return
		}
		if (timer !== null) {
			return
		}
		holding.value = true
		timer = setTimeout(() => {
			timer = null
			exit()
		}, EXIT_HOLD_MS)
	}

	/** Losgelassen oder abgebrochen, bevor die Zeit um ist: nichts passiert. */
	function cancelHold() {
		clearTimeout(timer)
		timer = null
		holding.value = false
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

	if (getCurrentScope()) {
		onScopeDispose(() => {
			cancelHold()
			document.removeEventListener('keydown', onDocumentKeydown)
		})
	}

	function reset() {
		exit()
	}

	return { active, holding, can, enter, exit, lockDown, cancelHold, lockKeydown, lockKeyup, reset }
}
