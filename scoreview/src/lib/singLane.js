// Geometry of the singing lane (SingLane.vue): which stretch of the score it
// shows, how high a pitch stands, where the sung line runs - pure, no DOM and
// no canvas, so the drawing component only paints what this decides.
//
// **Time runs right to left, "now" a third in.** More of what comes than of
// what went: what to sing next is what the eye looks for, what was sung
// already has its colour and its word.
//
// **The sung line is folded onto the target's octave**, as intonation.js
// judges it: a tenor singing the alto an octave down sings it right, and a
// line an octave below the bars would say otherwise.

import { centsOff, formatCents } from './intonation.js'
import { activeSyllable, occurrences, versesByElid } from './lyricsLayout.js'
import { CLARITY_THRESHOLD } from './pitchDetect.js'

/** Real ms shown behind and ahead of now. */
export const LANE_PAST_MS = 2000
export const LANE_FUTURE_MS = 4000
/** Where "now" stands, as a share of the width from the left. */
export const NOW_AT = LANE_PAST_MS / (LANE_PAST_MS + LANE_FUTURE_MS)

/** Fewer semitones than this would make every step look like a leap. */
const MIN_SPAN = 7

/**
 * @param {number} nowMs score time
 * @param {number} tempoFactor score ms per real ms
 * @return {{fromMs:number, toMs:number, nowMs:number}}
 */
export function laneWindow(nowMs, tempoFactor) {
	return { fromMs: nowMs - LANE_PAST_MS * tempoFactor, toMs: nowMs + LANE_FUTURE_MS * tempoFactor, nowMs }
}

/**
 * The pitch axis: my notes with a semitone to spare, at least MIN_SPAN wide.
 *
 * @param {Array<{pitch:number}>} notes
 * @return {{low:number, high:number}}
 */
export function pitchRange(notes) {
	if (!notes || notes.length === 0) {
		return { low: 57, high: 69 }
	}
	let low = Infinity
	let high = -Infinity
	for (const n of notes) {
		low = Math.min(low, n.pitch)
		high = Math.max(high, n.pitch)
	}
	low -= 1
	high += 1
	const missing = MIN_SPAN - (high - low)
	if (missing > 0) {
		low -= Math.floor(missing / 2)
		high += Math.ceil(missing / 2)
	}
	return { low, high }
}

/**
 * @param {number} scoreMs
 * @param {{fromMs:number, toMs:number}} win
 * @param {number} width
 * @return {number}
 */
export function xOf(scoreMs, win, width) {
	return ((scoreMs - win.fromMs) / (win.toMs - win.fromMs)) * width
}

/**
 * Centre of a semitone row; high pitches stand at the top.
 *
 * @param {number} pitch fractional MIDI pitch
 * @param {{low:number, high:number}} range
 * @param {number} height
 * @return {number}
 */
export function yOf(pitch, range, height) {
	const rows = range.high - range.low + 1
	return ((range.high - pitch + 0.5) / rows) * height
}

/**
 * The sung pitch as a fractional MIDI pitch in the octave around `refPitch`.
 *
 * @param {{hz:?number, clarity:number}} frame
 * @param {number} refPitch the target, or the last pitch sung
 * @return {?number}
 */
export function sungPitch(frame, refPitch) {
	if (!frame?.hz || frame.clarity < CLARITY_THRESHOLD) {
		return null
	}
	const cents = centsOff(frame.hz, refPitch)
	const folded = cents - 1200 * Math.round(cents / 1200)
	return refPitch + folded / 100
}

/**
 * The word under a judged note, with the viewer's `t` (the strings are
 * extracted from here).
 *
 * @param {{kind:string, value:?number}} label from singScore.js
 * @param {function(string, object=): string} t
 * @return {string}
 */
export function labelText(label, t) {
	switch (label.kind) {
		case 'perfect': return t('Perfect')
		case 'low': return t('low {cents} ct', { cents: formatCents(label.value) })
		case 'high': return t('high {cents} ct', { cents: formatCents(label.value) })
		case 'early': return t('early')
		case 'late': return t('late')
		case 'short': return t('too short')
		case 'notHeard': return t('not heard')
		default: return ''
	}
}

