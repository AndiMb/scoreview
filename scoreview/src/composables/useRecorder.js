import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'
import { translate } from '../l10n.js'
import { captureToScoreMs } from '../lib/recordingAlign.js'
import { serverError } from '../lib/serverError.js'
import { encodeWav, WAV_SAMPLE_RATE } from '../lib/wavCodec.js'
import { useRecordingPlayer } from './useRecordingPlayer.js'

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
 * **Abhoeren:** useRecordingPlayer.js, hier nur angebunden.
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
 * @param {(reason: string) => (() => void)} [deps.holdAudio] keeps it awake while listening back
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
 * @param {() => number} [deps.referenceHz] a' while recording, stored with the recording
 * @return {object}
 */
export function useRecorder({
	fileId,
	enabled,
	microphone,
	clock,
	audioContext,
	holdAudio = () => () => {},
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
	referenceHz = () => 440,
}) {
	const recordings = ref([])
	// Released by leaders to parts (E21) - unfiltered; who sees which is
	// decided in the viewer (lib/sharedRecordings.js).
	const sharedRecordings = ref([])
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

	let generation = 0
	let confirmFor = null
	// Laufende Aufnahme.
	let chunks = []
	let samplesTotal = 0
	let firstBlockSec = null
	let anchor = null
	let startAnchor = null
	let tempoAtStart = 1
	// Taken at the start like the tempo: the reference the singer heard,
	// even if the setting changes before the upload.
	let referenceAtStart = 440
	let startedPlayback = false
	let replaceConfirmed = false
	// Die Partitur, zu der die laufende Aufnahme gehoert - festgehalten beim
	// Start: Wechselt die Setliste mitten im Aufnehmen das Stueck, wird die
	// Aufnahme noch abgeschlossen und muss bei IHRER Partitur landen.
	let recordingFileId = null
	let unsubscribe = null
	let handle = null
	const audioCache = new Map()

	// Listening back lives in its own composable; the recorder only decides
	// when it may start (not while a take runs) and where errors show.
	const player = useRecordingPlayer({
		clock,
		audioContext,
		holdAudio,
		isPlaying,
		playing,
		play,
		pause,
		seek,
		tempoFactor,
		setTempoFactor,
		setAccompanimentGain,
		ready: () => phase.value === 'idle',
		onError: (err) => {
			error.value = messageOf(err, t('The recording could not be played.'))
		},
	})
	const { listening, recordingVolume, accompanimentVolume, stopListening } = player

	const baseUrl = (id = fileId()) => generateUrl('/apps/scoreview/api/scores/{fileId}/recordings', { fileId: id })

	async function load() {
		const mine = ++generation
		if (!enabled()) {
			recordings.value = []
			sharedRecordings.value = []
			return
		}
		try {
			const res = await axios.get(baseUrl())
			if (mine === generation) {
				recordings.value = res.data?.recordings ?? []
				sharedRecordings.value = res.data?.shared ?? []
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
		referenceAtStart = referenceHz()
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
			const elapsed = Math.round((samplesTotal / WAV_SAMPLE_RATE) * 1000)
			// The display shows whole seconds; setting the ref for every
			// 20 ms block re-rendered the viewer 50 times a second.
			if (Math.floor(elapsed / 1000) !== Math.floor(elapsedMs.value / 1000)) {
				elapsedMs.value = elapsed
			}
			// Der Anker, solange der Sequencer laeuft: beide Werte im selben
			// Moment abgelesen, die Partiturzeit rechnet der Sequencer selbst
			// aus der Kontextzeit (lib/recordingAlign.js).
			if (isPlaying()) {
				anchor = { contextTimeSec: context.currentTime, scoreMs: clock()?.getCurrentTimeMs() ?? 0 }
			}
			if (elapsed >= maxSeconds() * 1000) {
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
			referenceHz: referenceAtStart,
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
					referenceHz: meta.referenceHz,
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

	/**
	 * Releases an own recording to parts, or takes it back (E21). The server
	 * checks the role; taking back needs none.
	 *
	 * @param {object} recording
	 * @param {?Array<{id:string, name:string}>} targetParts null = private again
	 */
	async function share(recording, targetParts) {
		error.value = ''
		try {
			await axios.put(`${baseUrl()}/${recording.id}`, { targetParts: targetParts && targetParts.length > 0 ? targetParts : null })
			await load()
		} catch (err) {
			error.value = messageOf(err, t('The recording could not be shared.'))
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
		const wav = isPending ? pending.value.wav : null
		await player.listen({
			id: isPending ? PENDING : recording.id,
			cacheKey: isPending ? `pending:${meta.scoreStartMs}:${meta.durationMs}` : recording.id,
			meta,
			bytes: () => (wav ? Promise.resolve(wav) : loadAudio(recording)),
		})
	}

	function reset() {
		generation++
		if (phase.value === 'recording' || phase.value === 'starting') {
			stop()
		}
		stopListening()
		recordings.value = []
		sharedRecordings.value = []
		error.value = ''
		confirmReplace.value = false
		audioCache.clear()
	}

	function destroy() {
		reset()
		player.destroy()
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
		sharedRecordings,
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
		share,
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
	// No response at all is a lost connection, not a refusal - say so in
	// front of the fallback, or "could not be saved" reads like a verdict.
	if (!err?.response) {
		return t('No connection to the server.') + ' ' + fallback
	}
	return serverError(err, fallback)
}
