import { getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'
import { translate } from '../l10n.js'
import { createGeneration } from '../lib/generation.js'
import { A4_HZ } from '../lib/intonation.js'
import { nearest, smooth } from '../lib/tuner.js'

/**
 * Frames the reading is smoothed over (lib/tuner.js smooth): 120 ms is six
 * frames - enough to hold the needle through vibrato, short enough that a
 * new note shows within a tenth of a second.
 */
const SMOOTHING_WINDOW_MS = 120

/**
 * The reading is handed to the view at most this often (~12 Hz), like the
 * intonation needle (useIntonation.js): frames arrive every 20 ms, every
 * change re-renders the viewer, and the eye follows no needle faster.
 */
const SHOW_MIN_INTERVAL_MS = 80

/** Silence this long clears the reading - a tuner that keeps showing the last note lies. */
const SILENCE_AFTER_MS = 300

const t = (text) => translate('scoreview', text)

/**
 * The tuner (B3): the sounding pitch from the microphone, as the nearest
 * note with its deviation in cents, with no target note - unlike the
 * intonation check, which measures against the score.
 *
 * Same chain as the intonation needle: the shared microphone
 * (useMicrophone.js, consumer `tuner`), blocks to the pitch worker
 * (workers/pitchWorker.js), frames back. The analysis stays off the main
 * thread for the same reason as there - YIN per 20-ms frame would take the
 * frames the viewer's loop needs. Nothing is stored (S7): the tuner reads
 * and shows, that is all.
 *
 * @param {object} deps
 * @param {object} deps.microphone useMicrophone()
 * @param {() => number} [deps.referenceHz] a' (lib/referencePitch.js)
 * @return {object}
 */
export function useTuner({ microphone, referenceHz = () => A4_HZ }) {
	const active = ref(false)
	/** {midi, cents, hz} or null for silence and unclear signal (two voices, breath). */
	const reading = shallowRef(null)
	const error = ref('')

	let worker = null
	let unsubscribe = null
	let frames = []
	let shownAt = -Infinity
	let silenceTimer = null
	// Waehrend der Rueckfrage des Browsers ist `active` noch false - wie bei
	// der Intonation braucht stop() eine Marke, um ein wartendes Einschalten
	// zu verwerfen und das Mikrofon danach wieder abzugeben.
	let starting = false
	let destroyed = false
	const generation = createGeneration()

	function ensureWorker() {
		if (worker || destroyed) {
			return worker
		}
		// Same pattern as useIntonation: webpack builds the worker as its own
		// chunk under the app's runtime address (publicPath.js).
		worker = new Worker(new URL('../workers/pitchWorker.js', import.meta.url))
		worker.onmessage = (event) => {
			if (event.data.type === 'live') {
				onFrames(event.data.frames)
			}
		}
		worker.onerror = (event) => {
			event.preventDefault?.()
			error.value = t('The pitch analysis stopped unexpectedly.')
			stop()
			dropWorker()
		}
		return worker
	}

	function dropWorker() {
		worker?.terminate()
		worker = null
	}

	async function start() {
		if (active.value || starting || destroyed) {
			return
		}
		error.value = ''
		const mine = generation.next()
		starting = true
		let handle
		try {
			handle = await microphone.acquire('tuner', { onStop: () => stop() })
		} finally {
			if (generation.isCurrent(mine)) {
				starting = false
			}
		}
		if (!generation.isCurrent(mine)) {
			// Switched off during the browser's prompt: the chain was still
			// registered for us and has to be given back.
			if (handle) {
				microphone.release('tuner')
			}
			return
		}
		if (!handle) {
			return
		}
		const w = ensureWorker()
		if (!w) {
			microphone.release('tuner')
			return
		}
		frames = []
		shownAt = -Infinity
		reading.value = null
		w.postMessage({ type: 'live-reset' })
		unsubscribe = handle.onBlocks(({ samples, contextTimeSec }) => {
			// A copy: the same block may be kept by a recording running alongside.
			const copy = samples.slice()
			w.postMessage({ type: 'live', samples: copy, contextTimeSec }, [copy.buffer])
		})
		active.value = true
	}

	function stop() {
		generation.invalidate()
		starting = false
		clearTimeout(silenceTimer)
		silenceTimer = null
		if (!active.value) {
			return
		}
		unsubscribe?.()
		unsubscribe = null
		active.value = false
		reading.value = null
		frames = []
		microphone.release('tuner')
	}

	function toggle() {
		if (active.value || starting) {
			stop()
		} else {
			start()
		}
	}

	/**
	 * @param {Array<{contextTimeSec: number, hz: ?number, clarity: number}>} newFrames
	 */
	function onFrames(newFrames) {
		if (!active.value || newFrames.length === 0) {
			return
		}
		frames.push(...newFrames)
		const since = frames[frames.length - 1].contextTimeSec - SMOOTHING_WINDOW_MS / 1000
		frames = frames.filter((f) => f.contextTimeSec >= since)
		const hz = smooth(frames, SMOOTHING_WINDOW_MS)
		if (hz === null) {
			// Not at once: between two notes the detector drops a frame or
			// two, and the needle would flicker off and on.
			if (reading.value !== null && silenceTimer === null) {
				silenceTimer = setTimeout(() => {
					silenceTimer = null
					reading.value = null
				}, SILENCE_AFTER_MS)
			}
			return
		}
		clearTimeout(silenceTimer)
		silenceTimer = null
		const now = performance.now()
		if (now - shownAt < SHOW_MIN_INTERVAL_MS) {
			return
		}
		const near = nearest(hz, referenceHz())
		if (!near) {
			return
		}
		shownAt = now
		reading.value = { midi: near.midi, cents: near.cents, hz }
	}

	function destroy() {
		destroyed = true
		stop()
		dropWorker()
	}

	if (getCurrentScope()) {
		onScopeDispose(destroy)
	}

	// Nobody reads a tuner on a hidden page; the microphone would keep
	// running. It does not come back by itself: switching the microphone on
	// is a deliberate act (S3).
	const onVisibilityChange = () => {
		if (document.visibilityState === 'hidden') {
			stop()
		}
	}
	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', onVisibilityChange)
		if (getCurrentScope()) {
			onScopeDispose(() => document.removeEventListener('visibilitychange', onVisibilityChange))
		}
	}

	return { active, reading, error, start, stop, toggle, destroy }
}
