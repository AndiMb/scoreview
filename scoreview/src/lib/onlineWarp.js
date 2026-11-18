// Part of the microphone score follower (automatic page turning, behind the
// switch `feature_score_follower`): the viewer runs it inside
// lib/scoreFollower.js in workers/followerWorker.js.
//
// Local following of a live performance against the score reference: an
// online alignment in a band around the current place (after Dixon,
// "Live tracking of musical performances using on-line time warping", 2005)
// - pure, no DOM, no AudioContext.
//
// Shape of the recursion: the live side advances one frame per tap (50 ms),
// the reference by 0, 1 or 2 frames - tempo 0 to 2x, which covers fermatas
// and a choir that rushes. Reference and live frames have the same spacing
// (lib/followRef.js FRAME_MS), so this is Dixon's online time warping in its
// frame-synchronous form; the score of a cell is the best path to it plus
// how well the live frame matches the reference there.
//
// Ensembles (F24): the match at a reference frame is the best over the
// ensembles that sound there - tutti, accompaniment, voices, each voice
// alone. A frame where every ensemble rests matches nothing while music is
// heard. While nothing is heard, the path runs through frames where the
// ensemble that is actually performing rests - not only general pauses:
// measured on a synthetic a-cappella case, a choir that skips the piano
// interlude left the path standing at its start (it is no rest for the
// tutti), 5 s behind and out of its band for good.
//
// No match nearby (speech, coughing, handling noise): the frame is treated
// as a pause. Without that, a path in a band of equally poor matches still
// drifts forward at the old tempo - the place would move while the
// conductor talks.

import { similarity } from './chroma.js'
import { clamp } from './numeric.js'
import { pitchClassDistance } from './voicePitch.js'

/**
 * @param {import('./followRef.js').FollowReference} reference
 * @param {object} [options]
 * @param {number} [options.bandFrames] half width of the band (±3 s)
 * @param {number} [options.stayPenalty] cost of the reference standing still
 * @param {number} [options.skipPenalty] cost of the reference moving two frames
 * @param {number} [options.restPenalty] cost of moving through a rest in a pause
 * @param {number} [options.minMatch] best similarity in the band below which a frame counts as a pause
 *   (measured on real rehearsal recordings: at the true place only 50-72 % of sung
 *   50 ms frames reach 0.8, 75-92 % reach 0.7; at 0.8 the path stood still for a
 *   third of the singing and fell behind for good)
 * @param {number} [options.tempoWindowFrames] frames of path used for the tempo
 * @param {number} [options.voiceWeight] share of the singer's own line in the match
 *   where it sings (lib/voicePitch.js; reference.voices)
 * @param {number} [options.voiceSigma] semitones off the line at which its match falls to 0.61
 * @param {number} [options.voiceSpanFrames] frames either side where the line may lie -
 *   the 170 ms window hears a note change late, and a singer is never on the frame
 * @param {number} [options.voicePrior] starting fit of "my part" (reference.voicePreferred)
 * @param {number} [options.voiceMinFit] fit a line needs before it weighs in
 * @param {number} [options.voiceMargin] lead over the next line it needs
 * @param {number} [options.voiceRate] how fast the fit follows each clear voice frame
 * @return {object}
 */
