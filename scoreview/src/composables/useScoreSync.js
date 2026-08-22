import { buildStepTimes, findStepIndex } from '../lib/timingSync.js'

// Läuft den OSMD-Cursor einmal von Anfang bis Ende durch, nur um die Anzahl
// der Stopp-Positionen zu zählen - wird gegen die Timing-Event-Anzahl
// verglichen, um zu entscheiden, ob eine ordinale 1:1-Zuordnung gilt (siehe
// lib/timingSync.js).
function countCursorSteps(osmd) {
	const cursor = osmd.cursor
	cursor.reset()
	let steps = 0
	const MAX_STEPS = 20000 // Schutz gegen eine unerwartete Endlosschleife
	while (!cursor.iterator.EndReached && steps < MAX_STEPS) {
		steps++
		cursor.next()
	}
	cursor.reset()
	return steps
}

/**
 * Treibt osmd.cursor synchron zur Wiedergabe von audioEl, portiert aus dem
 * Phase-1-Spike (spike/main.js) - inklusive der dort gefundenen und
 * behobenen Bugs (Off-by-one bei currentIndex, Nearest-Neighbour-Snapping
 * bei einer gröberen Timing-Quelle als der Cursor-Schrittzahl).
 *
 * @param {import('opensheetmusicdisplay').OpenSheetMusicDisplay} osmd bereits geladen & gerendert
 * @param {HTMLAudioElement} audioEl
 * @param {Array<{elid: number, timeMs: number}>} timingEvents aus timing.json (Sidecar-geparste .spos)
 * @returns {{ exact: boolean, cursorStepCount: number, eventCount: number, stop: () => void }}
 */
export function useScoreSync(osmd, audioEl, timingEvents) {
	const cursorStepCount = countCursorSteps(osmd)
	const { times: stepTimesMs, exact } = buildStepTimes(cursorStepCount, timingEvents)

	// null = "Cursor-Position unbekannt / braucht vollen reset()+iterate"; mit
	// einer Zahl (z.B. -1) würde 0 === -1 + 1 den allerersten Tick fälschlich
	// als Ein-Schritt-Vorwärtsbewegung lesen und den Cursor sofort über die
	// erste Note hinaus springen lassen (Bug aus dem Spike, siehe main.js).
	let currentIndex = null
	let rafHandle = null

	function moveCursorTo(index) {
		if (stepTimesMs.length === 0 || index === currentIndex) {
			return
		}
		const cursor = osmd.cursor
		if (currentIndex !== null && index === currentIndex + 1) {
			cursor.next()
		} else {
			cursor.reset()
			for (let i = 0; i < index; i++) cursor.next()
		}
		currentIndex = index
	}

	function tick() {
		if (stepTimesMs.length > 0 && !audioEl.paused && !audioEl.ended) {
			moveCursorTo(findStepIndex(stepTimesMs, audioEl.currentTime * 1000))
		}
		rafHandle = requestAnimationFrame(tick)
	}

	function onSeeked() {
		if (stepTimesMs.length === 0) {
			return
		}
		currentIndex = null // erzwingt den reset()+iterate-Pfad auch bei einem kleinen Sprung
		moveCursorTo(findStepIndex(stepTimesMs, audioEl.currentTime * 1000))
	}

	osmd.cursor.show()
	osmd.cursor.reset()
	currentIndex = 0 // reset() hat den Cursor bereits visuell auf Schritt 0 gesetzt
	audioEl.addEventListener('seeked', onSeeked)
	rafHandle = requestAnimationFrame(tick)

	function stop() {
		cancelAnimationFrame(rafHandle)
		audioEl.removeEventListener('seeked', onSeeked)
	}

	return { exact, cursorStepCount, eventCount: timingEvents.length, stop }
}
