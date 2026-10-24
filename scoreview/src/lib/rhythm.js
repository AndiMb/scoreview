// Rhythm feedback from a recording: onset (early/late) and end (too short)
// per note of my part - pure, no DOM (N-C1.1). Same frames as intonation
// (lib/pitchDetect.js), same time axis (lib/recordingAlign.js); the
// evaluations it attaches to come from lib/intonation.js.
//
// **The onset is the vowel.** A frame counts once it is periodic, so a
// voiceless "s", "t" or "k" before the vowel does not count. In a choir that
// is the right reference: the vowel belongs on the beat, the consonant
// before it.
//
// **Only where an onset can be seen.** An onset is the first frame of a run
// on the target note that follows silence or a different pitch. Two notes of
// the same pitch sung legato have no such moment - that is reported as "not
// evaluable", never as a guess.
//
// **Absolute, in real time.** The deviation is measured against the score,
// not against the singer's own average (a singer who drags consistently is
// meant to see it), and in real milliseconds: 60 ms are as audible at half
// tempo as at full tempo.
//
// **No "too long".** Holding over is corrected by ear in a choir, and the end
// of a phrase is the conductor's call; only "too short" is reported.

import { centsOff, foldOctave } from './intonation.js'
import { CLARITY_THRESHOLD } from './pitchDetect.js'

/**
 * Delay of the detected onset behind the real one, in real ms. Measured with
 * synthetic tones (64 ms YIN window, 20 ms hop, run of 3 frames): after
 * silence median +12 ms (−3 … +22, +22 with a 150 ms swell), after a pitch
 * change median +27 ms (+12 … +37). The end is detected without offset.
 */
export const ONSET_BIAS_MS = { silence: 12, change: 27 }

/**
 * Lower bound for "green" at the onset: above the largest measured offset of
 * a recording against the cursor (+42 … +52 ms, docs/limits.md), so that
 * latency alone never turns a note yellow (F-C1.3).
 */
export const MIN_ONSET_TOLERANCE_MS = 55

export const DEFAULT_RHYTHM_THRESHOLDS = {
	onset: { green: 60, yellow: 120 },
	// Absolute ms or share of the note, whichever is larger: a quarter of a
	// semibreve is a breath, a quarter of a quaver is not.
	release: { green: 150, greenShare: 0.25, yellow: 300, yellowShare: 0.5 },
}

/** Frames in a row on the target note before it counts as sung (60 ms). */
const RUN_FRAMES = 3
/** How far the onset is searched before and after the note, real ms. */
const SEARCH_MS = 250
/** A target farther away than this is a different note, not an off-pitch one. */
const MATCH_CENTS = 150
/** Shorter notes are too short for a run of three frames. */
const MIN_NOTE_MS = 100
/** A gap this long before the next note leaves room to hear the end. */
const MIN_REST_MS = 100
/** Short dropouts inside a note (vibrato, a crackle) do not end it. */
const MAX_DROPOUT_FRAMES = 2
/** Notes starting closer together than this are one chord (as in intonation.js). */
const CHORD_MS = 5

/**
 * How a frame relates to the target: on it, on another pitch, or unvoiced.
 * "On it" also means closer to the target than to any pitch of the previous
 * chord - a semitone step must not count the old note as the new one.
 *
 * @param {{hz:?number, clarity:number}} frame
 * @param {number} pitch
 * @param {Array<number>} otherPitches
 * @param {number} clarityThreshold
 * @return {'match'|'other'|'silent'}
 */
export function frameState(frame, pitch, otherPitches, clarityThreshold = CLARITY_THRESHOLD) {
	if (!frame.hz || frame.clarity < clarityThreshold) {
		return 'silent'
	}
	const off = Math.abs(foldOctave(centsOff(frame.hz, pitch)))
	if (off > MATCH_CENTS) {
		return 'other'
	}
	for (const other of otherPitches) {
		if (other !== pitch && Math.abs(foldOctave(centsOff(frame.hz, other))) < off) {
			return 'other'
		}
	}
	return 'match'
}

/**
 * Three-level class for an onset deviation.
 *
 * @param {?number} devMs
 * @param {{green:number, yellow:number}} [thresholds]
 * @return {'green'|'yellow'|'red'|'na'}
 */
export function classifyOnset(devMs, thresholds = DEFAULT_RHYTHM_THRESHOLDS.onset) {
	if (devMs === null || devMs === undefined || !Number.isFinite(devMs)) {
		return 'na'
	}
	const green = Math.max(thresholds.green, MIN_ONSET_TOLERANCE_MS)
	const abs = Math.abs(devMs)
	if (abs <= green) {
		return 'green'
	}
	// Raised to the floor, green must not swallow yellow: keep the band at
	// least as wide as green itself.
	return abs <= Math.max(thresholds.yellow, 2 * green) ? 'yellow' : 'red'
}

