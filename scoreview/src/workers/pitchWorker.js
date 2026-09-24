// Die Tonhoehenerkennung im eigenen Thread: YIN plus
// Spektrum kostet je 20-ms-Rahmen einige hunderttausend Rechenschritte. Im
// Hauptthread nahme das der Zeitschleife des Viewers (Cursor, Autoscroll)
// genau die Frames, die sie fuer ein ruckelfreies Bild braucht - und die
// Auswertung einer zehnminuetigen Aufnahme blockierte die Seite sekundenlang.
//
// Zwei Auftraege:
// - `live`: Bloecke aus dem Aufnahme-Worklet, zurueck kommen die Rahmen mit
//   Kontextzeit (useIntonation.js, Live-Nadel).
// - `analyze`: eine ganze gespeicherte Aufnahme, in Stuecken mit
//   Fortschritt (jedes Mal neu berechnet, nichts gespeichert).

import { createPitchStream, FRAME_SIZE, HOP_SIZE, trackPitch } from '../lib/pitchDetect.js'

let stream = createPitchStream()

// Ein Stueck zu je 30 s: Zwischen zwei Stuecken kommt die Fortschrittsmeldung
// heraus, und ein neuer `live`-Auftrag muss nicht auf die ganze Aufnahme
// warten.
const ANALYZE_CHUNK_FRAMES = Math.round((30 * 16000) / HOP_SIZE)

self.onmessage = (event) => {
	const message = event.data
	if (message.type === 'live-reset') {
		stream = createPitchStream()
	} else if (message.type === 'live') {
		const frames = stream.push(message.samples, message.contextTimeSec)
		if (frames.length > 0) {
			self.postMessage({ type: 'live', frames })
		}
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
		self.postMessage({ type: 'analysis', id, frames })
	}
}
