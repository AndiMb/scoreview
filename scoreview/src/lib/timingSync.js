// Reine, DOM-/OSMD-freie Timing-Logik, portiert aus dem Phase-1-Spike
// (spike/main.js) - dort im Browser gegen zwei echte Partituren (einstimmig
// und 5-stimmiger Chorsatz) verifiziert. Siehe dort für den Kontext, warum
// die Interpolation (nicht Nearest-Neighbour) nötig ist.

/**
 * Wenn die Anzahl der OSMD-Cursor-Schritte exakt der Anzahl der
 * Timing-Events (aus timing.json, vom Sidecar geparstes .spos) entspricht,
 * korrespondieren beide Folgen 1:1 in chronologischer Reihenfolge. Sonst
 * wird für jeden Cursor-Schritt linear zwischen den beiden umgebenden
 * Timing-Events interpoliert (nicht per Nearest-Neighbour-Snapping - das
 * würde mehreren Cursor-Schritten denselben Zeitstempel zuweisen und den
 * Cursor beim Erreichen dieses Zeitpunkts mehrere Schritte weit springen
 * lassen, siehe spike/main.js).
 *
 * @param {number} cursorStepCount
 * @param {Array<{elid: number, timeMs: number}>} timingEvents sortiert nach timeMs
 * @returns {{times: number[], exact: boolean}}
 */
export function buildStepTimes(cursorStepCount, timingEvents) {
	const n = timingEvents.length
	const m = cursorStepCount
	if (n === 0 || m === 0) {
		return { times: [], exact: false }
	}
	if (n === m) {
		return { times: timingEvents.map((e) => e.timeMs), exact: true }
	}
	const times = new Array(m)
	for (let i = 0; i < m; i++) {
		const pos = (i * (n - 1)) / Math.max(1, m - 1)
		const idxLow = Math.floor(pos)
		const idxHigh = Math.min(n - 1, idxLow + 1)
		const frac = pos - idxLow
		const tLow = timingEvents[idxLow].timeMs
		const tHigh = timingEvents[idxHigh].timeMs
		times[i] = tLow + (tHigh - tLow) * frac
	}
	return { times, exact: false }
}

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
