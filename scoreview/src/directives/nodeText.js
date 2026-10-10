/**
 * `v-node-text="text"`: setzt den Text eines Elements, indem es den Wert des
 * vorhandenen Textknotens aendert, statt ihn zu ersetzen.
 *
 * Wozu: Fuer ein Element mit nur einem Text als Inhalt schreibt Vue beim
 * Aktualisieren `textContent` - das wirft den Textknoten weg und legt einen
 * neuen an, eine Aenderung der Kindknoten. In Files loest genau die ueber
 * Nextclouds `:has()`-Regeln eine Stil-Neuberechnung ueber den ganzen Baum
 * aus (gemessen ~70 ms je Aenderung am Desktop); den Wert eines Textknotens
 * zu aendern kostet dort nichts. Fuer Text, der sich waehrend der Wiedergabe
 * laufend aendert (die Zeitanzeige).
 */

/**
 * @param {HTMLElement} el
 * @param {string} value der anzuzeigende Text
 */
function apply(el, value) {
	const text = String(value ?? '')
	const node = el.firstChild
	if (node && node.nodeType === 3 && node === el.lastChild) {
		if (node.nodeValue !== text) {
			node.nodeValue = text
		}
		return
	}
	el.textContent = text
}

export default {
	mounted(el, { value }) {
		apply(el, value)
	},
	updated(el, { value }) {
		apply(el, value)
	},
}