/**
 * Three-level class for an end that came too early.
 *
 * @param {?number} shortMs real ms the note ended early (0 = held to the end)
 * @param {number} noteMs real length of the note
 * @param {object} [thresholds]
 * @return {'green'|'yellow'|'red'|'na'}
 */
export function classifyRelease(shortMs, noteMs, thresholds = DEFAULT_RHYTHM_THRESHOLDS.release) {
	if (shortMs === null || shortMs === undefined || !Number.isFinite(shortMs)) {
		return 'na'
	}
	if (shortMs <= Math.max(thresholds.green, thresholds.greenShare * noteMs)) {
		return 'green'
	}
	return shortMs <= Math.max(thresholds.yellow, thresholds.yellowShare * noteMs) ? 'yellow' : 'red'
}

/**
 * Onset of one note.
 *
 * @param {Array<{scoreMs:number, hz:?number, clarity:number}>} frames sorted by time
 * @param {{onMs:number, offMs:number, pitch:number}} note
 * @param {?{onMs:number, offMs:number, pitches:Array<number>}} prev previous chord of my part
 * @param {object} [options]
 * @param {number} [options.tempoFactor] score ms per real ms during the recording
 * @param {number} [options.clarityThreshold]
 * @param {{green:number, yellow:number}} [options.thresholds]
 * @return {?{devMs:?number, class:string, reason:?string, scoreMs:?number, index:?number}} null if the recording does not cover the search window
 */
export function findOnset(frames, note, prev, options = {}) {
	const {
		tempoFactor = 1,
		clarityThreshold = CLARITY_THRESHOLD,
		thresholds = DEFAULT_RHYTHM_THRESHOLDS.onset,
	} = options
	const na = (reason) => ({ devMs: null, class: 'na', reason, scoreMs: null, index: null })
	const noteRealMs = (note.offMs - note.onMs) / tempoFactor
	let fromMs = note.onMs - SEARCH_MS * tempoFactor
	if (prev) {
		fromMs = Math.max(fromMs, (prev.onMs + note.onMs) / 2)
	}
	const toMs = note.onMs + Math.min(SEARCH_MS * tempoFactor, (note.offMs - note.onMs) / 2)
	if (frames.length === 0 || frames[0].scoreMs > fromMs || frames[frames.length - 1].scoreMs < toMs) {
		return null
	}
	if (noteRealMs < MIN_NOTE_MS) {
		return na('short')
	}
	const others = prev ? prev.pitches : []
	const state = (f) => frameState(f, note.pitch, others, clarityThreshold)
	const first = lowerBound(frames, fromMs)
	for (let i = Math.max(1, first); i < frames.length && frames[i].scoreMs <= toMs; i++) {
		let run = true
		for (let j = 0; j < RUN_FRAMES; j++) {
			if (!frames[i + j] || state(frames[i + j]) !== 'match') {
				run = false
				break
			}
		}
		if (!run) {
			continue
		}
		const before = state(frames[i - 1])
		if (before === 'match') {
			// Already on the note when the window opens: tied from the
			// previous note of the same pitch, or anticipated by more than
			// the window - in neither case is there an onset to measure.
			break
		}
		const context = before === 'silent' ? 'silence' : 'change'
		const devMs = (frames[i].scoreMs - note.onMs) / tempoFactor - ONSET_BIAS_MS[context]
		return { devMs, class: classifyOnset(devMs, thresholds), reason: null, scoreMs: frames[i].scoreMs, index: i }
	}
	const samePitch = prev && prev.pitches.includes(note.pitch) && (note.onMs - prev.offMs) / tempoFactor < MIN_REST_MS
	return na(samePitch ? 'samePitch' : 'none')
}

/**
 * End of one note - only where a rest follows in my part, otherwise the
 * next note's onset is the end and there is nothing of its own to hear.
 *
 * @param {Array<{scoreMs:number, hz:?number, clarity:number}>} frames
 * @param {{onMs:number, offMs:number, pitch:number}} note
 * @param {?{onMs:number}} next next chord of my part
 * @param {?{index:?number}} onset result of findOnset(), to start from its run
 * @param {object} [options] as findOnset(), thresholds for release
 * @return {?{shortMs:?number, class:string}} null where it is not evaluated
 */
