// Die Tonhoehenerkennung im eigenen Thread: YIN plus
// Spektrum kostet je 20-ms-Rahmen einige hunderttausend Rechenschritte. Im
// Hauptthread nahme das der Zeitschleife des Viewers (Cursor, Autoscroll)
// genau die Frames, die sie fuer ein ruckelfreies Bild braucht - und die
// Auswertung einer zehnminuetigen Aufnahme blockierte die Seite sekundenlang.
//
// Zwei Auftraege:
// - `live`: Bloecke aus dem Aufnahme-Worklet - over the port of
//   `live-port` straight from the audio thread, or (fallback) relayed by
//   the main thread as `live` messages. Zurueck kommen die Rahmen mit
//   Kontextzeit (useIntonation.js, Live-Nadel), and the level envelope for
//   live scoring (lib/singScore.js), which traces onsets after silence.
// - `analyze`: eine ganze gespeicherte Aufnahme, in Stuecken mit
//   Fortschritt (jedes Mal neu berechnet, nichts gespeichert). With the
//   frames comes the level envelope for the start of a syllable
//   (lib/rhythm.js) - computed here because it also runs over every sample.

import { createPitchStream, FRAME_SIZE, HOP_SIZE, trackPitch } from '../lib/pitchDetect.js'
import { createLevelStream, levelEnvelope } from '../lib/rhythm.js'

let stream = createPitchStream()
let levelStream = createLevelStream()
// The port the worklet sends blocks through (useIntonation.js), or null.
let livePort = null

// Ein Stueck zu je 30 s: Zwischen zwei Stuecken kommt die Fortschrittsmeldung
// heraus, und ein neuer `live`-Auftrag muss nicht auf die ganze Aufnahme
// warten.
const ANALYZE_CHUNK_FRAMES = Math.round((30 * 16000) / HOP_SIZE)

/**
 * One block of live input, wherever it came from.
 *
 * @param {{samples: Float32Array, contextTimeSec: number}} block
 */
function onLiveBlock({ samples, contextTimeSec }) {
	const frames = stream.push(samples, contextTimeSec)
	const level = levelStream.push(samples, contextTimeSec)
	if (frames.length > 0 || level.length > 0) {
		self.postMessage({ type: 'live', frames, level })
	}
}

function closeLivePort() {
	if (livePort) {
		livePort.onmessage = null
		livePort.close()
		livePort = null
	}
}

self.onmessage = (event) => {
	const message = event.data
	if (message.type === 'live-reset') {
		stream = createPitchStream()
		levelStream = createLevelStream()
	} else if (message.type === 'live-port') {
		closeLivePort()
		livePort = message.port
		livePort.onmessage = (e) => onLiveBlock(e.data)
	} else if (message.type === 'live-port-close') {
		closeLivePort()
	} else if (message.type === 'live') {
		onLiveBlock(message)
	} else if (message.type === 'analyze') {
		const { id, samples, sampleRate } = message
		const frames = []
		const hopsTotal = Math.max(1, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1)
		for (let first = 0; first < hopsTotal; first += ANALYZE_CHUNK_FRAMES) {
			const start = first * HOP_SIZE
			const end = Math.min(samples.length, (first + ANALYZE_CHUNK_FRAMES - 1) * HOP_SIZE + FRAME_SIZE)
			for (const f of trackPitch(samples.subarray(start, end), sampleRate)) {
				frames.push({ timeSec: f.timeSec + start / sampleRate, hz: f.hz, clarity: f.clarity })
			}
			self.postMessage({ type: 'progress', id, done: Math.min(1, (first + ANALYZE_CHUNK_FRAMES) / hopsTotal) })
		}
		const level = levelEnvelope(samples, sampleRate)
		self.postMessage({ type: 'analysis', id, frames, level }, [level.db.buffer])
	}
}
