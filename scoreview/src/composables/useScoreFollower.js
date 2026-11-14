import { getCurrentScope, onScopeDispose, ref } from 'vue'
import { translate } from '../l10n.js'
import { chroma36, fftSizeFor, spectrumLevelDb } from '../lib/chroma.js'
import { shownBetweenReports } from '../lib/followerTime.js'
import { createGeneration } from '../lib/generation.js'

/** One tap of features - the rate the follower was measured at (tools/follow/replay.mjs HOP_MS). */
const TAP_MS = 50

const t = (text) => translate('scoreview', text)

/**
 * Turning pages from the microphone (automatic page turning): the shared
 * microphone (useMicrophone.js, consumer `follower` - a source, never
 * blocks, so nothing can be stored, S7), an AnalyserNode read every 50 ms,
 * the follower itself in workers/followerWorker.js. The display hangs on
 * the follower's place through usePlayback.followTime, the same hook "Follow
 * me" uses: cursor, scrolling and paging follow without knowing where the
 * time comes from.
 *
 * The singer sets the starting place by tapping a note or entering a bar
 * (anchor): measured on rehearsal recordings, a tap before each run lifted
 * bars within one bar from about 71 % to 91 % and left no wrong turn. The
 * follower still searches the whole piece, so a run without a tap is found
 * too, only later.
 *
 * @param {object} deps
 * @param {object} deps.microphone useMicrophone()
 * @param {() => Promise<?{notes: object[], parts: object[], options: object}>} deps.input lib/followInput.js, null while the score is not loaded
 * @param {(getter: ?(() => number)) => void} deps.followTime hang the display on a time, or let go
 * @return {object}
 */
export function useScoreFollower({ microphone, input, followTime }) {
	const active = ref(false)
	/** 'searching' | 'following' | 'unsure' | 'lost' (lib/scoreFollower.js) */
	const phase = ref('searching')
	const error = ref('')

	let worker = null
	let analyser = null
	let context = null
	let timer = null
	let spectrum = null
	let report = null
	let starting = false
	let destroyed = false
	const generation = createGeneration()

	const nowMs = () => (context ? context.currentTime * 1000 : 0)
	const shownMs = () => shownBetweenReports(report, nowMs())

	function ensureWorker() {
		if (worker || destroyed) {
			return worker
		}
		worker = new Worker(new URL('../workers/followerWorker.js', import.meta.url))
		worker.onmessage = ({ data }) => {
			if (!active.value) {
				return
			}
			if (data.type === 'state') {
				report = data
				phase.value = data.phase
			} else if (data.type === 'error') {
				// eslint-disable-next-line no-console
				console.error('ScoreView: score follower failed:', data.message)
				error.value = t('Automatic page turning stopped unexpectedly.')
				stop()
			}
		}
		worker.onerror = (event) => {
			event.preventDefault?.()
			error.value = t('Automatic page turning stopped unexpectedly.')
			stop()
			worker?.terminate()
			worker = null
		}
		return worker
	}

	/**
	 * Switch on - from a user action (the browser asks for the microphone).
	 *
	 * @param {?number} [startMs] where the singing starts, if known (the cursor)
	 */
	async function start(startMs = null) {
		if (active.value || starting || destroyed) {
			return
		}
		error.value = ''
		const mine = generation.next()
		starting = true
		let handle
		let score
		try {
			// The microphone first, while the tap still counts as a user
			// action; the MIDI may have to be fetched after.
			handle = await microphone.acquire('follower', { onStop: () => stop() })
			score = handle ? await input() : null
		} finally {
			if (generation.isCurrent(mine)) {
				starting = false
			}
		}
		if (!generation.isCurrent(mine)) {
			if (handle) {
				microphone.release('follower')
			}
			return
		}
		if (!handle) {
			return
		}
		if (!score) {
			microphone.release('follower')
			error.value = t('The score is not loaded yet.')
			return
		}
		const w = ensureWorker()
		if (!w) {
			microphone.release('follower')
			return
		}
		context = handle.context
		analyser = context.createAnalyser()
		analyser.fftSize = fftSizeFor(context.sampleRate)
		// No smoothing: the follower was measured on raw spectra, and its
		// own windows do the averaging.
		analyser.smoothingTimeConstant = 0
		handle.source.connect(analyser)
		spectrum = new Float32Array(analyser.frequencyBinCount)
		report = null
		phase.value = 'searching'
		w.postMessage({ type: 'init', input: score })
		if (Number.isFinite(startMs)) {
			anchor(startMs)
		}
		timer = setInterval(tap, TAP_MS)
		active.value = true
		followTime(shownMs)
	}

	function tap() {
		if (!analyser || !worker) {
			return
		}
		analyser.getFloatFrequencyData(spectrum)
		const sampleRate = context.sampleRate
		const c36 = chroma36(spectrum, sampleRate, analyser.fftSize)
		const message = { type: 'frame', c36, levelDb: spectrumLevelDb(spectrum, sampleRate, analyser.fftSize), atMs: nowMs() }
		worker.postMessage(message, c36 ? [c36.buffer] : [])
	}

	/**
	 * The singer set the starting place (a tapped note, an entered bar).
	 *
	 * @param {number} scoreMs
	 */
	function anchor(scoreMs) {
		if (!worker || !Number.isFinite(scoreMs)) {
			return
		}
		const atMs = nowMs()
		worker.postMessage({ type: 'anchor', scoreMs, atMs })
		// Shown at once, not 50 ms later with the worker's next report.
		report = { atMs, shownMs: scoreMs, tempoRatio: 1, phase: 'following' }
		phase.value = 'following'
	}

	function stop() {
		generation.invalidate()
		starting = false
		if (!active.value) {
			return
		}
		clearInterval(timer)
		timer = null
		try {
			analyser?.disconnect()
		} catch {
			// Already gone with the microphone chain.
		}
		analyser = null
		spectrum = null
		report = null
		context = null
		active.value = false
		followTime(null)
		microphone.release('follower')
	}

	function toggle(startMs = null) {
		if (active.value || starting) {
			stop()
		} else {
			start(startMs)
		}
	}

	function destroy() {
		destroyed = true
		stop()
		worker?.terminate()
		worker = null
	}

	if (getCurrentScope()) {
		onScopeDispose(destroy)
	}

	// On a hidden page nobody reads the score, and the browser may starve
	// the timer anyway. Switching back on is a deliberate act (S3).
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

	return { active, phase, error, start, stop, toggle, anchor, destroy }
}
