// Stummes Mitblaettern bei „Folgt mir" (E10): Die Leitung meldet den Stand
// ihrer Wiedergabe, die Folgenden rechnen daraus ihre Anzeigezeit hoch. Rein,
// ohne Netz und ohne Uhr - die Zeiten kommen als Argumente.
//
// Gesendet wird kein Strom von Zeiten, sondern ein Stand: „spielt ab t mit
// Tempo r, Serverzeit at". Zwischen zwei Staenden rechnet jedes Geraet selbst
// weiter. Neu gemeldet wird nur, was sich so nicht vorhersagen laesst: Start,
// Halt, Tempo, ein Sprung (Suchlauf, Loop) - und gelegentlich zum
// Nachstellen, weil die Audiouhr der Leitung und die Wanduhr nicht exakt
// gleich laufen.

/** Ab dieser Abweichung von der Vorhersage gilt es als Sprung (ms). */
export const JUMP_MS = 400

/** So oft wird waehrend der Wiedergabe ohnehin nachgestellt (ms). */
export const RESYNC_MS = 15000

/**
 * Die Zeit der Leitung jetzt.
 *
 * @param {{playing: boolean, timeMs: number, rate: number, at: number}} playback
 *   Stand vom Server, `at` in Serverzeit
 * @param {number} serverNowMs die Serverzeit jetzt (geschaetzt)
 * @return {number}
 */
export function leaderTimeMs(playback, serverNowMs) {
	if (!playback.playing) {
		return playback.timeMs
	}
	return playback.timeMs + Math.max(0, serverNowMs - playback.at) * playback.rate
}

/**
 * Muss die Leitung ihren Stand neu melden?
 *
 * @param {?{playing: boolean, timeMs: number, rate: number, sentAt: number}} last
 *   der zuletzt gemeldete Stand, `sentAt` in eigener Zeit
 * @param {{playing: boolean, timeMs: number, rate: number}} now der Stand jetzt
 * @param {number} nowMs eigene Zeit jetzt
 * @return {boolean}
 */
export function shouldSendPlayback(last, now, nowMs) {
	if (last === null) {
		// Wer nie gespielt hat, hat nichts zu melden - ein Halt ohne
		// vorherigen Start bewegte niemanden.
		return now.playing
	}
	if (now.playing !== last.playing) {
		return true
	}
	if (!now.playing) {
		// Im Stillstand bewegt die Leitung niemanden stumm: Eine Stelle
		// zeigt sie ausdruecklich („Meine Stelle senden"), und beim
		// naechsten Start geht die neue Zeit ohnehin mit.
		return false
	}
	if (Math.abs(now.rate - last.rate) > 0.001) {
		return true
	}
	const expected = last.timeMs + (nowMs - last.sentAt) * last.rate
	if (Math.abs(now.timeMs - expected) > JUMP_MS) {
		return true
	}
	return nowMs - last.sentAt >= RESYNC_MS
}

/**
 * Einen gemeldeten Stand beim Absenden auf jetzt nachziehen: Er kann in der
 * Warteschlange gewartet haben, und der Server stempelt die Ankunft.
 *
 * @param {{playing: boolean, timeMs: number, rate: number, capturedAt: number}} playback
 * @param {number} nowMs eigene Zeit jetzt
 * @return {{playing: boolean, timeMs: number, rate: number}}
 */
export function freshPlayback(playback, nowMs) {
	const timeMs = playback.playing
		? playback.timeMs + Math.max(0, nowMs - playback.capturedAt) * playback.rate
		: playback.timeMs
	return { playing: playback.playing, timeMs: Math.round(timeMs), rate: playback.rate }
}
