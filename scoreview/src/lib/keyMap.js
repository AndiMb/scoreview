// Alle Tastaturkuerzel des Viewers in EINER Tabelle - statt einer Kette von
// `if (event.code === …)` im Handler. Pedale zum Umblaettern senden je nach
// Modell PageUp/PageDown, Pfeil hoch/runter oder Pfeil links/rechts;
// welche Taste was tut, soll an einer Stelle nachzulesen und zu aendern sein.
//
// Jede Zeile nennt die Bedienung aus lib/interactionPolicy.js, die sie
// ausloest. Der Handler fragt dort, ob sie gerade wirken darf - die Tabelle
// selbst kennt den Aufführungsmodus nur, wo eine Taste dort etwas ANDERES
// bedeutet (Pfeile blaettern, statt Takte zu springen).

/**
 * - `match`: `code` (Lage der Taste, fuer Leertaste/Buchstaben unabhaengig
 *   vom Tastaturlayout) oder `key` (erzeugtes Zeichen, fuer `+`/`-`, die je
 *   Layout woanders liegen)
 * - `ctrl`: only with Ctrl (Cmd on a Mac) held. A row without it matches
 *   only WITHOUT the modifier: Ctrl+L belongs to the browser's address bar,
 *   not to the loop.
 * - `shift`: only with Shift held. Unlike `ctrl`, a row without it matches
 *   either way - `+` needs Shift on many layouts. A Shift row therefore
 *   stands BEFORE the plain row of its key.
 * - `normal` / `performance`: `[Befehl, Bedienung]`; `null` = hier nicht belegt
 * - Befehl `scroll`: Die Taste scrollt nativ weiter (kein preventDefault),
 *   gemeldet wird nur, DASS gescrollt wird - der Browser meldet fuer
 *   Tastatur-Scrollen keine Geste (siehe useAutoScroll.js).
 */
export const KEY_BINDINGS = Object.freeze([
	{ code: 'Space', normal: ['togglePlay', 'play'], performance: null },
	// Note by note (issue #34). Shift, not the plain arrows: page-turning
	// pedals send arrows, and a pedal must keep turning a measure, not a
	// note. Not Alt either - Alt+Left is the browser's Back on Windows and
	// Linux. Unassigned in performance mode, like Space: it would sound.
	{ code: 'ArrowRight', shift: true, normal: ['nextNote', 'seek'], performance: null },
	{ code: 'ArrowLeft', shift: true, normal: ['previousNote', 'seek'], performance: null },
	{ code: 'ArrowRight', normal: ['nextMeasure', 'seek'], performance: ['pageDown', 'page'] },
	{ code: 'ArrowLeft', normal: ['previousMeasure', 'seek'], performance: ['pageUp', 'page'] },
	{ code: 'ArrowDown', normal: ['scroll', null], performance: ['pageDown', 'page'] },
	{ code: 'ArrowUp', normal: ['scroll', null], performance: ['pageUp', 'page'] },
	{ code: 'PageDown', normal: ['pageDown', 'page'], performance: ['pageDown', 'page'] },
	{ code: 'PageUp', normal: ['pageUp', 'page'], performance: ['pageUp', 'page'] },
	{ code: 'Home', normal: ['scroll', null], performance: ['scroll', null] },
	{ code: 'End', normal: ['scroll', null], performance: ['scroll', null] },
	{ code: 'KeyL', normal: ['toggleLoop', 'loop'], performance: null },
	{ key: '+', normal: ['zoomIn', 'zoom'], performance: ['zoomIn', 'zoom'] },
	{ key: '-', normal: ['zoomOut', 'zoom'], performance: ['zoomOut', 'zoom'] },
	{ key: '0', normal: ['zoomWidth', 'zoom'], performance: ['zoomWidth', 'zoom'] },
	// Ctrl+P opens the print page (E16) instead of printing Nextcloud's
	// Files page around the viewer. Swallowed in performance mode: a print
	// dialog over the music stand is not what a stray key should bring.
	{ code: 'KeyP', ctrl: true, normal: ['print', 'settings'], performance: null },
])

