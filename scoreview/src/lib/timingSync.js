// Ab Phase 8 nur noch die binäre Suche - der Rest dieser Datei
// (buildStepTimes, das lineare Interpolieren zwischen Cursor-Schritten und
// Timing-Events) ist mit OSMD entfernt worden. Der Sidecar liefert jetzt
// über sposXML/mposXML für jedes elid einen exakten timeMs-Wert (siehe
// PLAN.md M7) - es gibt keine zweite, unabhängig gezählte Schrittfolge
// (den früheren OSMD-Cursor) mehr, gegen die interpoliert werden müsste.
// scoreLayout.js baut auf dieser Funktion auf, um zu einer gegebenen
// Wiedergabezeit das aktuelle Element zu finden.

/**
 * Größter Index i mit times[i] <= timeMs (binäre Suche). 0, wenn timeMs vor
 * dem ersten Event liegt oder times leer ist.
 *
 * @param {number[]} times aufsteigend sortiert
 * @param {number} timeMs
 * @returns {number}
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
