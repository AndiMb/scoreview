import { computed, ref, shallowRef } from 'vue'
import { createGeneration } from '../lib/generation.js'
import {
	classify,
	evaluateRecording,
	frameCents,
	noteMarks,
	problemList,
	targetAt,
} from '../lib/intonation.js'
import { captureToScoreMs, recordingToScoreMs } from '../lib/recordingAlign.js'
import { decodeWav } from '../lib/wavCodec.js'

/**
 * Wie viele Rahmen die Live-Nadel mittelt: 5 × 20 ms. Kuerzer zittert sie
 * mit jedem Vibrato-Ausschlag, laenger kommt sie beim Tonwechsel zu spaet.
 */
const LIVE_SMOOTHING_FRAMES = 5

/**
 * Intonationsrueckmeldung: live am Cursor und danach aus einer
 * gespeicherten Aufnahme.
 *
 * **Live**: Die Bloecke kommen aus der gemeinsamen Mikrofonstrecke
 * und gehen in den Worker (workers/pitchWorker.js). Die Sollnote ist die der
 * Partiturstelle, an der das Gesungene gehoert wurde - ueber dieselbe
 * Rechnung wie bei der Aufnahme (lib/recordingAlign.js), also Kontextzeit
 * minus Eingangs- und Ausgabelatenz. Steht die Wiedergabe, gilt die
 * Anzeigezeit: Man singt die Note, auf der der Cursor steht.
 *
 * **Danach**: aus der gespeicherten WAV neu berechnet, nichts
 * wird zusaetzlich gespeichert - Verbesserungen am Verfahren wirken auch auf
 * alte Aufnahmen.
 *
 * **Notenkoepfe** faerben sich nur, wo das SVG `st-` traegt (M10, lokaler
 * Weg) und sich Zeilen den Stimmen zuordnen lassen. Sonst bleibt es ohne
 * Fehlermeldung bei Nadel und Liste - wie bei der Hervorhebung.
 *
 * @param {object} deps
 * @param deps.microphone
 * @param deps.clock
 * @param deps.isPlaying
 * @param deps.displayTimeMs
 * @param deps.latencyMs
 * @param deps.tempoFactor
 * @param deps.notes
 * @param deps.myChannels
 * @param deps.events
 * @param deps.myStaff
 * @param deps.measureOf
 * @param deps.loadAudio
 * @return {object}
 */
