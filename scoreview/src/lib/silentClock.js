// Platzhalter-Zeitquelle für den SVG-Viewer/Cursor, solange es keine echte
// Wiedergabe gibt (kein SoundFont konfiguriert) - siehe lib/player.js
// (spessasynth_lib, E1: Synthese im Browser statt vorgerendertem MP3, siehe
// docs/architecture.md). Erfüllt bewusst dieselbe kleine Schnittstelle wie
// der Player (play/pause/seek/getCurrentTimeMs/isPlaying/
// addEventListener('seeked'|'wake')), damit useScoreSync.js und ScoreViewer.vue
// beim Wechsel zwischen beiden nicht angefasst werden müssen - nur die
// Quelle wird getauscht. Treibt Zeit rein über performance.now(), erzeugt
// keinen Ton.

/**
 * @param {number} durationMs
 */
export function createSilentClock(durationMs) {
	let playing = false
	let startedAtWallClock = 0
	let elapsedAtStart = 0
	const seekedListeners = new Set()
	// Same contract as lib/player.js: every movement of the time wakes the
	// viewer's sleeping time loop.
	const wakeListeners = new Set()
	const announceWake = () => wakeListeners.forEach((cb) => cb())

	function getCurrentTimeMs() {
		if (!playing) {
			return elapsedAtStart
		}
		return Math.min(durationMs, elapsedAtStart + (performance.now() - startedAtWallClock))
	}

	function play() {
		if (isPlaying()) {
			return
		}
		// Ran out at the end without anyone pausing: settle there first.
		if (playing) {
			elapsedAtStart = durationMs
			playing = false
		}
		if (elapsedAtStart >= durationMs) {
			elapsedAtStart = 0
		}
		startedAtWallClock = performance.now()
		playing = true
		announceWake()
	}

	function pause() {
		if (!playing) {
			return
		}
		elapsedAtStart = getCurrentTimeMs()
		playing = false
		announceWake()
	}

	function seek(ms) {
		// Ran out at the end: `playing` is still set, and restarting the wall
		// clock below would set the cursor running again without anyone
		// pressing play. Stay paused, as the real player does.
		if (playing && getCurrentTimeMs() >= durationMs) {
			playing = false
		}
		elapsedAtStart = Math.max(0, Math.min(durationMs, ms))
		startedAtWallClock = performance.now()
		seekedListeners.forEach((cb) => cb())
		announceWake()
	}

	// Stops at the end of the piece like the real player does - otherwise the
	// viewer's time loop, which runs while playing, would never fall asleep
	// after a piece played to its end.
	function isPlaying() {
		return playing && getCurrentTimeMs() < durationMs
	}

	function addEventListener(type, cb) {
		if (type === 'seeked') {
			seekedListeners.add(cb)
		} else if (type === 'wake') {
			wakeListeners.add(cb)
		}
	}

	function removeEventListener(type, cb) {
		if (type === 'seeked') {
			seekedListeners.delete(cb)
		} else if (type === 'wake') {
			wakeListeners.delete(cb)
		}
	}

	return { getCurrentTimeMs, play, pause, seek, isPlaying, addEventListener, removeEventListener, durationMs }
}
