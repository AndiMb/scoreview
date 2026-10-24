import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue'
import {
	createMatchRun,
	frameMatches,
	heldNotes,
	MATCH_FRAMES,
	msUntilStop,
	nextWait,
	WAIT_LEAD_MS,
	waitableChords,
} from '../lib/waitMode.js'

/**
 * A timer that fires this many ms early or late is corrected rather than
 * trusted: setTimeout never fires early, but the sequencer's clock is read
 * from the audio thread and may lag a few ms behind.
 */
const EARLY_SLACK_MS = 4

/**
 * Wait mode (C2): playback stops before each note of my part until the
 * microphone hears it, then goes on at the set tempo. For learning notes -
 * the rhythm does not count here, and the panel says so (N-C2.1).
 *
 * **Same microphone chain as live intonation.** The frames come from the
 * pitch worker that drives the needle (useIntonation.onFrames); the needle
 * stays on, so whoever waits sees how far off they are.
 *
 * **What sounds while waiting:** the accompaniment that was playing, held by
 * the synthesizer (player.holdChord) - the note is searched for against its
 * harmony. My own part is silent for the whole mode: from a loudspeaker the
 * microphone would hear the app sing it and go on by itself.
 *
 * **Who stops whom** is decided in ScoreViewer: metronome, speed trainer,
 * recording and following a leader end wait mode, and wait mode switches off
 * metronome and speed trainer (F-C2.2). A recording could not be laid on the
 * score anyway: its pauses break the linear time axis of recordingAlign.js.
 *
 * @param {object} deps
 * @param {() => ?object} deps.clock player or silent clock
 * @param {() => number} deps.tempoFactor
 * @param {() => Array} deps.targets my notes as they sound (transposed)
 * @param {() => Array} deps.synthNotes all notes as the synthesizer plays them (untransposed)
 * @param {() => ?Array<number>} deps.myChannels
 * @param {object} deps.intonation useIntonation(): live, startLive, stopLive, onFrames
 * @param {(muted: boolean) => void} deps.setMineMuted
 * @return {object}
 */
export function useWaitMode({ clock, tempoFactor, targets, synthNotes, myChannels, intonation, setMineMuted }) {
	const active = ref(false)
	const waiting = ref(false)
	/** Without a chosen part there is nothing to wait for - the panel asks. */
	const needPart = ref(false)

	const chords = computed(() => waitableChords(targets(), myChannels(), tempoFactor()))

	let timer = null
	let planned = null
	let waitChord = null
	// Onset of the chord last stopped for: never the same one twice in a row,
	// even if the clock reads a few ms early after play().
	let doneOnMs = null
	let recent = []
	let startedLive = false
	let unsubscribeFrames = null
	const run = createMatchRun()

	function clearTimer() {
		clearTimeout(timer)
		timer = null
	}

	function plan() {
		clearTimer()
		planned = null
		const c = clock()
		if (!active.value || waiting.value || !c?.isPlaying()) {
			return
		}
		const tf = tempoFactor()
		const now = c.getCurrentTimeMs()
		const next = nextWait(chords.value, now, WAIT_LEAD_MS * tf, doneOnMs)
		if (!next) {
			return
		}
		planned = next
		timer = setTimeout(fire, msUntilStop(now, next, tf))
	}

	function fire() {
		timer = null
		const c = clock()
		const chord = planned
		if (!active.value || !chord || !c?.isPlaying()) {
			return
		}
		const tf = tempoFactor()
		const now = c.getCurrentTimeMs()
		const remaining = msUntilStop(now, chord, tf)
		if (remaining > EARLY_SLACK_MS) {
			timer = setTimeout(fire, remaining)
			return
		}
		doneOnMs = chord.onMs
		// Already singing it (a repeated note, or anticipated): no reason to stop.
		if (recent.length >= MATCH_FRAMES && recent.every((f) => frameMatches(f, chord.pitches))) {
			plan()
			return
		}
		waitChord = chord
		waiting.value = true
		run.reset()
		c.pause()
		c.holdChord?.(heldNotes(synthNotes(), myChannels(), now))
	}

	function onFrames(frames) {
		for (const frame of frames) {
			recent.push(frame)
			if (recent.length > MATCH_FRAMES) {
				recent.shift()
			}
			if (waiting.value && waitChord && run.push(frameMatches(frame, waitChord.pitches))) {
				resume()
				return
			}
		}
	}

	async function resume() {
		const c = clock()
		waiting.value = false
		waitChord = null
		// play() releases the held chord before the sequencer strikes the
		// paused notes again (player.js); the 'wake' it sends plans the next stop.
		await c?.play()
	}

	// Everything that moves the time ends up here: play, pause, seek, tempo.
	function onWake() {
		const c = clock()
		if (waiting.value && c?.isPlaying()) {
			// Played on by hand while waiting: the note was skipped.
			waiting.value = false
			waitChord = null
		}
		plan()
	}

	// A seek or loop jump: what was waited for before no longer counts, and
	// a wait in progress ends - whoever navigates is not singing that note.
	function onSeeked() {
		doneOnMs = null
		if (waiting.value) {
			clock()?.releaseChord?.()
			waiting.value = false
			waitChord = null
		}
		plan()
	}

	watch(clock, (neu, alt) => {
		alt?.removeEventListener?.('wake', onWake)
		alt?.removeEventListener?.('seeked', onSeeked)
		neu?.addEventListener?.('wake', onWake)
		neu?.addEventListener?.('seeked', onSeeked)
		if (alt && neu !== alt) {
			stop()
		}
	}, { immediate: true })

	async function start() {
		if (active.value) {
			return
		}
		if (!myChannels()) {
			needPart.value = true
			return
		}
		needPart.value = false
		active.value = true
		doneOnMs = null
		recent = []
		setMineMuted(true)
		unsubscribeFrames = intonation.onFrames(onFrames)
		if (!intonation.live.value) {
			startedLive = true
			await intonation.startLive()
			// Refused or switched off meanwhile: the panel shows the
			// microphone's message, and there is nothing to listen with.
			if (!intonation.live.value) {
				stop()
				return
			}
		}
		plan()
	}

	function stop() {
		if (!active.value) {
			return
		}
		active.value = false
		clearTimer()
		planned = null
		if (waiting.value) {
			clock()?.releaseChord?.()
			waiting.value = false
			waitChord = null
		}
		unsubscribeFrames?.()
		unsubscribeFrames = null
		setMineMuted(false)
		if (startedLive) {
			startedLive = false
			intonation.stopLive()
		}
	}

	function toggle() {
		if (active.value) {
			stop()
		} else {
			start()
		}
	}

	// The microphone switched off from elsewhere (the red dot, a hidden page):
	// without ears, waiting would never end.
	watch(() => intonation.live.value, (on, was) => {
		if (!on && was && active.value) {
			stop()
		}
	})

	function reset() {
		stop()
		needPart.value = false
	}

	if (getCurrentScope()) {
		onScopeDispose(reset)
	}

	return { active, waiting, needPart, start, stop, toggle, reset }
}