/**
 * @param {{code?:string, key?:string, ctrlKey?:boolean, metaKey?:boolean, shiftKey?:boolean}} event ein KeyboardEvent oder etwas mit denselben Feldern
 * @param {{performance?:boolean}} ctx
 * @return {?{command:string, action:?string, preventDefault:boolean}}
 *   null = diese Taste gehoert nicht dem Viewer. Eine im Aufführungsmodus
 *   unbelegte Taste (Leertaste) liefert `blocked`: Sie wird geschluckt, statt
 *   die Seite zu scrollen - ein Tipp auf die Leertaste soll dort gar nichts tun.
 */
export function resolveKey(event, { performance = false } = {}) {
	const withCtrl = event.ctrlKey === true || event.metaKey === true
	const withShift = event.shiftKey === true
	const rows = KEY_BINDINGS.filter((b) => (b.ctrl === true) === withCtrl && (b.shift !== true || withShift))
	const binding = rows.find((b) => (b.code !== undefined ? b.code === event.code : b.key === event.key))
	if (!binding) {
		// Pfeile und Bildtasten ohne `code` (manche Pedale, synthetische
		// Ereignisse) ueber `key` nachschlagen - `key` heisst dort genauso.
		const perKey = rows.find((b) => b.code !== undefined && b.code === event.key && b.code !== 'Space')
		if (!perKey) {
			return null
		}
		return fromBinding(perKey, performance)
	}
	return fromBinding(binding, performance)
}

/**
 * @param {object} binding
 * @param {boolean} performance
 * @return {{command:string, action:?string, preventDefault:boolean}}
 */
function fromBinding(binding, performance) {
	const entry = performance ? binding.performance : binding.normal
	if (entry === null) {
		return { command: 'blocked', action: null, preventDefault: true }
	}
	const [command, action] = entry
	return { command, action, preventDefault: command !== 'scroll' }
}

/** Widgets that move their own focus with the arrows (a menu, a list, tabs). */
const ARROW_OWNERS = '[role="menu"], [role="menubar"], [role="listbox"], [role="tablist"], [role="radiogroup"], [role="tree"], [role="grid"]'

/** Elements that Space and Enter activate. */
const ACTIVATABLE = 'button, a[href], summary, [role="button"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="option"], [role="tab"], [role="radio"]'

/**
 * Whether a key belongs to where it was typed rather than to the viewer.
 * The viewer listens on the whole document (the focus mostly sits on
 * Nextcloud's modal, outside the viewer - issue #34), so it must step aside
 * for whatever the key is meant for there.
 *
 * Space and Enter on a control go to the control only when the control was
 * reached by keyboard (`:focus-visible`). A control that was clicked keeps
 * the focus too, and whoever clicked "Loop" and then taps Space means
 * playback, not a second click on Loop.
 *
 * @param {{target?:?Element, key?:string, code?:string, defaultPrevented?:boolean}} event
 * @return {boolean}
 */
export function keyBelongsToTarget(event) {
	if (event.defaultPrevented) {
		return true
	}
	const target = event.target
	if (!target || typeof target.closest !== 'function') {
		return false
	}
	const tag = target.tagName
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
		return true
	}
	if (String(event.key).startsWith('Arrow') && target.closest(ARROW_OWNERS)) {
		return true
	}
	const activating = event.code === 'Space' || event.key === ' ' || event.key === 'Enter'
	return activating && target.closest(ACTIVATABLE) !== null && focusVisible(target)
}

/**
 * @param {Element} element
 * @return {boolean} true where the browser cannot tell - then the control wins
 */
function focusVisible(element) {
	try {
		return element.matches(':focus-visible')
	} catch {
		return true
	}
}
