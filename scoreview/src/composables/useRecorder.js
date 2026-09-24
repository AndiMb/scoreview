import axios from '@nextcloud/axios'
import { translate } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { createGeneration } from '../lib/generation.js'
import { captureToScoreMs, playbackSchedule, tempoAfterListening } from '../lib/recordingAlign.js'
import { encodeWav, WAV_SAMPLE_RATE } from '../lib/wavCodec.js'

const t = (text, vars) => translate('scoreview', text, vars)

/** Kennung der noch nicht gespeicherten Aufnahme in `listening`. */
export const PENDING = 'pending'

/**
 * Eigene Aufnahmen: aufnehmen, speichern, auflisten, loeschen und
 * synchron zur Partitur abhoeren.
 *
 * **Aufnehmen:** Die Bloecke kommen aus der gemeinsamen Mikrofonstrecke
 * (useMicrophone.js) mit Kontextzeit. Waehrend der Sequencer laeuft, wird
 * bei jedem Block ein Anker (Kontextzeit, Partiturzeit) mitgeschrieben; aus
 * ihm, dem Zeitstempel des ersten Blocks und beiden Latenzen entsteht
 * `scoreStartMs` (lib/recordingAlign.js). Ohne Begleitung laeuft der
 * Sequencer trotzdem - stumm, damit Cursor und Einzaehler bleiben.
 *
 * **Abhoeren:** Die WAV wird im SELBEN AudioContext wie der Sequencer
 * gestartet, auf dessen Kontextzeit. Beide laufen danach durch
 * dieselbe Ausgabekette, und der Cursor bekommt die Latenz wie immer
 * (lib/playbackTime.js). Anhalten, Suchlauf und Loop-Ruecksprung starten die
 * Aufnahme neu an der passenden Stelle. Der Sequencer uebernimmt dafuer das
 * Tempo der Aufnahme - eine Aufnahme laesst sich nicht strecken; nach dem
 * Abhoeren gilt wieder das eigene (lib/recordingAlign.js).
 *
 * **Scheitert das Speichern**, bleibt die WAV im Speicher, ist
 * abspielbar und laesst sich erneut speichern. Ein Neuladen der Seite
 * ueberlebt sie nicht; das steht in der Oberflaeche.
 *
 * @param {object} deps
 * @param {() => number|string} deps.fileId
 * @param {() => boolean} deps.enabled Schalter `feature_recording`
 * @param {object} deps.microphone useMicrophone()
 * @param {() => ?object} deps.clock Zeitquelle (player.js/silentClock.js)
 * @param {() => ?AudioContext} deps.audioContext der der Wiedergabe
 * @param {() => boolean} deps.isPlaying sofort, an der Zeitquelle gefragt
 * @param {() => boolean} deps.playing reaktiv (usePlayback.isPlaying)
 * @param deps.play
 * @param deps.pause
 * @param deps.seek
 * @param deps.startCountIn
 * @param deps.clearCountIn
 * @param deps.currentTimeMs
 * @param deps.tempoFactor
 * @param deps.setTempoFactor
 * @param deps.latencyMs
 * @param deps.setAccompanimentGain
 * @param deps.maxPerScore
 * @param deps.maxSeconds
 * @return {object}
 */
