import { findMeasureStartTime } from './scoreLayout.js'

// The loop as one numeric value (useLoop.js). The bar's fields hold what
// the user is typing - '' while a field is empty, a string from some
// inputs - and every reader used to convert on its own; one of them
// computed `to + 1` on a string ('5' + 1 = '51'). This resolves the
// fields once, into the same record playback, markers, loop focus, export
// and the singing lane all read.

/**
 * @typedef {object} LoopRange
 * @property {number} from first measure, 1-based
 * @property {number} to last measure, 1-based, still played in full
 * @property {number} startMs score time of the first measure's start
 * @property {number} endMs score time where playback jumps back
 */

/**
 * Turn the two measure fields into a loop range, or null when they do not
 * describe one yet (empty, not a number, backwards, or a measure the score
 * does not have).
 *
 * @param {?object} measures measures.json
 * @param {number|string} from the "from" field
 * @param {number|string} to the "to" field
 * @param {number} durationMs end of the piece - the loop end when `to` is the last measure
 * @return {?LoopRange}
 */
export function resolveLoopRange(measures, from, to, durationMs) {
	// Number('') is 0, so an empty field fails the >= 1 test like garbage does.
	const fromN = Number(from)
	const toN = Number(to)
	if (!measures || !Number.isInteger(fromN) || !Number.isInteger(toN) || fromN < 1 || toN < fromN) {
		return null
	}
	const startMs = findMeasureStartTime(measures, fromN)
	if (startMs === null) {
		return null
	}
	// The end is the start of the measure AFTER "to", so that measure is
	// still played in full; past the last measure the piece's end counts.
	const endMs = findMeasureStartTime(measures, toN + 1) ?? durationMs
	return { from: fromN, to: toN, startMs, endMs }
}
