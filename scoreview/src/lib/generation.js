/**
 * Ein Generationszaehler fuer asynchrone Arbeit, deren Ergebnis veralten kann.
 *
 * Wer etwas anstoesst, holt sich mit `next()` eine Marke; wer den Zustand
 * wegwirft (Stueckwechsel, Schliessen des Viewers), ruft `invalidate()`.
 * Nach jedem `await` fragt der Anstossende `isCurrent(marke)` - ist die Marke
 * ueberholt, verwirft er sein Ergebnis, statt es auf einen Zustand zu
 * schreiben, zu dem es nicht mehr gehoert. Ein Abbrechen der laufenden Arbeit
 * selbst ist damit nicht verbunden: `fetch`, `getUserMedia` oder ein Worker
 * lassen sich nicht zuverlaessig abbrechen, ihr Ergebnis aber schon verwerfen.
 *
 * @return {{next: () => number, invalidate: () => void, isCurrent: (token: number) => boolean}}
 */
export function createGeneration() {
	let current = 0
	return {
		next() {
			current++
			return current
		},
		invalidate() {
			current++
		},
		isCurrent(token) {
			return token === current
		},
	}
}
