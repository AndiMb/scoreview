// Wait mode (C2): playback stops before each note of my part until that note
// is sung - for learning notes, not rhythm. Pure, no DOM, no AudioContext;
// the timer, the player and the microphone live in useWaitMode.js.
//
// **Stopped before the onset, not at it.** The pause comes WAIT_LEAD_MS
// ahead of the note, so the accompaniment's note-ons at that moment have not
// sounded yet and start together with the singer once the note is found.
//
// **Octaves fold, as in intonation.** A tenor singing the alto part an octave
// lower has found the note.

import { centsOff, foldOctave } from './intonation.js'
import { CLARITY_THRESHOLD } from './pitchDetect.js'

/** Real ms before the onset at which playback stops. */
export const WAIT_LEAD_MS = 30
/** Shorter notes are passed over (F-C2.3): nobody learns a grace note by waiting for it. */
export const MIN_WAIT_NOTE_MS = 200
/** How close the sung pitch must be, folded onto the target's octave. */
export const MATCH_CENTS = 50
/** Frames in a row on the note before playback goes on (60 ms). */
export const MATCH_FRAMES = 3
/** Notes starting closer together than this are one chord (as in intonation.js). */
const CHORD_MS = 5

/**
 * The notes of my part to wait for, as chords: notes starting together, with
 * every pitch of the chord - in a divisi either note counts.
 *
 * @param {Array<{onMs:number, offMs:number, pitch:number, channel:number}>} notes sounding pitches
 * @param {?Iterable<number>} myChannels
 * @param {number} [tempoFactor] score ms per real ms
 * @return {Array<{onMs:number, pitches:Array<number>}>} sorted by onset
 */
export function waitableChords(notes, myChannels, tempoFactor = 1) {
	const channels = new Set(myChannels ?? [])
	const mine = (notes ?? []).filter((n) => channels.has(n.channel)).sort((a, b) => a.onMs - b.onMs)
	const chords = []
	for (const n of mine) {
		const last = chords[chords.length - 1]
		if (last && n.onMs - last.onMs < CHORD_MS) {
			if (!last.pitches.includes(n.pitch)) {
				last.pitches.push(n.pitch)
			}
			last.offMs = Math.max(last.offMs, n.offMs)
		} else {
			chords.push({ onMs: n.onMs, offMs: n.offMs, pitches: [n.pitch] })
		}
	}
	return chords
		.filter((c) => (c.offMs - c.onMs) / tempoFactor >= MIN_WAIT_NOTE_MS)
		.map(({ onMs, pitches }) => ({ onMs, pitches }))
}

/**
 * The next chord to stop for, seen from `scoreMs`: the first whose stopping
 * point still lies ahead and that has not been waited for already.
 *
 * @param {Array<{onMs:number}>} chords from waitableChords()
 * @param {number} scoreMs current position
 * @param {number} leadScoreMs WAIT_LEAD_MS in score time
 * @param {?number} [doneOnMs] onset of the chord just waited for - never twice in a row
 * @return {?{onMs:number, pitches:Array<number>}}
 */
export function nextWait(chords, scoreMs, leadScoreMs, doneOnMs = null) {
	let lo = 0
	let hi = chords.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (chords[mid].onMs - leadScoreMs <= scoreMs) {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	for (let i = lo; i < chords.length; i++) {
		if (doneOnMs === null || chords[i].onMs > doneOnMs + CHORD_MS) {
			return chords[i]
		}
	}
	return null
}

/**
 * Real ms until playback has to stop for `chord`.
 *
 * @param {number} scoreMs
 * @param {{onMs:number}} chord
 * @param {number} tempoFactor
 * @return {number} never negative
 */
export function msUntilStop(scoreMs, chord, tempoFactor) {
	const factor = tempoFactor > 0 ? tempoFactor : 1
	return Math.max(0, (chord.onMs - WAIT_LEAD_MS * factor - scoreMs) / factor)
}

/**
 * Whether a frame is the sung note: voiced, and within MATCH_CENTS of any
 * pitch of the chord, octaves folded.
 *
 * @param {{hz:?number, clarity:number}} frame
 * @param {Array<number>} pitches
 * @param {number} [clarityThreshold]
 * @return {boolean}
 */
export function frameMatches(frame, pitches, clarityThreshold = CLARITY_THRESHOLD) {
	if (!frame?.hz || frame.clarity < clarityThreshold) {
		return false
	}
	return pitches.some((p) => Math.abs(foldOctave(centsOff(frame.hz, p))) <= MATCH_CENTS)
}

/**
 * Counts frames in a row on the note.
 *
 * @param {number} [needed]
 * @return {{push: function(boolean): boolean, reset: function(): void}} push() is true once enough matched in a row
 */
export function createMatchRun(needed = MATCH_FRAMES) {
	let run = 0
	return {
		push(matches) {
			run = matches ? run + 1 : 0
			return run >= needed
		},
		reset() {
			run = 0
		},
	}
}

/**
 * The accompaniment that sounds at `scoreMs` - held while waiting, so the
 * note is searched for against its harmony instead of in silence. Without my
 * own channels: they are muted in wait mode, and holding them would sing the
 * answer.
 *
 * @param {Array<{onMs:number, offMs:number, pitch:number, channel:number, velocity?:number}>} notes as the synthesizer plays them (untransposed)
 * @param {?Iterable<number>} myChannels
 * @param {number} scoreMs
 * @return {Array<{channel:number, pitch:number, velocity:number}>}
 */
export function heldNotes(notes, myChannels, scoreMs) {
	const mine = new Set(myChannels ?? [])
	const seen = new Set()
	const held = []
	for (const n of notes ?? []) {
		if (mine.has(n.channel) || n.onMs > scoreMs || n.offMs <= scoreMs) {
			continue
		}
		const key = `${n.channel}:${n.pitch}`
		if (!seen.has(key)) {
			seen.add(key)
			held.push({ channel: n.channel, pitch: n.pitch, velocity: n.velocity ?? 80 })
		}
	}
	return held
}
