import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { translate } from '../l10n.js'
import { LANE_PAST_MS } from '../lib/singLane.js'
import {
	DEFAULT_SING_LEVEL,
	isContinuous,
	levelWindow,
	practiceSpots,
	readyAtMs,
	scoreChord,
	SETTLE_MS,
	SING_LEVELS,
	summarizeRun,
	unitChords,
	unitNotes,
} from '../lib/singScore.js'

const t = (text, vars) => translate('scoreview', text, vars)

/**
 * Frames kept before the oldest chord still to judge: the onset is searched
 * up to 250 ms before a note and traced back up to 200 ms more (rhythm.js),
 * real ms.
 */
const KEEP_BEFORE_MS = 600

/**
 * A run counts as sung to its end once the time reached this close to the
 * end of the unit, real ms: a loop wraps at the end of its last measure, and
 * the end of the last note is judged with what was heard until then.
 */
const END_SLACK_MS = 300

/**
 * Scored singing (docs/architecture.md E24): runs of one's own part, note by
 * note as they are sung, and the summary of each run that was sung through.
 *
 * **Frames** come from the live intonation (useIntonation.onScoreFrames) -
 * the same microphone, the same worker, no second analysis. Every chord of
 * my part is judged once it is over (lib/singScore.js), with the functions
 * that judge a recording.
 *
 * **A run** starts with the first frames after play and lasts to the end of
 * the unit: the whole piece, or the active loop. It is scored only if it
 * missed nothing of my part, was not sought in, kept its tempo and did not
 * wait (wait mode stops the music for the singer; onsets and lengths mean
 * nothing there). Anything else stays on the lane as "without score", and
 * nothing is stored. A pause before the end drops the run.
 *
 * **Stored** is only the summary (SingRunController); the spots to practise
 * stay in the browser.
 *
 * @param {object} deps
 * @param {() => number|string|null} deps.fileId
 * @param {() => boolean} deps.enabled switches, and online
 * @param {object} deps.intonation useIntonation(): live, needPart, startLive, stopLive, onScoreFrames
 * @param {() => Array<object>} deps.notes
 * @param {() => ?Iterable<number>} deps.myChannels
 * @param {function(number): ?number} deps.measureOf
 * @param {() => ?{from:number, to:number, startMs:number, endMs:number}} deps.loopRange the active loop
 * @param {() => number} deps.durationMs
 * @param {() => boolean} deps.isPlaying must be reactive - a stop ends or drops the run
 * @param {() => ?number} [deps.positionMs] where playback stands, score ms - decides
 *        whether a stop is the end of the unit (the microphone's frames lag behind)
 * @param {() => boolean} deps.waitModeActive
 * @param {() => number} [deps.now] real ms
 * @return {object}
 */