export function createOnlineWarp(reference, options = {}) {
	const {
		bandFrames = 60,
		stayPenalty = 0.1,
		skipPenalty = 0.1,
		restPenalty = 0.02,
		minMatch = 0.7,
		tempoWindowFrames = 60,
		// Own voice, measured on twelve rehearsal takes with a tap before each
		// run: bars within one bar 91 -> 97 % with "my part" right or unset,
		// 93-96 % with it wrong (the line the voice lies on wins).
		voiceWeight = 0.5,
		voiceSigma = 0.8,
		voiceSpanFrames = 2,
		voicePrior = 0.5,
		voiceMinFit = 0.4,
		voiceMargin = 0.1,
		voiceRate = 0.05,
	} = options
	const lines = voiceWeight > 0 ? (reference.voices ?? []).map((v) => v.line) : []
	// Which line the heard voice lies on, along the path (0..1 per line).
	// "My part" starts ahead, so it counts from the first note; a wrong
	// choice falls back within seconds - measured: weighting a part the
	// singer does not sing dropped bars within one bar from 91 to 60 %.
	const voiceFit = new Float64Array(lines.length)
	if (reference.voicePreferred >= 0 && reference.voicePreferred < lines.length) {
		voiceFit[reference.voicePreferred] = voicePrior
	}
	let line = null
	let voiceIndex = -1
	const n = reference.frames
	const ensembles = reference.ensembles
	let score = new Float64Array(n).fill(-Infinity)
	let next = new Float64Array(n).fill(-Infinity)
	const sims = new Float64Array(n)
	let position = null
	let lo = 0
	let hi = -1
	// Path history of matched frames, for the tempo: [live step, position].
	const history = []
	let liveStep = 0
	// How well each ensemble fits along the path - the best one is taken
	// to be the one performing (display, F3, and rests in pauses).
	const fit = new Float64Array(ensembles.length)
	let active = 0

	/**
	 * Start (again) at a reference frame - a bar entered by hand, the
	 * remembered place, the result of a search.
	 *
	 * @param {number} frame
	 * @param {number} [spread] frames of uncertainty around it
	 */
	function anchor(frame, spread = 10) {
		score.fill(-Infinity)
		// `next` is cleared only inside the band before each step and then
		// swapped in: cells of an earlier band would come back as scores
		// once the new band reaches them.
		next.fill(-Infinity)
		const centre = clamp(Math.round(frame), 0, n - 1)
		for (let j = Math.max(0, centre - spread); j <= Math.min(n - 1, centre + spread); j++) {
			score[j] = -0.01 * Math.abs(j - centre)
		}
		position = centre
		setBand(centre)
		history.length = 0
		fit.fill(0)
		active = 0
	}

	/**
	 * One tap.
	 *
	 * @param {?Float32Array} chroma 12 bins, null if the gates said "no music"
	 * @param {?object} [_onset] unused here (lib/tempoTracker.js)
	 * @param {?number} [voice] the singer's own pitch, MIDI at the score's tuning, null if unclear
	 * @return {{position: ?number, matched: boolean, similarity: number, ensemble: ?string, voice: ?string}}
	 */
	// The same arguments as lib/tempoTracker.js, which uses the onset.
	// eslint-disable-next-line no-unused-vars
	function step(chroma, _onset = null, voice = null) {
		liveStep++
		if (position === null) {
			return { position: null, matched: false, similarity: 0, ensemble: null, voice: null }
		}
		let best = 0
		line = voice === null ? null : voiceLine()
		if (chroma) {
			for (let j = lo; j <= hi; j++) {
				let s = -1
				for (let e = 0; e < ensembles.length; e++) {
					if (ensembles[e].silent[j]) {
						continue
					}
					s = Math.max(s, similarity(chroma, ensembles[e].chroma.subarray(j * 12, j * 12 + 12)))
				}
				// Where the own part sings, its line weighs in; where it
				// rests, a clear voice is someone else's and says nothing.
				if (line && s > -1 && Number.isFinite(line[j])) {
					s = (1 - voiceWeight) * s + voiceWeight * voiceMatch(voice, j)
				}
				sims[j] = s
				if (s > best) {
					best = s
				}
			}
		}
		const matched = !!chroma && best >= minMatch
		next.fill(-Infinity, lo, hi + 1)
		for (let j = lo; j <= hi; j++) {
			const stay = score[j]
			const advance = j >= 1 ? score[j - 1] : -Infinity
			const skip = j >= 2 ? score[j - 2] : -Infinity
			if (matched) {
				const from = Math.max(stay - stayPenalty, advance, skip - skipPenalty)
				// sims[j] is -1 where every ensemble rests: heard music
				// cannot be a rest.
				next[j] = from + sims[j] - 1
			} else if (ensembles[active].silent[j]) {
				// Through a rest at about the written pace: moving on is
				// preferred over standing, skipping costs a little.
				next[j] = Math.max(stay - restPenalty, advance, skip - restPenalty)
			} else {
				// A hair below the rest frontier, so that a tie at the
				// edge of a rest goes forward; among sung frames all hold
				// alike and nothing moves.
				next[j] = stay - 1e-3
			}
		}
		const swap = score
		score = next
		next = swap
		let arg = position
		let max = -Infinity
		for (let j = lo; j <= hi; j++) {
			if (score[j] > max) {
				max = score[j]
				arg = j
			}
		}
		// Keep the numbers small; only differences matter.
		if (Number.isFinite(max)) {
			for (let j = lo; j <= hi; j++) {
				score[j] -= max
			}
		}
		position = arg
		if (matched) {
			updateFit(chroma, arg)
			if (voice !== null) {
				updateVoiceFit(voice, arg)
			}
			history.push([liveStep, arg])
			while (history.length > tempoWindowFrames) {
				history.shift()
			}
		}
		const oldLo = lo
		const oldHi = hi
		setBand(arg)
		// Cells that left the band must not come back with stale scores.
		for (let j = oldLo; j <= oldHi; j++) {
			if (j < lo || j > hi) {
				score[j] = -Infinity
			}
		}
		return {
			position: arg,
			matched,
			similarity: matched ? sims[arg] : 0,
			ensemble: ensembles[active].id,
			// The part whose line the heard voice weighs on, if any.
			voice: line ? reference.voices[voiceIndex].id : null,
		}
	}

	/**
	 * How well the voice lies on a line near frame j.
	 *
	 * @param {number} voice MIDI
	 * @param {number} j
	 * @param {Float32Array} [of] the line, the one in use by default
	 * @return {number} 0..1, -1 if the line rests all around j
	 */
	function voiceMatch(voice, j, of = line) {
		let best = -1
		for (let k = Math.max(0, j - voiceSpanFrames); k <= Math.min(n - 1, j + voiceSpanFrames); k++) {
			if (Number.isFinite(of[k])) {
				const d = pitchClassDistance(voice, of[k]) / voiceSigma
				best = Math.max(best, Math.exp(-0.5 * d * d))
			}
		}
		return best
	}

	/**
	 * The line the voice has lain on, if one clearly leads - null otherwise.
	 *
	 * @return {?Float32Array}
	 */
	function voiceLine() {
		let first = -1
		let second = 0
		for (let p = 0; p < lines.length; p++) {
			if (first < 0 || voiceFit[p] > voiceFit[first]) {
				second = first < 0 ? 0 : Math.max(second, voiceFit[first])
				first = p
			} else {
				second = Math.max(second, voiceFit[p])
			}
		}
		voiceIndex = first >= 0 && voiceFit[first] >= voiceMinFit && voiceFit[first] - second >= voiceMargin ? first : -1
		return voiceIndex >= 0 ? lines[voiceIndex] : null
	}

	function updateVoiceFit(voice, j) {
		for (let p = 0; p < lines.length; p++) {
			const m = voiceMatch(voice, j, lines[p])
			if (m >= 0) {
				voiceFit[p] += voiceRate * (m - voiceFit[p])
			}
		}
	}

	function updateFit(chroma, j) {
		for (let e = 0; e < ensembles.length; e++) {
			if (!ensembles[e].silent[j]) {
				fit[e] += 0.05 * (similarity(chroma, ensembles[e].chroma.subarray(j * 12, j * 12 + 12)) - fit[e])
			}
		}
		for (let e = 0; e < ensembles.length; e++) {
			if (fit[e] > fit[active]) {
				active = e
			}
		}
	}

	function setBand(centre) {
		lo = Math.max(0, centre - bandFrames)
		hi = Math.min(n - 1, centre + bandFrames)
	}

	/**
	 * Tempo of the performance relative to the score, from the slope of the
	 * recent path (least squares); 1 until there is enough of it.
	 *
	 * @return {number}
	 */
	function tempoRatio() {
		if (history.length < 10) {
			return 1
		}
		let sx = 0
		let sy = 0
		let sxx = 0
		let sxy = 0
		for (const [x, y] of history) {
			sx += x
			sy += y
			sxx += x * x
			sxy += x * y
		}
		const k = history.length
		const denominator = k * sxx - sx * sx
		if (denominator === 0) {
			return 1
		}
		return clamp((k * sxy - sx * sy) / denominator, 0.5, 2)
	}

	return { anchor, step, tempoRatio, position: () => position }
}