export function findRelease(frames, note, next, onset, options = {}) {
	const {
		tempoFactor = 1,
		clarityThreshold = CLARITY_THRESHOLD,
		thresholds = DEFAULT_RHYTHM_THRESHOLDS.release,
	} = options
	if (next && (next.onMs - note.offMs) / tempoFactor < MIN_REST_MS) {
		return null
	}
	const untilMs = note.offMs + SEARCH_MS * tempoFactor
	if (frames.length === 0 || frames[frames.length - 1].scoreMs < Math.min(untilMs, next ? next.onMs : untilMs)) {
		return null
	}
	const state = (f) => frameState(f, note.pitch, [], clarityThreshold)
	let i = onset?.index ?? lowerBound(frames, note.onMs)
	while (i < frames.length && frames[i].scoreMs < note.offMs && state(frames[i]) !== 'match') {
		i++
	}
	if (i >= frames.length || frames[i].scoreMs >= note.offMs) {
		return { shortMs: null, class: 'na' }
	}
	let lastMatch = frames[i].scoreMs
	let dropout = 0
	for (; i < frames.length && frames[i].scoreMs < untilMs; i++) {
		if (next && frames[i].scoreMs >= next.onMs) {
			break
		}
		if (state(frames[i]) === 'match') {
			lastMatch = frames[i].scoreMs
			dropout = 0
		} else if (++dropout > MAX_DROPOUT_FRAMES) {
			break
		}
	}
	const shortMs = Math.max(0, (note.offMs - lastMatch) / tempoFactor)
	return { shortMs, class: classifyRelease(shortMs, (note.offMs - note.onMs) / tempoFactor, thresholds) }
}

/**
 * Onset and end for the evaluated notes of a recording.
 *
 * @param {Array<{scoreMs:number, hz:?number, clarity:number}>} frames
 * @param {Array<{note:object}>} evaluations from evaluateRecording()
 * @param {Array<object>} notes all notes (lib/midiNotes.js)
 * @param {?Iterable<number>} myChannels
 * @param {object} [options] tempoFactor, clarityThreshold, thresholds ({onset, release})
 * @return {Array<{onset:?object, release:?object}>} in the order of `evaluations`
 */
export function evaluateRhythm(frames, evaluations, notes, myChannels, options = {}) {
	const { thresholds = DEFAULT_RHYTHM_THRESHOLDS, ...rest } = options
	const chords = chordsOf(notes, myChannels)
	return evaluations.map(({ note }) => {
		const at = chordIndex(chords, note.onMs)
		const prev = at > 0 ? chords[at - 1] : null
		const next = at >= 0 && at + 1 < chords.length ? chords[at + 1] : null
		const onset = findOnset(frames, note, prev, { ...rest, thresholds: thresholds.onset })
		const release = findRelease(frames, note, next, onset, { ...rest, thresholds: thresholds.release })
		return { onset, release }
	})
}

/**
 * Median onset deviation - "on average 35 ms late".
 *
 * @param {Array<{onset:?{devMs:?number}}>} rhythm
 * @return {?number} null without a single measured onset
 */
export function medianOnsetMs(rhythm) {
	const values = rhythm
		.map((r) => r.onset?.devMs)
		.filter((v) => Number.isFinite(v))
		.sort((a, b) => a - b)
	if (values.length === 0) {
		return null
	}
	const mid = Math.floor(values.length / 2)
	return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2
}

/**
 * My part as chords: notes starting together, with their pitches and the
 * latest end.
 *
 * @param {Array<object>} notes
 * @param {?Iterable<number>} myChannels
 * @return {Array<{onMs:number, offMs:number, pitches:Array<number>}>}
 */
function chordsOf(notes, myChannels) {
	const channels = new Set(myChannels ?? [])
	const mine = (notes ?? []).filter((n) => channels.has(n.channel)).sort((a, b) => a.onMs - b.onMs)
	const chords = []
	for (const n of mine) {
		const last = chords[chords.length - 1]
		if (last && n.onMs - last.onMs < CHORD_MS) {
			last.pitches.push(n.pitch)
			last.offMs = Math.max(last.offMs, n.offMs)
		} else {
			chords.push({ onMs: n.onMs, offMs: n.offMs, pitches: [n.pitch] })
		}
	}
	return chords
}

function chordIndex(chords, onMs) {
	let lo = 0
	let hi = chords.length - 1
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		if (chords[mid].onMs < onMs - CHORD_MS) {
			lo = mid + 1
		} else if (chords[mid].onMs > onMs + CHORD_MS) {
			hi = mid - 1
		} else {
			return mid
		}
	}
	return -1
}

function lowerBound(frames, scoreMs) {
	let lo = 0
	let hi = frames.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (frames[mid].scoreMs < scoreMs) {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	return lo
}
