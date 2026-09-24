// Ob die Bedienleiste breit (Transport und Werkzeuge in einer Zeile) oder
// kompakt (Werkzeuge auf Abruf unter dem Transport) steht.
//
// Entschieden wird am UEBERLAUF des Transports, nicht an einer
// Breitenschwelle: Eine feste Schwelle war aus einer Knopfzahl gerechnet und
// veraltete mit jedem neuen Werkzeug - zwischen Schwelle und tatsaechlichem
// Platzbedarf lag dann ein Bereich, in dem sich Suchlauf, Zeit und Taktfeld
// unter die Werkzeuge schoben (Tablet, 700-1200 px). Der Ueberlauf dagegen
// ist die Messung selbst (ScoreBar.vue).
//
// Zurueck auf breit geht es nur mit Abstand zur Breite, bei der er auftrat
// (sonst flattert die Leiste an genau dieser Kante), oder wenn sich ihr
// Inhalt geaendert hat - dann ist die gemerkte Breite nichts mehr wert und
// wird neu gemessen.

/** Abstand zur Ueberlaufbreite, ab dem wieder breit versucht wird (px). */
export const HYSTERESIS_PX = 24

/**
 * @typedef {object} BarFit
 * @property {boolean} compact Werkzeuge auf Abruf unter dem Transport
 * @property {?number} switchWidth Wurzelbreite beim Ueberlauf, oder null
 * @property {string} contentKey der Inhalt, fuer den switchWidth gilt
 */

/** @return {BarFit} breit - gemessen wird erst in dieser Gestalt. */
export function initialBarFit() {
	return { compact: false, switchWidth: null, contentKey: '' }
}

/**
 * Der naechste Zustand nach einer Messung.
 *
 * @param {BarFit} state
 * @param {object} measured
 * @param {number} measured.rootWidth Breite des Viewers
 * @param {boolean} measured.overflowing ob der Transport der BREITEN Leiste
 *   ueberlaeuft (in kompakter Gestalt bedeutungslos)
 * @param {string} measured.contentKey was in der Leiste steht, als Schluessel
 * @return {BarFit}
 */
export function nextBarFit(state, { rootWidth, overflowing, contentKey }) {
	if (contentKey !== state.contentKey) {
		// Anderer Inhalt, andere Breite: breit versuchen. Passt es nicht,
		// meldet der Ueberlauf das noch vor dem Zeichnen.
		return { compact: false, switchWidth: null, contentKey }
	}
	if (!state.compact) {
		return overflowing
			? { compact: true, switchWidth: rootWidth, contentKey }
			: state
	}
	if (state.switchWidth !== null && rootWidth >= state.switchWidth + HYSTERESIS_PX) {
		return { compact: false, switchWidth: null, contentKey }
	}
	return state
}
