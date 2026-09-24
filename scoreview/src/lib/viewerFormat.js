/**
 * Zahlen der Wiedergabe als Anzeige - ohne DOM und ohne Uebersetzung, damit
 * sie ohne Browser pruefbar sind.
 */

/**
 * Eine Wiedergabeposition als „m:ss". Abgerundet, nicht gerundet: Die
 * Anzeige soll nicht eine Sekunde weiter sein, als die Musik ist.
 *
 * @param {number} ms
 * @return {string}
 */
export function formatTime(ms) {
	const totalSeconds = Math.floor(ms / 1000)
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Eine Millisekundenangabe der Betriebsdiagnose - `null` heisst
 * "der Browser sagt dazu nichts" und ist etwas anderes als 0.
 *
 * @param {?number} ms
 * @return {string}
 */
export function formatMs(ms) {
	return ms === null || !Number.isFinite(ms) ? '–' : `${Math.round(ms)} ms`
}

/**
 * Wie weit die Wiedergabe ist, in Prozent - fuer die eingefahrene Leiste,
 * die nur noch die Position zeigt. Ohne bekannte Dauer 0 statt NaN, und nie
 * ueber 100: Die Anzeigezeit kann das Ende um die Ausgabelatenz ueberholen.
 *
 * @param {number} ms
 * @param {number} durationMs
 * @return {number}
 */
export function progressPercent(ms, durationMs) {
	if (!(durationMs > 0)) {
		return 0
	}
	return Math.min(100, (ms / durationMs) * 100)
}