export function useRecorder({
	fileId,
	enabled,
	microphone,
	clock,
	audioContext,
	isPlaying,
	playing,
	play,
	pause,
	seek,
	startCountIn,
	clearCountIn,
	currentTimeMs,
	tempoFactor,
	setTempoFactor,
	latencyMs,
	setAccompanimentGain,
	maxPerScore,
	maxSeconds,
}) {
	const recordings = ref([])
	const error = ref('')
	/** 'idle' | 'starting' | 'recording' | 'saving' */
	const phase = ref('idle')
	const elapsedMs = ref(0)
	const withAccompaniment = ref(true)
	const countIn = ref(true)
	/** Fragt, ob die aelteste Aufnahme ersetzt werden soll. */
	const confirmReplace = ref(false)
	/** Nicht gespeichert: {wav: ArrayBuffer, meta, error} */
	const pending = shallowRef(null)
	/**
	 * Die ungespeicherte Aufnahme nur bei ihrer eigenen Partitur zeigen. Sie
	 * ueberlebt einen Stueckwechsel in der Setliste bewusst (zurueck zum Stueck,
	 * und „Erneut speichern" geht weiter) - angezeigt beim naechsten Stueck
	 * wertete „Analysieren" sie aber gegen dessen Noten aus.
	 */
	const pendingHere = computed(() => (pending.value && String(pending.value.meta.fileId) === String(fileId())
		? pending.value
		: null))
	/** Welche Aufnahme gerade mitlaeuft: id, PENDING oder null. */
	const listening = ref(null)
	const recordingVolume = ref(1)
	const accompanimentVolume = ref(1)

	let generation = 0
	let confirmFor = null
	// Laufende Aufnahme.
	let chunks = []
	let samplesTotal = 0
	let firstBlockSec = null
	let anchor = null
	let startAnchor = null
	let tempoAtStart = 1
	let startedPlayback = false
	let replaceConfirmed = false
	// Die Partitur, zu der die laufende Aufnahme gehoert - festgehalten beim
	// Start: Wechselt die Setliste mitten im Aufnehmen das Stueck, wird die
	// Aufnahme noch abgeschlossen und muss bei IHRER Partitur landen.
	let recordingFileId = null
	let unsubscribe = null
	let handle = null
	// Abhoeren.
	let source = null
	let gainNode = null
	let gainContext = null
	let listenBuffer = null
	let listenMeta = null
	// Laden und Dekodieren dauern - wer inzwischen stoppt, das Stueck wechselt
	// oder eine andere Aufnahme waehlt, darf nicht von der alten ueberholt
	// werden, die danach Tempo, Position und Wiedergabe umstellte.
	const listenGeneration = createGeneration()
	// Das eigene Tempo vor dem ersten Abhoeren - beim Wechsel von einer
	// Aufnahme zur naechsten bleibt das urspruengliche gemerkt.
	let tempoBeforeListen = null
	const audioCache = new Map()
	const decodedCache = new WeakMap()
	let ownContext = null
	// Nach einem Suchlauf meldet der Sequencer kurz die alte Stelle (siehe
	// lib/player.js, 'timechange') - so lange wird nicht angesetzt, sonst
	// liefe die Aufnahme um den Sprung versetzt.
	let settling = false
	let settleTimer = null

	const baseUrl = (id = fileId()) => generateUrl('/apps/scoreview/api/scores/{fileId}/recordings', { fileId: id })

	async function load() {
		const mine = ++generation
		if (!enabled()) {
			recordings.value = []
			return
		}
		try {
			const res = await axios.get(baseUrl())
			if (mine === generation) {
				recordings.value = res.data?.recordings ?? []
			}
		} catch (err) {
			if (mine === generation) {
				error.value = messageOf(err, t('The recordings could not be loaded.'))
			}
		}
	}

	// --- Aufnehmen ---------------------------------------------------------

	/**
	 * @param {boolean} [confirmed] das Ersetzen der aeltesten ist bestaetigt
	 */
	async function start(confirmed = false) {
		if (phase.value !== 'idle') {
			return
		}
		error.value = ''
		if (!confirmed && recordings.value.length >= maxPerScore()) {
			// VOR dem Aufnehmen fragen, nicht danach - eine gesungene Aufnahme,
			// die dann nicht gespeichert werden darf, waere verlorene Muehe.
			confirmFor = 'start'
			confirmReplace.value = true
			return
		}
		replaceConfirmed = confirmed
		recordingFileId = fileId()
		stopListening()
		phase.value = 'starting'
		const acquired = await microphone.acquire('recorder', { onStop: () => stop() })
		if (phase.value !== 'starting') {
			// Waehrend der Rueckfrage des Browsers schon wieder beendet.
			if (acquired) {
				microphone.release('recorder')
			}
			return
		}
		handle = acquired
		if (!handle) {
			phase.value = 'idle'
			return
		}
		chunks = []
		samplesTotal = 0
		firstBlockSec = null
		anchor = null
		elapsedMs.value = 0
		tempoAtStart = tempoFactor()
		const context = handle.context
		// Fuer eine Aufnahme ohne laufende Wiedergabe: gesungen ab der
		// Cursorstelle, im eingestellten Tempo.
		startAnchor = { contextTimeSec: context.currentTime, scoreMs: clock()?.getCurrentTimeMs() ?? 0 }
		unsubscribe = handle.onBlocks(({ samples, contextTimeSec }) => {
			if (phase.value !== 'recording') {
				return
			}
			if (firstBlockSec === null) {
				firstBlockSec = contextTimeSec
			}
			chunks.push(samples)
			samplesTotal += samples.length
			elapsedMs.value = Math.round((samplesTotal / WAV_SAMPLE_RATE) * 1000)
			// Der Anker, solange der Sequencer laeuft: beide Werte im selben
			// Moment abgelesen, die Partiturzeit rechnet der Sequencer selbst
			// aus der Kontextzeit (lib/recordingAlign.js).
			if (isPlaying()) {
				anchor = { contextTimeSec: context.currentTime, scoreMs: clock()?.getCurrentTimeMs() ?? 0 }
			}
			if (elapsedMs.value >= maxSeconds() * 1000) {
				stop()
			}
		})
		setAccompanimentGain(withAccompaniment.value ? 1 : 0)
		phase.value = 'recording'
		startedPlayback = false
		if (!isPlaying()) {
			startedPlayback = true
			if (countIn.value) {
				startCountIn(currentTimeMs())
			} else {
				await play()
			}
		}
	}

	async function stop() {
		if (phase.value !== 'recording' && phase.value !== 'starting') {
			return
		}
		unsubscribe?.()
		unsubscribe = null
		const inputLatency = handle?.inputLatencyMs ?? 0
		handle = null
		microphone.release('recorder')
		clearCountIn()
		if (startedPlayback && isPlaying()) {
			pause()
		}
		setAccompanimentGain(1)
		if (chunks.length === 0 || firstBlockSec === null) {
			phase.value = 'idle'
			return
		}
		const scoreStartMs = Math.round(captureToScoreMs({
			captureContextTimeSec: firstBlockSec,
			anchor: anchor ?? startAnchor,
			tempoFactor: tempoAtStart,
			outputLatencyMs: latencyMs(),
			inputLatencyMs: inputLatency,
		}))
		const meta = {
			fileId: recordingFileId,
			scoreStartMs,
			tempoFactor: tempoAtStart,
			withAccompaniment: withAccompaniment.value,
			durationMs: Math.round((samplesTotal / WAV_SAMPLE_RATE) * 1000),
		}
		const wav = encodeWav(chunks)
		chunks = []
		await save(wav, meta, replaceConfirmed)
	}

	async function save(wav, meta, replaceOldest) {
		phase.value = 'saving'
		error.value = ''
		try {
			await axios.post(baseUrl(meta.fileId), wav, {
				headers: { 'Content-Type': 'audio/wav' },
				params: {
					scoreStartMs: meta.scoreStartMs,
					tempoFactor: meta.tempoFactor,
					withAccompaniment: meta.withAccompaniment ? 1 : 0,
					replaceOldest: replaceOldest ? 1 : 0,
				},
			})
			if (listening.value === PENDING) {
				stopListening()
			}
			pending.value = null
			await load()
		} catch (err) {
			pending.value = { wav, meta, error: messageOf(err, t('The recording could not be saved.')) }
			if (err?.response?.status === 409) {
				// Inzwischen anderswo aufgenommen (zweites Geraet): jetzt fragen.
				confirmFor = 'save'
				confirmReplace.value = true
			}
		} finally {
			phase.value = 'idle'
		}
	}

	function retrySave() {
		if (pending.value && phase.value === 'idle') {
			save(pending.value.wav, pending.value.meta, false)
		}
	}

	function discardPending() {
		if (listening.value === PENDING) {
			stopListening()
		}
		pending.value = null
	}

	function answerReplace(yes) {
		confirmReplace.value = false
		if (!yes) {
			return
		}
		if (confirmFor === 'start') {
			start(true)
		} else if (confirmFor === 'save' && pending.value) {
			save(pending.value.wav, pending.value.meta, true)
		}
	}

	async function remove(recording) {
		if (listening.value === recording.id) {
			stopListening()
		}
		try {
			await axios.delete(`${baseUrl()}/${recording.id}`)
			audioCache.delete(recording.id)
			await load()
		} catch (err) {
			error.value = messageOf(err, t('The recording could not be deleted.'))
		}
	}

	// --- Abhoeren ----------------------------------------------------------

	/**
	 * Die WAV-Bytes einer gespeicherten Aufnahme - auch fuer die
	 * Intonationsauswertung (useIntonation.js), die sie selbst dekodiert.
	 *
	 * @param {object} recording
	 * @return {Promise<ArrayBuffer>}
	 */
	async function loadAudio(recording) {
		if (recording.id === PENDING || recording === pending.value?.meta) {
			return pending.value.wav
		}
		if (!audioCache.has(recording.id)) {
			const res = await axios.get(`${baseUrl()}/${recording.id}`, { responseType: 'arraybuffer' })
			audioCache.set(recording.id, res.data)
		}
		return audioCache.get(recording.id)
	}

	function playbackContext() {
		return audioContext() ?? (ownContext = ownContext ?? new AudioContext())
	}

	async function decode(key, bytes) {
		const context = playbackContext()
		let perContext = decodedCache.get(context)
		if (!perContext) {
			perContext = new Map()
			decodedCache.set(context, perContext)
		}
		if (!perContext.has(key)) {
			// decodeAudioData uebernimmt den Puffer - die Kopie haelt den
			// Cache fuer die Auswertung heil.
			perContext.set(key, await context.decodeAudioData(bytes.slice(0)))
		}
		return perContext.get(key)
	}

	/**
	 * Eine Aufnahme mitlaufen lassen - ab ihrem Anfang in der Partitur.
	 *
	 * @param {object|'pending'} recording
	 */
	async function listen(recording) {
		if (phase.value !== 'idle') {
			return
		}
		error.value = ''
		const isPending = recording === PENDING
		const meta = isPending ? pending.value?.meta : recording
		if (!meta) {
			return
		}
		const mine = listenGeneration.next()
		let buffer
		try {
			const bytes = isPending ? pending.value.wav : await loadAudio(recording)
			buffer = await decode(isPending ? `pending:${meta.scoreStartMs}:${meta.durationMs}` : recording.id, bytes)
		} catch (err) {
			if (listenGeneration.isCurrent(mine)) {
				error.value = messageOf(err, t('The recording could not be played.'))
			}
			return
		}
		if (!listenGeneration.isCurrent(mine) || phase.value !== 'idle') {
			return
		}
		stopSource()
		if (tempoBeforeListen === null) {
			tempoBeforeListen = tempoFactor()
		}
		listenBuffer = buffer
		listenMeta = { scoreStartMs: meta.scoreStartMs, tempoFactor: meta.tempoFactor || 1, durationMs: listenBuffer.duration * 1000 }
		listening.value = isPending ? PENDING : recording.id
		setTempoFactor(listenMeta.tempoFactor)
		setAccompanimentGain(accompanimentVolume.value)
		if (isPlaying()) {
			pause()
		}
		seek(Math.max(0, listenMeta.scoreStartMs))
		await play()
		schedule()
	}

	/**
	 * Nach einem Suchlauf: Aufnahme anhalten und erst wieder ansetzen, wenn
	 * der Sequencer die neue Stelle bestaetigt hat - hoechstens eine halbe
	 * Sekunde, falls die Bestaetigung ausbleibt.
	 */
	function settleThenSchedule() {
		stopSource()
		if (!clock()?.seekIsAsync) {
			schedule()
			return
		}
		settling = true
		clearTimeout(settleTimer)
		settleTimer = setTimeout(settled, 500)
	}

	function settled() {
		clearTimeout(settleTimer)
		settleTimer = null
		if (!settling) {
			return
		}
		settling = false
		if (listening.value && isPlaying()) {
			schedule()
		}
	}

	function stopListening() {
		listenGeneration.invalidate()
		const restore = tempoAfterListening({
			before: tempoBeforeListen,
			listened: listenMeta?.tempoFactor ?? null,
			current: tempoFactor(),
		})
		tempoBeforeListen = null
		listening.value = null
		listenBuffer = null
		listenMeta = null
		stopSource()
		setAccompanimentGain(1)
		if (restore !== null) {
			setTempoFactor(restore)
		}
	}

	function ensureGain(context) {
		if (gainNode && gainContext === context) {
			return gainNode
		}
		gainNode?.disconnect()
		gainNode = context.createGain()
		gainNode.connect(context.destination)
		gainContext = context
		gainNode.gain.value = recordingVolume.value
		return gainNode
	}

	/**
	 * Die Aufnahme auf die Kontextzeit des Sequencers setzen. Nach jedem
	 * Start, Suchlauf und Loop-Ruecksprung neu - ein einmal gestarteter
	 * AudioBufferSourceNode laesst sich nicht versetzen.
	 */
	function schedule() {
		stopSource()
		if (settling || !listenBuffer || !listenMeta || !isPlaying()) {
			return
		}
		const context = playbackContext()
		const plan = playbackSchedule({
			recording: listenMeta,
			anchor: { contextTimeSec: context.currentTime, scoreMs: clock()?.getCurrentTimeMs() ?? 0 },
			tempoFactor: tempoFactor(),
		})
		if (!plan) {
			return
		}
		source = context.createBufferSource()
		source.buffer = listenBuffer
		source.connect(ensureGain(context))
		source.start(plan.whenSec, plan.offsetSec)
	}

	function stopSource() {
		if (source) {
			try {
				source.stop()
			} catch {
				// Noch nicht gestartet oder schon zu Ende - beides ist „aus".
			}
			source.disconnect()
			source = null
		}
	}

	// `playing` ist die reaktive Anzeige (einmal je Bild nachgefuehrt),
	// `isPlaying()` fragt die Zeitquelle selbst - fuer Entscheidungen im
	// selben Moment.
	watch(playing, (laeuft) => {
		if (!listening.value) {
			return
		}
		if (laeuft) {
			schedule()
		} else {
			stopSource()
		}
	})

	watch(recordingVolume, (v) => {
		if (gainNode) {
			gainNode.gain.setTargetAtTime(v, gainContext.currentTime, 0.01)
		}
	})

	watch(accompanimentVolume, (v) => {
		if (listening.value) {
			setAccompanimentGain(v)
		}
	})

	// Suchlauf und Loop-Ruecksprung melden sich als 'seeked' an der
	// Zeitquelle - danach die Aufnahme neu ansetzen.
	const onSeeked = () => {
		if (listening.value) {
			settleThenSchedule()
		}
	}
	watch(clock, (neu, alt) => {
		alt?.removeEventListener?.('seeked', onSeeked)
		alt?.removeEventListener?.('timechange', settled)
		neu?.addEventListener?.('seeked', onSeeked)
		neu?.addEventListener?.('timechange', settled)
		if (alt && neu !== alt) {
			stopListening()
		}
	}, { immediate: true })

	function reset() {
		generation++
		if (phase.value === 'recording' || phase.value === 'starting') {
			stop()
		}
		stopListening()
		recordings.value = []
		error.value = ''
		confirmReplace.value = false
		audioCache.clear()
	}

	function destroy() {
		reset()
		gainNode?.disconnect()
		gainNode = null
		if (ownContext) {
			ownContext.close().catch(() => {})
			ownContext = null
		}
	}

	// Raeumt sich selbst ab, wenn der Besitzer geht - ScoreViewer ruft den
	// Abbau zwar ausdruecklich (in fester Reihenfolge, siehe beforeUnmount),
	// aber eine vergessene Zeile dort liesse sonst eine laufende Aufnahme offen. Doppelt
	// aufgerufen schadet der Abbau nicht.
	if (getCurrentScope()) {
		onScopeDispose(destroy)
	}

	return {
		recordings,
		error,
		phase,
		elapsedMs,
		withAccompaniment,
		countIn,
		confirmReplace,
		pending: pendingHere,
		listening,
		recordingVolume,
		accompanimentVolume,
		load,
		start,
		stop,
		retrySave,
		discardPending,
		answerReplace,
		remove,
		listen,
		stopListening,
		loadAudio,
		reset,
		destroy,
	}
}

/**
 * Die Meldung des Servers, wo es eine gibt - sie nennt Grenzen und Gruende
 * (RecordingController::refused), die hier niemand besser weiss.
 *
 * @param {?object} err
 * @param {string} fallback
 * @return {string}
 */
function messageOf(err, fallback) {
	const fromServer = err?.response?.data?.error
	if (typeof fromServer === 'string' && fromServer !== '') {
		return fromServer
	}
	if (!err?.response) {
		return t('No connection to the server.') + ' ' + fallback
	}
	return fallback
}
