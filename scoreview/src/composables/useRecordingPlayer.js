import { getCurrentScope, onScopeDispose, ref, watch } from 'vue'
import { createAudioContext } from '../lib/audioSession.js'
import { createGeneration } from '../lib/generation.js'
import { playbackSchedule, tempoAfterListening } from '../lib/recordingAlign.js'

/**
 * Listening to a recording in sync with the score.
 *
 * The WAV starts in the SAME AudioContext as the sequencer, on its context
 * time. Both then run through the same output chain, and the cursor gets
 * the latency as always (lib/playbackTime.js). Pause, seek and the loop's
 * jump back restart the recording at the matching place. The sequencer
 * takes over the recording's tempo for that - a recording cannot be
 * stretched; after listening, the own tempo applies again
 * (lib/recordingAlign.js).
 *
 * Kept apart from recording (useRecorder.js), which composes it: what is
 * heard here never touches the microphone, and the two share only "is a
 * take running" (`ready`) and where errors are shown (`onError`).
 *
 * @param {object} deps
 * @param {() => ?object} deps.clock time source (player.js/silentClock.js)
 * @param {() => ?AudioContext} deps.audioContext the playback's
 * @param {(reason: string) => (() => void)} [deps.holdAudio] keeps it awake while listening
 * @param {() => boolean} deps.isPlaying asked at the time source, right now
 * @param {() => boolean} deps.playing reactive (usePlayback.isPlaying)
 * @param {() => Promise<void>} deps.play
 * @param {() => void} deps.pause
 * @param {(ms: number) => void} deps.seek
 * @param {() => number} deps.tempoFactor
 * @param {(factor: number) => void} deps.setTempoFactor
 * @param {(gain: number) => void} deps.setAccompanimentGain
 * @param {() => boolean} [deps.ready] false while a take is being recorded or saved
 * @param {(err: Error) => void} [deps.onError] loading or decoding failed
 * @return {object}
 */
export function useRecordingPlayer({
	clock,
	audioContext,
	holdAudio = () => () => {},
	isPlaying,
	playing,
	play,
	pause,
	seek,
	tempoFactor,
	setTempoFactor,
	setAccompanimentGain,
	ready = () => true,
	onError = () => {},
}) {
	/** Which recording runs along: its id, or null. */
	const listening = ref(null)
	const recordingVolume = ref(1)
	const accompanimentVolume = ref(1)

	let source = null
	let gainNode = null
	let gainContext = null
	let listenBuffer = null
	let listenMeta = null
	// Loading and decoding take time - whoever stops meanwhile, changes the
	// piece or picks another recording must not be overtaken by the old one,
	// which would then reset tempo, position and playback.
	const listenGeneration = createGeneration()
	// The own tempo before the first listening - switching from one recording
	// to the next keeps the original one.
	let tempoBeforeListen = null
	const decodedCache = new WeakMap()
	let releaseListenAudio = null
	let ownContext = null
	// After a seek the sequencer briefly reports the old place (see
	// lib/player.js, 'timechange') - no start until then, or the recording
	// would run offset by the jump.
	let settling = false
	let settleTimer = null

	function playbackContext() {
		return audioContext() ?? (ownContext = ownContext ?? createAudioContext())
	}

	async function decode(key, bytes) {
		const context = playbackContext()
		let perContext = decodedCache.get(context)
		if (!perContext) {
			perContext = new Map()
			decodedCache.set(context, perContext)
		}
		if (!perContext.has(key)) {
			// decodeAudioData takes over the buffer - the copy keeps the
			// caller's cache whole for the evaluation (useIntonation.js).
			perContext.set(key, await context.decodeAudioData(bytes.slice(0)))
		}
		return perContext.get(key)
	}

	/**
	 * Lets a recording run along - from its start in the score.
	 *
	 * @param {object} take
	 * @param {string|number} take.id what `listening` shows
	 * @param {string|number} take.cacheKey names the decoded audio
	 * @param {{scoreStartMs: number, tempoFactor: number}} take.meta
	 * @param {() => Promise<ArrayBuffer>} take.bytes the WAV
	 */
	async function listen({ id, cacheKey, meta, bytes }) {
		const mine = listenGeneration.next()
		let buffer
		try {
			buffer = await decode(cacheKey, await bytes())
		} catch (err) {
			if (listenGeneration.isCurrent(mine)) {
				onError(err)
			}
			return
		}
		if (!listenGeneration.isCurrent(mine) || !ready()) {
			return
		}
		stopSource()
		if (tempoBeforeListen === null) {
			tempoBeforeListen = tempoFactor()
		}
		listenBuffer = buffer
		listenMeta = { scoreStartMs: meta.scoreStartMs, tempoFactor: meta.tempoFactor || 1, durationMs: listenBuffer.duration * 1000 }
		listening.value = id
		setTempoFactor(listenMeta.tempoFactor)
		setAccompanimentGain(accompanimentVolume.value)
		if (isPlaying()) {
			pause()
		}
		// The recording sounds through the playback context, also past the
		// end of the score - keep it awake until listening stops.
		releaseListenAudio?.()
		releaseListenAudio = holdAudio('listening')
		seek(Math.max(0, listenMeta.scoreStartMs))
		await play()
		schedule()
	}

	/**
	 * After a seek: halt the recording and start it again once the sequencer
	 * has confirmed the new place - half a second at most, should the
	 * confirmation not come.
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
		releaseListenAudio?.()
		releaseListenAudio = null
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
	 * Puts the recording on the sequencer's context time. Anew after every
	 * start, seek and loop jump - a started AudioBufferSourceNode cannot be
	 * moved.
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
				// Not started yet or already over - both mean "off".
			}
			source.disconnect()
			source = null
		}
	}

	// `playing` is the reactive display (updated once per frame),
	// `isPlaying()` asks the time source itself - for decisions in the same
	// moment.
	watch(playing, (on) => {
		if (!listening.value) {
			return
		}
		if (on) {
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

	// Seek and loop jump announce themselves as 'seeked' at the time source
	// - start the recording anew after them.
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

	/** Idempotent: the owner's explicit call and the scope's may both come. */
	function destroy() {
		stopListening()
		clearTimeout(settleTimer)
		settleTimer = null
		settling = false
		gainNode?.disconnect()
		gainNode = null
		gainContext = null
		if (ownContext) {
			ownContext.close().catch(() => {})
			ownContext = null
		}
	}

	if (getCurrentScope()) {
		onScopeDispose(destroy)
	}

	return {
		listening,
		recordingVolume,
		accompanimentVolume,
		listen,
		stopListening,
		destroy,
	}
}
