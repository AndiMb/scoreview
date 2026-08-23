// Platzhalter-Zeitquelle für Phase 8 (SVG-Viewer/Cursor), solange es noch
// keine echte Wiedergabe gibt - die kommt erst in Phase 9 mit lib/player.js
// (spessasynth_lib, siehe PLAN.md E1: Synthese im Browser statt
// vorgerendertem MP3). Erfüllt bewusst dieselbe kleine Schnittstelle wie
// der spätere Player (play/pause/seek/getCurrentTimeMs/isPlaying/
// addEventListener('seeked')), damit useScoreSync.js und ScoreViewer.vue
// beim Umstieg in Phase 9 nicht angefasst werden müssen - nur die Quelle
// wird getauscht. Treibt Zeit rein über performance.now(), erzeugt keinen
// Ton.

/**
 * @param {number} durationMs
 */
export function createSilentClock(durationMs) {
	let playing = false
	let startedAtWallClock = 0
	let elapsedAtStart = 0
	const seekedListeners = new Set()

	function getCurrentTimeMs() {
		if (!playing) {
			return elapsedAtStart
		}
		return Math.min(durationMs, elapsedAtStart + (performance.now() - startedAtWallClock))
	}

	function play() {
		if (playing) {
			return
		}
		if (elapsedAtStart >= durationMs) {
			elapsedAtStart = 0
		}
		startedAtWallClock = performance.now()
		playing = true
	}

	function pause() {
		if (!playing) {
			return
		}
		elapsedAtStart = getCurrentTimeMs()
		playing = false
	}

	function seek(ms) {
		elapsedAtStart = Math.max(0, Math.min(durationMs, ms))
		startedAtWallClock = performance.now()
		seekedListeners.forEach((cb) => cb())
	}

	function isPlaying() {
		return playing
	}

	function addEventListener(type, cb) {
		if (type === 'seeked') {
			seekedListeners.add(cb)
		}
	}

	function removeEventListener(type, cb) {
		if (type === 'seeked') {
			seekedListeners.delete(cb)
		}
	}

	return { getCurrentTimeMs, play, pause, seek, isPlaying, addEventListener, removeEventListener, durationMs }
}