export function useIntonation({
	microphone,
	clock,
	isPlaying,
	displayTimeMs,
	latencyMs,
	tempoFactor,
	notes,
	myChannels,
	events,
	myStaff,
	measureOf,
	loadAudio,
}) {
	const live = ref(false)
	/** {cents: ?number, cls: string} oder null */
	const needle = shallowRef(null)
	const liveMarks = shallowRef([])
	const analysis = shallowRef(null)
	const analyzing = ref(false)
	const progress = ref(0)
	const error = ref('')
	/** Ohne gewaehlte Stimme gibt es keine Sollnote - die Oberflaeche fragt. */
	const needPart = ref(false)

	let worker = null
	let unsubscribe = null
	let liveContext = null
	let liveInputLatency = 0
	let recent = []
	let recentPitch = null
	let requestId = 0
	const waiting = new Map()
	// Zwei getrennte Zaehler: Eine laufende Auswertung und ein wartendes
	// Einschalten der Live-Nadel veralten unabhaengig voneinander - das
	// Abschalten der Nadel darf keine Auswertung verwerfen.
	const analysisGeneration = createGeneration()
	const liveGeneration = createGeneration()
	// Waehrend der Rueckfrage des Browsers ist `live` noch false. Ohne diese
	// Marke saehe stopLive() nichts zu tun, und das Mikrofon, das danach
	// freigegeben wird, bliebe offen.
	let startingLive = false
	// Nach destroy() darf kein Worker mehr entstehen: Niemand wuerde ihn je
	// beenden.
	let destroyed = false

	const marks = computed(() => [...(analysis.value?.marks ?? []), ...liveMarks.value])

	function ensureWorker() {
		if (worker || destroyed) {
			return worker
		}
		// Webpack erkennt dieses Muster und baut den Worker als eigenen Teil;
		// geladen wird er unter der Laufzeit-Adresse der App (publicPath.js),
		// mit dem Inhalts-Hash als ?v= (chunkFilename der Nextcloud-Vorgabe) -
		// ein Update liefert also nie einen alten Worker aus dem Cache.
		worker = new Worker(new URL('../workers/pitchWorker.js', import.meta.url))
		worker.onmessage = (event) => {
			const message = event.data
			if (message.type === 'live') {
				onLiveFrames(message.frames)
			} else if (message.type === 'progress') {
				// Nur die juengste Anfrage zeigt Fortschritt - eine verworfene
				// rechnet im Worker noch zu Ende.
				if (message.id === requestId) {
					progress.value = message.done
				}
			} else if (message.type === 'analysis') {
				waiting.get(message.id)?.(message.frames)
				waiting.delete(message.id)
			}
		}
		return worker
	}

	async function startLive() {
		if (live.value || startingLive || destroyed) {
			return
		}
		error.value = ''
		if (!myChannels()) {
			needPart.value = true
			return
		}
		needPart.value = false
		const mine = liveGeneration.next()
		startingLive = true
		let handle
		try {
			handle = await microphone.acquire('intonation', { onStop: () => stopLive() })
		} finally {
			if (liveGeneration.isCurrent(mine)) {
				startingLive = false
			}
		}
		if (!liveGeneration.isCurrent(mine)) {
			// Waehrend der Rueckfrage abgeschaltet (Viewer zu, Stueckwechsel,
			// zweiter Klick): Die Strecke ist inzwischen trotzdem fuer uns
			// angemeldet und muss wieder abgegeben werden.
			if (handle) {
				microphone.release('intonation')
			}
			return
		}
		if (!handle) {
			return
		}
		const w = ensureWorker()
		if (!w) {
			microphone.release('intonation')
			return
		}
		liveContext = handle.context
		liveInputLatency = handle.inputLatencyMs
		recent = []
		recentPitch = null
		w.postMessage({ type: 'live-reset' })
		unsubscribe = handle.onBlocks(({ samples, contextTimeSec }) => {
			// Eine Kopie: Den Block behaelt womoeglich gleichzeitig die Aufnahme.
			const copy = samples.slice()
			w.postMessage({ type: 'live', samples: copy, contextTimeSec }, [copy.buffer])
		})
		live.value = true
	}

	function stopLive() {
		// Auch ohne laufende Nadel: Ein wartendes Einschalten wird damit
		// verworfen und gibt das Mikrofon nach der Rueckfrage selbst ab.
		liveGeneration.invalidate()
		startingLive = false
		if (!live.value) {
			return
		}
		unsubscribe?.()
		unsubscribe = null
		live.value = false
		needle.value = null
		liveMarks.value = []
		liveContext = null
		microphone.release('intonation')
	}

	function toggleLive() {
		if (live.value || startingLive) {
			stopLive()
		} else {
			startLive()
		}
	}

	function onLiveFrames(frames) {
		if (!live.value || !liveContext || frames.length === 0) {
			return
		}
		const frame = frames[frames.length - 1]
		const scoreMs = isPlaying()
			? captureToScoreMs({
					captureContextTimeSec: frame.contextTimeSec,
					anchor: { contextTimeSec: liveContext.currentTime, scoreMs: clock()?.getCurrentTimeMs() ?? 0 },
					tempoFactor: tempoFactor(),
					outputLatencyMs: latencyMs(),
					inputLatencyMs: liveInputLatency,
				})
			: displayTimeMs()
		const target = targetAt(notes(), myChannels(), scoreMs, frame.hz)
		if (!target) {
			needle.value = { cents: null, cls: 'rest' }
			liveMarks.value = []
			recent = []
			return
		}
		if (recentPitch !== target.pitch || (recent.length > 0 && recent[recent.length - 1].onMs !== target.onMs)) {
			recent = []
		}
		recentPitch = target.pitch
		recent.push({ onMs: target.onMs, cents: frameCents(frame, target.pitch) })
		recent = recent.slice(-LIVE_SMOOTHING_FRAMES)
		const werte = recent.map((r) => r.cents).filter((c) => c !== null)
		// Mehrheit stimmlos: ehrlich „nicht auswertbar".
		const cents = werte.length * 2 > recent.length ? median(werte) : null
		const cls = classify(cents)
		needle.value = { cents, cls }
		liveMarks.value = noteMarks([{ note: target, class: cls }], notes(), myChannels(), events(), myStaff())
	}

	/**
	 * Eine Aufnahme auswerten.
	 *
	 * @param {{id: (number|string), scoreStartMs:number, tempoFactor:number}} recording
	 */
	async function analyze(recording) {
		error.value = ''
		if (!myChannels()) {
			needPart.value = true
			return
		}
		needPart.value = false
		const mine = analysisGeneration.next()
		analyzing.value = true
		progress.value = 0
		try {
			const bytes = await loadAudio(recording)
			if (!analysisGeneration.isCurrent(mine)) {
				return
			}
			const w = ensureWorker()
			if (!w) {
				return
			}
			const { samples, sampleRate } = decodeWav(bytes)
			const id = ++requestId
			const frames = await new Promise((resolve) => {
				waiting.set(id, resolve)
				w.postMessage({ type: 'analyze', id, samples, sampleRate }, [samples.buffer])
			})
			// Inzwischen ein anderes Stueck (Setliste) oder eine andere
			// Aufnahme: Das Ergebnis gehoert zu Noten, die nicht mehr da sind,
			// und wuerde auf die neuen gefaerbt.
			if (!analysisGeneration.isCurrent(mine) || frames === null) {
				return
			}
			const imPartitur = frames.map((f) => ({ scoreMs: recordingToScoreMs(recording, f.timeSec), hz: f.hz, clarity: f.clarity }))
			const evaluations = evaluateRecording(imPartitur, notes(), myChannels(), { tempoFactor: recording.tempoFactor || 1 })
			analysis.value = {
				recordingId: recording.id,
				evaluations,
				problems: problemList(evaluations, measureOf),
				notEvaluable: evaluations.filter((e) => e.class === 'na').length,
				marks: noteMarks(evaluations, notes(), myChannels(), events(), myStaff()),
			}
		} catch (err) {
			if (!analysisGeneration.isCurrent(mine)) {
				return
			}
			// eslint-disable-next-line no-console
			console.error('ScoreView: Auswertung der Aufnahme gescheitert.', err)
			error.value = err?.message ?? String(err)
		} finally {
			if (analysisGeneration.isCurrent(mine)) {
				analyzing.value = false
			}
		}
	}

	/** Laufende Auswertungen verwerfen - wartende Versprechen enden mit null. */
	function abandonAnalysis() {
		analysisGeneration.invalidate()
		for (const resolve of waiting.values()) {
			resolve(null)
		}
		waiting.clear()
		analyzing.value = false
		progress.value = 0
	}

	function clearAnalysis() {
		analysis.value = null
	}

	function reset() {
		stopLive()
		abandonAnalysis()
		clearAnalysis()
		needPart.value = false
		error.value = ''
	}

	function destroy() {
		destroyed = true
		reset()
		worker?.terminate()
		worker = null
	}

	return {
		live,
		needle,
		marks,
		analysis,
		analyzing,
		progress,
		error,
		needPart,
		startLive,
		stopLive,
		toggleLive,
		analyze,
		clearAnalysis,
		reset,
		destroy,
	}
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
