// Stepping through the score note by note (Shift+arrow, issue #34). Pure:
// the viewer seeks to the result and sounds its pitches, nothing here knows
// a clock or a synth.
//
// The steps come from the MIDI, not from the picture: its notes carry the
// played form (repeats unrolled, M7), sounding times on the same clock the
// player seeks on, and the channels that tell a part - the same source the
// start tone reads (startTone.js).

/** General MIDI's drum channel: its pitches choose an instrument, not a note. */
const DRUM_CHANNEL = 9

/**
 * Notes closer than this count as one onset. Measured for the start tone:
 * after a seek the sequencer's clock stands a fraction of a millisecond
 * before the event (52315.9 instead of 52316) - without the margin, "next"
 * would land on the note it already stands on.
 */
export const ONSET_TOLERANCE_MS = 5

/**
 * At most this many pitches sound at a step. A full orchestral texture
 * struck at once on one piano channel is a cluster, not a chord; the outer
 * voices carry what one listens for.
 */
export const MAX_STEP_PITCHES = 8

/**
 * The next or previous onset from a position, and what starts there.
 *
 * "Previous" is the latest onset strictly before the position, so a step
 * back from the middle of a note lands on that note's start - as "back" does
 * in a player - and a second step goes on from there.
 *
 * @param {?Array<{onMs:number, pitch:number, channel:number}>} notes from midiNotes.parseMidiNotes
 * @param {object} p
 * @param {number} p.fromMs the position now
 * @param {1|-1} p.direction
 * @param {?number[]} p.channels my part's channels; null or empty = every
 *   channel except the drums
 * @return {?{timeMs:number, pitches:number[]}} null at either end, or
 *   without notes in scope
 */
export function stepTarget(notes, { fromMs, direction, channels = null }) {
	const inScope = channels && channels.length > 0
		? (note) => channels.includes(note.channel)
		: (note) => note.channel !== DRUM_CHANNEL
	let target = null
	for (const note of notes ?? []) {
		if (!inScope(note)) {
			continue
		}
		if (direction > 0) {
			if (note.onMs > fromMs + ONSET_TOLERANCE_MS && (target === null || note.onMs < target)) {
				target = note.onMs
			}
		} else if (note.onMs < fromMs - ONSET_TOLERANCE_MS && (target === null || note.onMs > target)) {
			target = note.onMs
		}
	}
	if (target === null) {
		return null
	}
	const pitches = new Set()
	for (const note of notes) {
		if (inScope(note) && Math.abs(note.onMs - target) <= ONSET_TOLERANCE_MS) {
			pitches.add(note.pitch)
		}
	}
	return { timeMs: target, pitches: outerPitches([...pitches].sort((a, b) => a - b)) }
}

/**
 * Thin a sorted chord to MAX_STEP_PITCHES, taking from both ends inwards.
 *
 * @param {number[]} sorted ascending, distinct
 * @return {number[]} ascending
 */
function outerPitches(sorted) {
	if (sorted.length <= MAX_STEP_PITCHES) {
		return sorted
	}
	const low = sorted.slice(0, Math.ceil(MAX_STEP_PITCHES / 2))
	const high = sorted.slice(sorted.length - Math.floor(MAX_STEP_PITCHES / 2))
	return [...low, ...high]
}
