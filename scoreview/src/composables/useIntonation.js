import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'
import { translate } from '../l10n.js'
import { createGeneration } from '../lib/generation.js'
import {
	classify,
	evaluateRecording,
	frameCents,
	needleChanged,
	noteMarks,
	noteMarksIn,
	ownNotes,
	problemList,
	targetIn,
	worstClass,
} from '../lib/intonation.js'
import { captureToScoreMs, recordingToScoreMs } from '../lib/recordingAlign.js'
import { framesAt440 } from '../lib/referencePitch.js'
import { evaluateRhythm, medianOnsetMs } from '../lib/rhythm.js'
import { decodeWav } from '../lib/wavCodec.js'

/**
 * Wie viele Rahmen die Live-Nadel mittelt: 5 × 20 ms. Kuerzer zittert sie
 * mit jedem Vibrato-Ausschlag, laenger kommt sie beim Tonwechsel zu spaet.
 */
const LIVE_SMOOTHING_FRAMES = 5

/**
 * The needle is redrawn at most this often (~12 Hz). Frames arrive every
 * 20 ms and each redraw re-renders the viewer; the eye does not follow a
 * needle faster than this, and the smoothing still sees every frame.
 */
const NEEDLE_MIN_INTERVAL_MS = 80

const t = (text, vars) => translate('scoreview', text, vars)

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
 * @param {() => number} [deps.referenceHz] a' for live frames; a recording brings its own
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
	referenceHz = () => 440,
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
	let needleShownAt = -Infinity
	let liveMarksKey = null
	let requestId = 0
	const waiting = new Map()
	// Wait mode (useWaitMode.js) listens to the same live frames instead of
	// running a second analysis on the same microphone.
	const frameListeners = new Set()
	// Live scoring (useSingScore.js) needs every frame in score time, not
	// only the newest one the needle shows.
	const scoreFrameListeners = new Set()
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

	// Getrennt statt zusammengefuehrt: Die Live-Markierung wechselt mit jedem
	// Rahmen, die der Auswertung nie - eine gemeinsame Liste zwang jede Seite,
	// bei jedem Rahmen alle ausgewerteten Noten neu zu faerben.
	//
	// Computed from the evaluations rather than stored with them: the staff
	// mapping (`myStaff`) is reported by the first loaded page and the
	// segments (`events`) by the timeline, and either may arrive after the
	// analysis. Stored once, the note heads would stay uncoloured whenever
	// one of them came late.
	const marks = computed(() => {
		const evaluated = analysis.value?.markEvaluations
		return evaluated ? noteMarks(evaluated, notes(), myChannels(), events(), myStaff()) : []
	})

	// My part's notes sorted once (lib/intonation.js ownNotes), for the live
	// frames: 50 a second, each asking for the note under the cursor. Rebuilt
	// when the notes or the chosen part change - by identity and by the
	// channel list, since myChannels() may hand out a fresh array.
	let own = null
	function ownIndex() {
		const all = notes()
		const channels = myChannels()
		const key = channels ? [...channels].join(',') : null
		if (!own || own.notes !== all || own.key !== key) {
			own = { notes: all, key, index: ownNotes(all, channels) }
		}
		return own.index
	}

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
				onLiveFrames(message.frames, message.level ?? [])
			} else if (message.type === 'progress') {
				// Nur die juengste Anfrage zeigt Fortschritt - eine verworfene
				// rechnet im Worker noch zu Ende.
				if (message.id === requestId) {
					progress.value = message.done
				}
			} else if (message.type === 'analysis') {
				waiting.get(message.id)?.({ frames: message.frames, level: message.level })
				waiting.delete(message.id)
			}
		}
		// Ein Worker, der wirft (etwa ohne Speicher bei einer langen
		// Aufnahme), meldet sich sonst nie wieder: Die wartende Auswertung
		// hinge fuer immer auf „laeuft", und die Nadel stuende still.
		worker.onerror = (event) => {
			event.preventDefault?.()
			failWorker()
		}
		worker.onmessageerror = () => failWorker()
		return worker
	}

	/**
	 * Den Worker aufgeben: wartende Auswertungen enden mit null, die Nadel geht
	 * aus, und der naechste Auftrag bekommt einen frischen Worker.
	 */
	function failWorker() {
		error.value = t('The pitch analysis stopped unexpectedly.')
		for (const resolve of waiting.values()) {
			resolve(null)
		}
		waiting.clear()
		stopLive()
		dropWorker()
	}

	function dropWorker() {
		worker?.terminate()
		worker = null
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
		needleShownAt = -Infinity
		liveMarksKey = null
		w.postMessage({ type: 'live-reset' })
		unsubscribe = connectDirect(w, handle) ?? relayBlocks(w, handle)
		live.value = true
	}

	/**
	 * The blocks go from the worklet straight to the worker through a
	 * MessageChannel: relayed by the main thread they were 50 messages a
	 * second there, each one a copy, next to the viewer's frame loop.
	 *
	 * @param {Worker} w
	 * @param {object} handle from microphone.acquire()
	 * @return {?function(): void} the unsubscribe, or null where the port
	 *   cannot reach the worklet - then relayBlocks()
	 */
	function connectDirect(w, handle) {
		if (typeof MessageChannel === 'undefined' || !handle.attachPort) {
			return null
		}
		const channel = new MessageChannel()
		try {
			w.postMessage({ type: 'live-port', port: channel.port1 }, [channel.port1])
		} catch {
			return null
		}
		if (!handle.attachPort(channel.port2)) {
			w.postMessage({ type: 'live-port-close' })
			return null
		}
		return () => {
			handle.detachPort()
			// The worker may be gone already (failWorker).
			worker?.postMessage({ type: 'live-port-close' })
		}
	}

	/**
	 * Fallback: the blocks through the main thread.
	 *
	 * @param {Worker} w
	 * @param {object} handle from microphone.acquire()
	 * @return {function(): void} the unsubscribe
	 */
	function relayBlocks(w, handle) {
		return handle.onBlocks(({ samples, contextTimeSec }) => {
			// Eine Kopie: Den Block behaelt womoeglich gleichzeitig die Aufnahme.
			const copy = samples.slice()
			w.postMessage({ type: 'live', samples: copy, contextTimeSec }, [copy.buffer])
		})
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
		liveMarksKey = null
		liveContext = null
		microphone.release('intonation')
	}

	/**
	 * Receive every batch of live frames, `{contextTimeSec, hz, clarity}`.
	 *
	 * @param {function(Array<object>): void} cb
	 * @return {function(): void} unsubscribe
	 */
	function onFrames(cb) {
		frameListeners.add(cb)
		return () => frameListeners.delete(cb)
	}

	/**
	 * Receive every batch of live frames and level points in score time, while
	 * the playback runs: `{frames: [{scoreMs, hz, clarity}], level: [{scoreMs,
	 * db}], tempoFactor}`. Frames are already at a' = 440 (referencePitch.js).
	 *
	 * @param {function(object): void} cb
	 * @return {function(): void} unsubscribe
	 */
	function onScoreFrames(cb) {
		scoreFrameListeners.add(cb)
		return () => scoreFrameListeners.delete(cb)
	}

	/**
	 * One anchor per batch: the clock is read once, so the frames of a batch
	 * keep their spacing - a uniform raster is what rhythm.js expects of the
	 * level envelope.
	 *
	 * @param {Array<object>} frames at 440
	 * @param {Array<{contextTimeSec:number, db:number}>} level
	 */
	function emitScoreFrames(frames, level) {
		if (scoreFrameListeners.size === 0 || !isPlaying()) {
			return
		}
		const tempo = tempoFactor()
		const anchor = { contextTimeSec: liveContext.currentTime, scoreMs: clock()?.getCurrentTimeMs() ?? 0 }
		const toScore = (contextTimeSec) => captureToScoreMs({
			captureContextTimeSec: contextTimeSec,
			anchor,
			tempoFactor: tempo,
			outputLatencyMs: latencyMs(),
			inputLatencyMs: liveInputLatency,
		})
		const batch = {
			frames: frames.map((f) => ({ scoreMs: toScore(f.contextTimeSec), hz: f.hz, clarity: f.clarity })),
			level: level.map((p) => ({ scoreMs: toScore(p.contextTimeSec), db: p.db })),
			tempoFactor: tempo,
		}
		scoreFrameListeners.forEach((cb) => cb(batch))
	}

	function toggleLive() {
		if (live.value || startingLive) {
			stopLive()
		} else {
			startLive()
		}
	}

	function onLiveFrames(heard, level = []) {
		if (!live.value || !liveContext) {
			return
		}
		// Here, before the listeners: wait mode compares the same frames.
		const frames = framesAt440(heard, referenceHz())
		emitScoreFrames(frames, level)
		if (frames.length === 0) {
			return
		}
		frameListeners.forEach((cb) => cb(frames))
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
		const index = ownIndex()
		const target = targetIn(index, scoreMs, frame.hz)
		if (!target) {
			recent = []
			showNeedle({ cents: null, cls: 'rest' }, null, () => [])
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
		showNeedle({ cents, cls }, `${target.onMs}:${target.pitch}:${cls}`, () => noteMarksIn([{ note: target, class: cls }], index, events(), myStaff()))
	}

	/**
	 * Hand a new needle state to the view - only if it looks different and
	 * not more often than NEEDLE_MIN_INTERVAL_MS. A dropped frame is not
	 * lost: the next one, 20 ms later, carries the same or a newer state.
	 *
	 * @param {{cents: ?number, cls: string}} next
	 * @param {?string} marksKey target note and class - the marks change only with these
	 * @param {() => Array} buildMarks
	 */
	function showNeedle(next, marksKey, buildMarks) {
		const now = performance.now()
		if (now - needleShownAt < NEEDLE_MIN_INTERVAL_MS) {
			return
		}
		if (needleChanged(needle.value, next)) {
			needle.value = next
			needleShownAt = now
		}
		if (marksKey !== liveMarksKey) {
			liveMarksKey = marksKey
			liveMarks.value = buildMarks()
			needleShownAt = now
		}
	}

	/**
	 * Eine Aufnahme auswerten.
	 *
	 * @param {{id: (number|string), scoreStartMs:number, tempoFactor:number, referenceHz?:number}} recording
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
			const result = await new Promise((resolve) => {
				waiting.set(id, resolve)
				w.postMessage({ type: 'analyze', id, samples, sampleRate }, [samples.buffer])
			})
			// Inzwischen ein anderes Stueck (Setliste) oder eine andere
			// Aufnahme: Das Ergebnis gehoert zu Noten, die nicht mehr da sind,
			// und wuerde auf die neuen gefaerbt.
			if (!analysisGeneration.isCurrent(mine) || result === null) {
				return
			}
			const { frames, level } = result
			// Against the reference it was sung at, not today's setting
			// (lib/referencePitch.js); without one it is from before, at 440.
			const imPartitur = framesAt440(frames.map((f) => ({ scoreMs: recordingToScoreMs(recording, f.timeSec), hz: f.hz, clarity: f.clarity })), recording.referenceHz)
			const tempo = recording.tempoFactor || 1
			const evaluations = evaluateRecording(imPartitur, notes(), myChannels(), { tempoFactor: tempo })
			// Same frames, no second pass through the worker: rhythm is read
			// from what the pitch analysis already found.
			const rhythm = evaluateRhythm(imPartitur, evaluations, notes(), myChannels(), {
				tempoFactor: tempo,
				level: level && { db: level.db, t0Ms: recordingToScoreMs(recording, level.firstSec), stepMs: level.hopSec * 1000 * tempo },
			})
			const problems = problemList(evaluations, measureOf, rhythm)
			analysis.value = {
				recordingId: recording.id,
				evaluations,
				rhythm,
				problems,
				pitchProblems: problems.filter((p) => p.issues.some((i) => i.kind === 'pitch')).length,
				rhythmProblems: problems.filter((p) => p.issues.some((i) => i.kind !== 'pitch')).length,
				notEvaluable: evaluations.filter((e) => e.class === 'na').length,
				onsetsMeasured: rhythm.filter((r) => Number.isFinite(r.onset?.devMs)).length,
				onsetsNotEvaluable: rhythm.filter((r) => r.onset?.class === 'na').length,
				medianOnsetMs: medianOnsetMs(rhythm),
				// The note head shows the worst of pitch, onset and end (D2).
				markEvaluations: evaluations.map((e, i) => ({ ...e, class: worstClass(e.class, rhythm[i].onset?.class, rhythm[i].release?.class) })),
			}
		} catch (err) {
			if (!analysisGeneration.isCurrent(mine)) {
				return
			}
			// eslint-disable-next-line no-console
			console.error('ScoreView: analysing the recording failed.', err)
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
		const liefNoch = waiting.size > 0
		for (const resolve of waiting.values()) {
			resolve(null)
		}
		waiting.clear()
		// Der Worker hat nur einen Faden: Eine verworfene Auswertung rechnete
		// sonst im Hintergrund zu Ende, und eine danach eingeschaltete Nadel
		// kaeme erst hinter ihr an die Reihe. Beenden ist billiger als
		// abwarten - der naechste Auftrag legt einen neuen an. Nur ohne
		// laufende Nadel: Die haengt an genau diesem Worker.
		if (liefNoch && !live.value && !startingLive) {
			dropWorker()
		}
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
		dropWorker()
	}

	// Raeumt sich selbst ab, wenn der Besitzer geht - ScoreViewer ruft den
	// Abbau zwar ausdruecklich (in fester Reihenfolge, siehe beforeUnmount),
	// aber eine vergessene Zeile dort liesse sonst den Worker offen. Doppelt
	// aufgerufen schadet der Abbau nicht.
	if (getCurrentScope()) {
		onScopeDispose(destroy)
	}

	// Nobody watches a needle on a hidden page, but microphone, worklet and
	// pitch detection would keep running. It does not come back by itself:
	// switching the microphone on is a deliberate act (S3).
	const onVisibilityChange = () => {
		if (document.visibilityState === 'hidden') {
			stopLive()
		}
	}
	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', onVisibilityChange)
		if (getCurrentScope()) {
			onScopeDispose(() => document.removeEventListener('visibilitychange', onVisibilityChange))
		}
	}

	return {
		live,
		needle,
		marks,
		liveMarks,
		analysis,
		analyzing,
		progress,
		error,
		needPart,
		startLive,
		stopLive,
		toggleLive,
		onFrames,
		onScoreFrames,
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