/** The last index laneSyllables built, by the identity of its inputs. */
let memo = null

/**
 * The syllables to write under the lane: each timing event in the window
 * that sings one (lyricsLayout.js decides which verse a repeat sings).
 *
 * Called on every frame of the stage view with the same lyrics and
 * timeline, so the index behind it (syllableIndex) is built once per input
 * and kept; a frame then costs a binary search and the syllables in view.
 *
 * @param {object} input
 * @param {Array} input.blocks buildLyrics().blocks
 * @param {Array<{elid:number}>} input.events timing events, unrolled
 * @param {number[]} input.times their score times
 * @param {number} input.fromMs
 * @param {number} input.toMs
 * @return {Array<{scoreMs:number, text:string}>}
 */
export function laneSyllables({ blocks, events, times, fromMs, toMs }) {
	if (!blocks || blocks.length === 0 || !events || !times) {
		return []
	}
	if (memo === null || memo.blocks !== blocks || memo.events !== events || memo.times !== times) {
		memo = { blocks, events, times, index: syllableIndex(blocks, events, times) }
	}
	return syllablesIn(memo.index, fromMs, toMs)
}

/**
 * Every sung syllable of the timeline, in score order.
 *
 * @param {Array} blocks buildLyrics().blocks
 * @param {Array<{elid:number}>} events timing events, unrolled
 * @param {number[]} times their score times
 * @return {{entries: Array<{scoreMs:number, text:string}>, sorted: boolean}}
 */
export function syllableIndex(blocks, events, times) {
	const text = new Map()
	for (const b of blocks ?? []) {
		for (const v of b.verses) {
			for (const w of v.words) {
				for (const s of w.syllables) {
					text.set(s.id, s.joinNext ? `${s.text}-` : s.text)
				}
			}
		}
	}
	const index = { syllableVerses: versesByElid(blocks ?? []), events, occ: occurrences(events) }
	const entries = []
	let sorted = true
	for (let i = 0; i < (events?.length ?? 0); i++) {
		const id = activeSyllable(index, i)
		if (id !== null && text.has(id)) {
			if (entries.length > 0 && times[i] < entries[entries.length - 1].scoreMs) {
				sorted = false
			}
			entries.push({ scoreMs: times[i], text: text.get(id) })
		}
	}
	return { entries, sorted }
}

/**
 * The syllables of a syllableIndex() inside [fromMs, toMs].
 *
 * @param {{entries: Array<{scoreMs:number, text:string}>, sorted: boolean}} index
 * @param {number} fromMs
 * @param {number} toMs
 * @return {Array<{scoreMs:number, text:string}>}
 */
export function syllablesIn({ entries, sorted }, fromMs, toMs) {
	if (!sorted) {
		// Times that run backwards are not a timeline this app writes; read
		// them all rather than miss one.
		return entries.filter((e) => e.scoreMs >= fromMs && e.scoreMs <= toMs)
	}
	const out = []
	for (let i = lowerBound(entries, fromMs, (e) => e.scoreMs); i < entries.length && entries[i].scoreMs <= toMs; i++) {
		out.push(entries[i])
	}
	return out
}

/**
 * Where the lane's target bars start to matter: the first note, in onset
 * order, that can still reach into the window. A note's end is not sorted
 * with its onset, so the search goes back by the longest note.
 *
 * @param {Array<{onMs:number}>} sortedNotes by onMs
 * @param {number} fromMs
 * @param {number} longestMs the longest offMs - onMs among them
 * @return {number} index into sortedNotes
 */
export function firstNoteFrom(sortedNotes, fromMs, longestMs) {
	return lowerBound(sortedNotes, fromMs - longestMs, (n) => n.onMs)
}

/**
 * @param {Array} list ascending by key
 * @param {number} value
 * @param {function(object): number} key
 * @return {number} the first index whose key is >= value
 */
function lowerBound(list, value, key) {
	let lo = 0
	let hi = list.length
	while (lo < hi) {
		const mid = (lo + hi) >>> 1
		if (key(list[mid]) < value) {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	return lo
}