export function useSingScore({ fileId, enabled, intonation, notes, myChannels, measureOf, loopRange, durationMs, isPlaying, positionMs = () => null, waitModeActive, now = () => performance.now() }) {
	const active = ref(false)
	const level = ref(DEFAULT_SING_LEVEL)
	/** {state: 'scoring'|'liveOnly', unit, chords, tempoFactor} or null */
	const run = shallowRef(null)
	/** Judged chords of the current run, by onset - for the lane. */
	const results = shallowRef(new Map())
	/** The last run sung to its end. */
	const lastRun = shallowRef(null)
	const history = shallowRef([])
	const best = shallowRef({})
	const error = ref('')

	let unsubscribe = null
	let startedLive = false
	let frames = []
	let levelPoints = []
	let laneFrames = []
	let next = 0
	// After a run ended, the music plays on to the end of the piece or the
	// loop: no new run before it starts again (play, a loop's wrap, a seek).
	let done = false
	let lastScoreMs = null
	let lastAt = 0
	let generation = 0

	const url = () => generateUrl('/apps/scoreview/api/scores/{fileId}/sing-runs', { fileId: fileId() })

	const livePct = computed(() => summarizeRun([...results.value.values()]).totalPct)

	function currentUnit() {
		const loop = loopRange()
		if (loop && Number.isFinite(loop.startMs) && Number.isFinite(loop.endMs)) {
			return { from: loop.from, to: loop.to, startMs: loop.startMs, endMs: loop.endMs }
		}
		return { from: null, to: null, startMs: 0, endMs: durationMs() }
	}

	function unitParams(unit) {
		const params = { level: level.value }
		if (unit.from !== null && unit.to !== null) {
			params.from = unit.from
			params.to = unit.to
		}
		return params
	}

	async function loadHistory(unit = currentUnit()) {
		const mine = ++generation
		if (!enabled() || fileId() === null || fileId() === undefined) {
			return
		}
		try {
			const res = await axios.get(url(), { params: unitParams(unit) })
			if (mine !== generation) {
				return
			}
			history.value = res.data.runs ?? []
			best.value = Array.isArray(res.data.best) ? {} : { ...res.data.best }
		} catch (err) {
			// A side feature: its failure must not touch the score.
			// eslint-disable-next-line no-console
			console.error('ScoreView: could not load the singing results.', err)
		}
	}

	async function start() {
		if (active.value || !enabled()) {
			return
		}
		error.value = ''
		active.value = true
		unsubscribe = intonation.onScoreFrames(onBatch)
		if (!intonation.live.value) {
			startedLive = true
			await intonation.startLive()
			if (!intonation.live.value) {
				// No part chosen, or no microphone: the intonation says why.
				stop()
				return
			}
		}
		loadHistory()
	}

	function stop() {
		active.value = false
		unsubscribe?.()
		unsubscribe = null
		dropRun()
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

	function setLevel(value) {
		if (!SING_LEVELS.includes(value) || value === level.value) {
			return
		}
		level.value = value
		// A run sung at one level is not scored at another.
		dropRun()
		loadHistory()
	}

	function dropRun() {
		run.value = null
		done = false
		frames = []
		levelPoints = []
		next = 0
		lastScoreMs = null
	}

	function beginRun(startMs, tempoFactor) {
		const unit = currentUnit()
		const chords = unitChords(unitNotes(notes(), myChannels(), unit.startMs, unit.endMs))
		// Nothing of my part may be missed - started in the middle, the
		// first notes would count as silence. Nothing is analysed before
		// playback runs, so the first frame comes a little after a note right
		// at the start; that is still the start.
		const fromTheStart = chords.length > 0 && startMs <= chords[0][0].onMs + SETTLE_MS * tempoFactor
		run.value = {
			state: fromTheStart && !waitModeActive() ? 'scoring' : 'liveOnly',
			unit,
			chords,
			tempoFactor,
		}
		results.value = new Map()
		frames = []
		levelPoints = []
		next = 0
		done = false
	}

	/**
	 * Play again after the end: the first batch still carries the time of
	 * the end (dated back by the analysis, so just before it); the clock goes
	 * back to the start only after it. A run begun after the onset of my last
	 * note has nothing left to judge, and finishing it would replace the
	 * result just sung.
	 *
	 * @param {number} scoreMs
	 * @return {boolean}
	 */
	function afterMyLastOnset(scoreMs) {
		const unit = currentUnit()
		const mine = unitNotes(notes(), myChannels(), unit.startMs, unit.endMs)
		return mine.length > 0 && scoreMs > Math.max(...mine.map((n) => n.onMs))
	}

	function markLiveOnly() {
		if (run.value && run.value.state !== 'liveOnly') {
			run.value = { ...run.value, state: 'liveOnly' }
		}
	}

	/**
	 * Whether the run reached the end of its unit - also when the last note
	 * could not be waited for (a loop wraps, the piece ends).
	 */
	function reachedEnd() {
		const r = run.value
		if (!r || lastScoreMs === null || r.chords.length === 0) {
			return false
		}
		const lastChord = r.chords[r.chords.length - 1]
		const lastOff = Math.max(...lastChord.map((n) => n.offMs))
		return lastScoreMs >= Math.min(lastOff, r.unit.endMs - END_SLACK_MS * r.tempoFactor)
	}

	function onBatch(batch) {
		if (!active.value) {
			return
		}
		const first = batch.frames[0] ?? batch.level[0]
		if (!first || (run.value === null && afterMyLastOnset(first.scoreMs))) {
			return
		}
		const at = now()
		if (done) {
			const jumped = lastScoreMs !== null && !isContinuous(lastScoreMs, first.scoreMs, at - lastAt, batch.tempoFactor)
			if (!jumped) {
				followTime(batch, at)
				return
			}
			done = false
			lastScoreMs = null
			laneFrames = []
		}
		if (run.value === null) {
			beginRun(first.scoreMs, batch.tempoFactor)
		} else if (lastScoreMs !== null && !isContinuous(lastScoreMs, first.scoreMs, at - lastAt, batch.tempoFactor)) {
			const wrapped = first.scoreMs < lastScoreMs && Math.abs(first.scoreMs - run.value.unit.startMs) <= SETTLE_MS * batch.tempoFactor * 4
			if (wrapped && reachedEnd()) {
				finish()
				beginRun(first.scoreMs, batch.tempoFactor)
			} else if (wrapped) {
				// Back to the start before the end: a new try.
				beginRun(first.scoreMs, batch.tempoFactor)
			} else {
				markLiveOnly()
			}
			laneFrames = []
		}
		if (batch.tempoFactor !== run.value.tempoFactor || waitModeActive()) {
			markLiveOnly()
		}
		frames.push(...batch.frames)
		levelPoints.push(...batch.level)
		followTime(batch, at)
		judgeReady(false)
		if (run.value && next >= run.value.chords.length && run.value.chords.length > 0) {
			finish()
		}
	}

	/**
	 * Keep the time and the line of the lane going.
	 *
	 * @param {object} batch
	 * @param {number} at real ms
	 */
	function followTime(batch, at) {
		laneFrames.push(...batch.frames)
		const last = batch.frames[batch.frames.length - 1] ?? batch.level[batch.level.length - 1]
		lastScoreMs = last.scoreMs
		lastAt = at
		const laneFrom = lastScoreMs - (LANE_PAST_MS + 500) * batch.tempoFactor
		if (laneFrames.length > 0 && laneFrames[0].scoreMs < laneFrom) {
			laneFrames = laneFrames.filter((f) => f.scoreMs >= laneFrom)
		}
	}

	/**
	 * Judge the chords that are over. `all`: also those that could not be
	 * waited for - at the end of a run, with what was heard.
	 *
	 * @param {boolean} all
	 */
	function judgeReady(all) {
		const r = run.value
		if (!r || lastScoreMs === null) {
			return
		}
		const ctx = { notes: notes(), myChannels: myChannels(), tempoFactor: r.tempoFactor, level: level.value }
		let changed = false
		while (next < r.chords.length) {
			const chord = r.chords[next]
			const ready = Math.max(...chord.map((n) => readyAtMs(n, r.tempoFactor)))
			if (ready > lastScoreMs && !(all && chord[0].onMs < lastScoreMs)) {
				break
			}
			const onMs = chord[0].onMs
			const envelope = levelWindow(levelPoints, onMs - KEEP_BEFORE_MS * r.tempoFactor, ready, r.tempoFactor)
			const result = scoreChord(frames, chord, { ...ctx, levelEnvelope: envelope })
			if (result) {
				results.value.set(onMs, result)
				changed = true
			}
			next++
		}
		if (changed) {
			results.value = new Map(results.value)
		}
		const keepFrom = next < r.chords.length ? r.chords[next][0].onMs - KEEP_BEFORE_MS * r.tempoFactor : lastScoreMs
		if (frames.length > 0 && frames[0].scoreMs < keepFrom) {
			frames = frames.filter((f) => f.scoreMs >= keepFrom)
			levelPoints = levelPoints.filter((p) => p.scoreMs >= keepFrom)
		}
	}

	/**
	 * End the run: summarize it and, if it was scored, store it.
	 */
	function finish() {
		const r = run.value
		if (!r) {
			return
		}
		judgeReady(true)
		const list = [...results.value.values()]
		const summary = summarizeRun(list)
		const tempoPct = Math.round(r.tempoFactor * 100)
		const scored = r.state === 'scoring' && summary.notesScored > 0
		const previousBest = best.value[String(tempoPct)] ?? null
		lastRun.value = {
			summary,
			spots: practiceSpots(list, measureOf),
			unit: r.unit,
			level: level.value,
			tempoPct,
			scored,
			saved: false,
			saving: scored,
			previousBest,
			isNewBest: scored && summary.totalPct !== null && (previousBest === null || summary.totalPct > previousBest),
		}
		run.value = null
		done = true
		frames = []
		levelPoints = []
		next = 0
		if (scored) {
			save(r.unit, summary, tempoPct)
		}
	}

	async function save(unit, summary, tempoPct) {
		const shown = lastRun.value
		try {
			await axios.post(url(), {
				...unitParams(unit),
				tempoPct,
				totalPct: summary.totalPct,
				pitchPct: summary.pitchPct,
				onsetPct: summary.onsetPct,
				releasePct: summary.releasePct,
				notesScored: summary.notesScored,
			})
			if (lastRun.value === shown) {
				lastRun.value = { ...shown, saved: true, saving: false }
			}
			loadHistory(unit)
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error('ScoreView: could not save the singing result.', err)
			if (lastRun.value === shown) {
				lastRun.value = { ...shown, saving: false }
			}
		}
	}

	async function clearResults() {
		error.value = ''
		try {
			await axios.delete(url())
			history.value = []
			best.value = {}
			if (lastRun.value) {
				lastRun.value = { ...lastRun.value, previousBest: null, isNewBest: false }
			}
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error('ScoreView: could not delete the singing results.', err)
			error.value = t('The results could not be deleted.')
		}
	}

	function dismissResult() {
		lastRun.value = null
	}

	/** The sung frames of the last seconds, for the line on the lane. */
	function framesForLane() {
		return laneFrames
	}

	// Stopped before the end: the run is dropped. Stopped at the end of the
	// piece: it was sung through.
	watch(() => isPlaying(), (playing) => {
		if (playing || !run.value) {
			done = false
			lastScoreMs = null
			return
		}
		// The frames trail the clock by the analysis, so at the end of the
		// piece the last one is still inside the last note; where playback
		// stopped says whether it was the end. That note's length is then
		// not judged - nothing was heard after its end (rhythm.js).
		const at = positionMs()
		const r = run.value
		const stoppedAtEnd = at !== null && at >= r.unit.endMs - END_SLACK_MS * r.tempoFactor
		if (reachedEnd() || (stoppedAtEnd && lastScoreMs !== null)) {
			finish()
		} else {
			dropRun()
		}
		laneFrames = []
	}, { flush: 'sync' })

	// A new loop is a new unit with its own best scores.
	watch(() => {
		const u = currentUnit()
		return `${u.from}:${u.to}`
	}, () => {
		if (active.value) {
			dropRun()
			loadHistory()
		}
	})

	function reset() {
		stop()
		results.value = new Map()
		lastRun.value = null
		history.value = []
		best.value = {}
		laneFrames = []
		generation++
	}

	if (getCurrentScope()) {
		onScopeDispose(stop)
	}

	return {
		active,
		level,
		run,
		results,
		lastRun,
		history,
		best,
		error,
		livePct,
		start,
		stop,
		toggle,
		setLevel,
		clearResults,
		dismissResult,
		framesForLane,
		loadHistory,
		reset,
	}
}
