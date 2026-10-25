// The tuner (B3): from a detected frequency to the nearest note, its octave
// and the deviation in cents, plus the spelling the score's key suggests.
// Pure, no DOM, no AudioContext - the frames come from lib/pitchDetect.js
// through useTuner.js, the names from lib/noteNames.js.
//
// Unlike the intonation check (lib/intonation.js) the tuner has no target
// note: it folds to the nearest note, never to an octave, because a tuner
// is expected to show which octave is sounding.
//
// The tuner folds against the user's reference directly (nearest(hz, a4),
// useTuner.js) instead of scaling the frames like the intonation check: it
// shows the frequency it measured (lib/referencePitch.js).

import { A4_HZ } from './intonation.js'
import { CLARITY_THRESHOLD } from './pitchDetect.js'

/**
 * Nearest equal-tempered note to a frequency.
 *
 * @param {?number} hz
 * @param {number} [a4]
 * @return {?{midi: number, cents: number}} cents in -50 … +50, or null without a usable frequency
 */
export function nearest(hz, a4 = A4_HZ) {
	if (!Number.isFinite(hz) || hz <= 0 || !Number.isFinite(a4) || a4 <= 0) {
		return null
	}
	const exact = 69 + 12 * Math.log2(hz / a4)
	const midi = Math.round(exact)
	return { midi, cents: (exact - midi) * 100 }
}

/**
 * Scientific octave number of a MIDI pitch (69 = a' = A4).
 *
 * @param {number} midi
 * @return {number}
 */
export function octaveOf(midi) {
	return Math.floor(midi / 12) - 1
}

/**
 * One steady frequency from the last frames: the median of the voiced
 * frames inside the window, measured back from the newest frame. The median
 * holds the needle still through vibrato and a single misread frame, where a
 * mean would wander with them. Frames below the clarity threshold - breath,
 * silence, two voices at once - do not count; with none left the tuner shows
 * nothing rather than a guess.
 *
 * @param {Array<{contextTimeSec?: number, timeSec?: number, hz: ?number, clarity: number}>} frames oldest first
 * @param {number} windowMs
 * @param {number} [clarityThreshold]
 * @return {?number} Hz
 */
export function smooth(frames, windowMs, clarityThreshold = CLARITY_THRESHOLD) {
	if (!frames || frames.length === 0) {
		return null
	}
	const timeOf = (f) => f.contextTimeSec ?? f.timeSec ?? 0
	const since = timeOf(frames[frames.length - 1]) - windowMs / 1000
	const voiced = []
	for (let i = frames.length - 1; i >= 0 && timeOf(frames[i]) >= since; i--) {
		const f = frames[i]
		if (f.hz > 0 && f.clarity >= clarityThreshold) {
			voiced.push(f.hz)
		}
	}
	if (voiced.length === 0) {
		return null
	}
	voiced.sort((a, b) => a - b)
	const mid = Math.floor(voiced.length / 2)
	return voiced.length % 2 ? voiced[mid] : (voiced[mid - 1] + voiced[mid]) / 2
}

/**
 * The tonal pitch class (MuseScore's tpc, 14 = C) a pitch would be written
 * with in a key - for lib/noteNames.js, which names a tpc, not a pitch.
 *
 * A pitch class has several spellings (F♯/G♭); the one chosen is the nearest
 * to the key on the circle of fifths, inside a window of twelve steps from
 * four below the tonic to seven above. That is the spelling MuseScore itself
 * picks for a pitch entered without accidental, so the tuner names a tone
 * the way the score would print it: in C major C♯ E♭ F♯ A♭ B♭, in G major
 * F♯ and B♭, in F major B♭ and C♯ - sharps where a key leads upwards, flats
 * where it bends downwards.
 *
 * @param {number} midi
 * @param {?number} [concertKey] -7 … 7, null = C major
 * @return {number} tpc
 */
export function tpcForPitch(midi, concertKey = 0) {
	const key = Number.isFinite(concertKey) ? concertKey : 0
	const pc = ((midi % 12) + 12) % 12
	// Steps from C on the circle of fifths that reach this pitch class; 7 is
	// its own inverse mod 12, so pc * 7 undoes "7 semitones per fifth".
	const k0 = (pc * 7) % 12
	const low = key - 4
	const k = k0 + 12 * Math.ceil((low - k0) / 12)
	return 14 + k
}
