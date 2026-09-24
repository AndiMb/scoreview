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
 * - `normal` / `performance`: `[Befehl, Bedienung]`; `null` = hier nicht belegt
 * - Befehl `scroll`: Die Taste scrollt nativ weiter (kein preventDefault),
 *   gemeldet wird nur, DASS gescrollt wird - der Browser meldet fuer
 *   Tastatur-Scrollen keine Geste (siehe useAutoScroll.js).
 */
export const KEY_BINDINGS = Object.freeze([
	{ code: 'Space', normal: ['togglePlay', 'play'], performance: null },
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
])

/**
 * @param {{code?:string, key?:string}} event ein KeyboardEvent oder etwas mit denselben Feldern
 * @param {{performance?:boolean}} ctx
 * @return {?{command:string, action:?string, preventDefault:boolean}}
 *   null = diese Taste gehoert nicht dem Viewer. Eine im Aufführungsmodus
 *   unbelegte Taste (Leertaste) liefert `blocked`: Sie wird geschluckt, statt
 *   die Seite zu scrollen - ein Tipp auf die Leertaste soll dort gar nichts tun.
 */
export function resolveKey(event, { performance = false } = {}) {
	const binding = KEY_BINDINGS.find((b) => (b.code !== undefined ? b.code === event.code : b.key === event.key))
	if (!binding) {
		// Pfeile und Bildtasten ohne `code` (manche Pedale, synthetische
		// Ereignisse) ueber `key` nachschlagen - `key` heisst dort genauso.
		const perKey = KEY_BINDINGS.find((b) => b.code !== undefined && b.code === event.key && b.code !== 'Space')
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
