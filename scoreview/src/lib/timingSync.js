// Nur die binäre Suche - kein lineares Interpolieren zwischen
// Cursor-Schritten und Timing-Events: der Sidecar liefert über sposXML/
// mposXML für jedes elid einen exakten timeMs-Wert (siehe
// docs/architecture.md M7), es gibt also keine zweite, unabhängig gezählte
// Schrittfolge, gegen die interpoliert werden müsste (kein Renderer-interner
// Cursor-Zustand wie bei einem Neusatz, siehe E2). scoreLayout.js baut auf
// dieser Funktion auf, um zu einer gegebenen Wiedergabezeit das aktuelle
// Element zu finden.

/**
 * Größter Index i mit times[i] <= timeMs (binäre Suche). 0, wenn timeMs vor
 * dem ersten Event liegt oder times leer ist.
 *
 * @param {number[]} times aufsteigend sortiert
 * @param {number} timeMs
 * @return {number}
 */
export function findStepIndex(times, timeMs) {
	let lo = 0
	let hi = times.length - 1
	let ans = 0
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		if (times[mid] <= timeMs) {
			ans = mid
			lo = mid + 1
		} else {
			hi = mid - 1
		}
	}
	return ans
}
