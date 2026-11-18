// Experimental, behind the switch `feature_score_follower`: the viewer runs
// it in workers/followerWorker.js (composables/useScoreFollower.js), and
// tools/follow-replay.mjs (the command line over tools/follow/replay.mjs)
// measures it against recorded rehearsals.
//
// The microphone follower: features in, place in the score out - pure, no
// DOM, no AudioContext, no clock of its own. Fed by the viewer from its
// AnalyserNode and by the replay from a file, which is what makes the
// acceptance figures measurable.
//
// Pipeline per tap: level gate (lib/listenGates.js) → fold to 12 classes at
// the current tuning (lib/chroma.js) → online warp in the band
// (lib/onlineWarp.js) → confirmed place → the two times
// (lib/followerTime.js). Once a second the global search (lib/globalSearch.js)
// looks at the last four seconds against the whole piece. The tuning learns
// only from frames that matched the score, so speech cannot pull it away.
//
// States:
// - `searching`: no place yet (cold start). The search must find the same
//   place twice in a row, by a margin, before the follower leads.
// - `following`: the warp matches.
// - `unsure`: sound that fits nothing nearby for a while. The cursor may
//   coast, nothing is turned (the worker's turn ahead of the music and the
//   replay's lib/followTurn.js read the phase).
// - `lost`: the search hears music that fits clearly better elsewhere than
//   here, twice in a row. Nothing is turned. Sound that fits nowhere
//   (speech between pieces) only makes the follower `unsure` - otherwise
//   every announcement would show "I am not following".
//   Searches on; a settled result is taken, an ambiguous one only offered
//   (F10, F12). Back to `following` only when the search confirms the place
//   - measured on a synthetic rehearsal: after a jump the local warp went on
//   "matching" chords of the same key at the wrong place with 0.8 and more,
//   and turned the page there.
//
// A jump out of `following` needs the same as a cold start - the same place
// twice, by a margin - and the local place must fit clearly worse there. A
// wrong jump is the most expensive failure (A2), a late one only costs a
// few seconds.

import { createTuningState, fold12, onsetFlux } from './chroma.js'
import { createFollowerTime } from './followerTime.js'
import { nearestOccurrenceMs, printedPlaceMs } from './followRef.js'
import { buildQuery, rotateChroma, searchReference } from './globalSearch.js'
import { createLevelGate } from './listenGates.js'
import { createOnlineWarp } from './onlineWarp.js'
import { createTempoTracker } from './tempoTracker.js'
import { clearVoiceMidi } from './voicePitch.js'

/**
 * @typedef {object} FollowerState
 * @property {'searching'|'following'|'unsure'|'lost'} phase see the states above
 * @property {?number} confirmedMs confirmed place in score time
 * @property {number} tempoRatio performance tempo relative to the score
 * @property {number} confidence 0..1, running mean of the match
 * @property {number} evidence share of matched taps in the last second
 * @property {?string} ensemble which ensemble fits best (display only, F3)
 * @property {number} tuningCents running tuning estimate
 * @property {boolean} matched this tap matched the score
 * @property {boolean} jumped this tap moved the place by a jump or a found start
 * @property {?{timeMs: number}} offer a place the search suggests but does not take (F12);
 *   replay only - the viewer shows no offer, the singer taps instead
 */

const DEFAULTS = Object.freeze({
	windowMs: 170,
	unsureAfterMs: 1000,
	searchEveryMs: 1000,
	queryMs: 4000,
	// Search acceptance: raw similarity, margin over the best elsewhere,
	// agreement of two searches in a row.
	acceptScore: 0.8,
	acceptMargin: 0.03,
	agreeMs: 1500,
	// Slower path for thin textures (one voice alone): the same place three
	// searches in a row, each a little ahead, clearly ahead on average.
	trackMargin: 0.008,
	trackMeanMargin: 0.015,
	// A jump also needs the local place to fit this much worse.
	jumpAdvantage: 0.05,
	// "Far" for a jump: closer than this, the warp catches up by itself.
	jumpDistanceMs: 4000,
	// The music fits elsewhere better by this much than here → lost.
	lostGap: 0.06,
	// After a pause this long, entry points get a bonus in the search.
	reentryPauseMs: 1500,
	priorWeight: 0.03,
	// Cold start: the music most likely begins on the page the singer has
	// open (setView; only the replay sets it - the viewer starts from a tap). A bonus, not an anchor - singing elsewhere still wins
	// if it fits clearly better. Not used once lost: then the page on
	// screen is the one the follower got wrong. Measured on rehearsal
	// recordings: 0.03 settles a hymn opened at its first page (a3: 28 % →
	// 87 % within a bar); at 0.04 a page opened at the wrong place drew the
	// search onto a look-alike phrase there.
	viewWeight: 0.03,
	// The same bar in another verse: how much going back to it costs
	// compared with going ahead (followRef nearestOccurrenceMs). Below 1
	// because rehearsals restart ("again from bar 5") more often than
	// they skip a verse; measured 0.1-0.5 alike, 1 and 2 clearly worse.
	verseBackCost: 0.5,
	// Semitone rotations tried where no place is known (R8).
	coldRotations: [-1, 0, 1],
})

/**
 * @param {import('./followRef.js').FollowReference} reference
 * @param {object} [options] see DEFAULTS, plus `warp`, `gate`, `time` for the parts
 * @return {object}
 */
export function createScoreFollower(reference, options = {}) {
	const o = { ...DEFAULTS, ...options }
	// 'tempo' is the tempo-model tracker (lib/tempoTracker.js), still on trial
	// against the warp on the rehearsal recordings.
	const warp = o.tracker === 'tempo'
		? createTempoTracker(reference, options.tempo)
		: createOnlineWarp(reference, options.warp)
	const gate = createLevelGate(options.gate)
	const time = createFollowerTime(options.time)
	const tuning = createTuningState()
	const historyLength = Math.round(o.queryMs / reference.frameMs)
	const history = []
	const recent = []
	let phase = 'searching'
	// Per CENS frame: 1 where the score is on screen (setView), else 0.
	let view = null
	let confidence = 0
	let ensemble = null
	// The part whose line the heard voice lies on (lib/onlineWarp.js), once known.
	let voicePart = null
	let unmatchedSince = null
	let lastSearchAt = -Infinity
	// Recent search results: {endMs, atMs, rate, margin, raw}.
	const trail = []
	let worseCount = 0
	let silentSince = null
	let lastPauseMs = 0
	let offer = null
	let last = null
	// Per-pitch-class level of the last audible tap, for the onset feature.
	let previousDb = null

	/**
	 * The singer set the place (bar entered by hand, note tapped, remembered
	 * place confirmed). What was heard before belongs to another place: left
	 * in the history, the global search would match it for another
	 * `queryMs` and could confirm the old place and jump back there.
	 *
	 * Forgotten as silence, not dropped: buildQuery wants half of a full
	 * history heard. An emptied one passes that with the first taps of
	 * sound, and a query of a few hundred milliseconds settles on wrong
	 * places (measured on the rehearsal recordings: two wrong jumps and a
	 * wrong turn more).
	 *
	 * @param {number} scoreMs
	 * @param {number} atMs
	 */
	function anchor(scoreMs, atMs) {
		history.length = 0
		for (let i = 0; i < historyLength; i++) {
			history.push(null)
		}
		previousDb = null
		silentSince = null
		lastPauseMs = 0
		place(scoreMs, atMs)
	}

	/**
	 * Follow on from a place. The history stays: when the place comes from
	 * the search (a jump, an offer taken), that history is what matched it.
	 *
	 * @param {number} scoreMs
	 * @param {number} atMs
	 */
	function place(scoreMs, atMs) {
		warp.anchor(scoreMs / reference.frameMs)
		time.reset()
		time.confirm(scoreMs, atMs, 1)
		phase = 'following'
		unmatchedSince = null
		trail.length = 0
		worseCount = 0
		offer = null
	}

	/**
	 * Take the place the search offered. Replay only, as `offer`.
	 *
	 * @param {number} atMs
	 * @return {boolean} whether there was an offer
	 */
	function acceptOffer(atMs) {
		if (!offer) {
			return false
		}
		place(offer.timeMs, atMs)
		return true
	}

	/**
	 * One tap of features.
	 *
	 * @param {{c36: ?Float32Array, levelDb: number, voice?: ?object}} frame voice: lib/voicePitch.js
	 * @param {number} atMs time of the tap (end of the analysis window)
	 * @return {FollowerState}
	 */
	function step(frame, atMs) {
		const audible = !!frame.c36 && gate.accept(frame.levelDb, atMs)
		const chroma = audible ? fold12(frame.c36, tuning, { learn: false }).chroma : null
		let onset = null
		if (chroma) {
			const flux = onsetFlux(previousDb, chroma, frame.levelDb)
			previousDb = flux.db
			onset = flux.flux ? { flux: flux.flux, strength: flux.strength } : null
		} else {
			previousDb = null
		}
		remember(history, chroma, historyLength)
		trackPause(audible, atMs)
		let jumped = false
		let matched = false
		if (phase !== 'searching') {
			// The own voice at the score's tuning (fold12 reads `cents` higher).
			const heard = chroma ? clearVoiceMidi(frame.voice) : null
			const voice = heard === null ? null : heard - tuning.cents / 100
			const result = warp.step(chroma, onset, voice)
			matched = result.matched
			if (matched) {
				onMatch(frame, result, atMs)
			} else if (audible) {
				onUnmatched(atMs)
			} else {
				// A pause is no evidence against the place: one odd frame at
				// a phrase end and one at the next entry are not a second
				// of sound that fits nothing.
				unmatchedSince = null
			}
		}
		remember(recent, matched, Math.round(1000 / reference.frameMs))
		if (atMs - lastSearchAt >= o.searchEveryMs) {
			lastSearchAt = atMs
			jumped = search(atMs)
		}
		last = {
			phase,
			confirmedMs: time.confirmedMs(),
			tempoRatio: warp.tempoRatio(),
			confidence,
			evidence: recent.filter(Boolean).length / Math.max(1, recent.length),
			ensemble,
			voice: voicePart,
			tuningCents: tuning.cents,
			matched,
			jumped,
			offer,
		}
		return last
	}

	function onMatch(frame, result, atMs) {
		fold12(frame.c36, tuning, { learn: true })
		gate.noteMusic(frame.levelDb)
		const tempo = warp.tempoRatio()
		// The window ends at the tap; what it heard lies half a window back.
		time.confirm((result.position + 0.5) * reference.frameMs + (o.windowMs / 2) * tempo, atMs, tempo)
		confidence += 0.1 * (result.similarity - confidence)
		ensemble = result.ensemble
		if (result.voice) {
			voicePart = result.voice
		}
		unmatchedSince = null
		if (phase === 'unsure') {
			phase = 'following'
		}
	}

	function onUnmatched(atMs) {
		unmatchedSince ??= atMs
		confidence *= 0.98
		if (phase === 'following' && atMs - unmatchedSince >= o.unsureAfterMs) {
			phase = 'unsure'
		}
	}

	function trackPause(audible, atMs) {
		if (audible) {
			if (silentSince !== null) {
				lastPauseMs = atMs - silentSince
			}
			silentSince = null
		} else {
			silentSince ??= atMs
		}
	}

	/**
	 * Run the global search; take, offer or ignore its result.
	 *
	 * @param {number} atMs
	 * @return {boolean} whether the place jumped
	 */
	function search(atMs) {
		const query = buildQuery(history, reference.frameMs, reference.censMs)
		if (!query) {
			return false
		}
		// R8: a choir or organ almost a semitone off reads as transposed;
		// only where no place is known yet is that worth three searches.
		const coldStart = phase === 'searching' || phase === 'lost'
		const result = searchReference(reference, query, {
			rotations: coldStart ? o.coldRotations : [0],
			priorWeight: lastPauseMs >= o.reentryPauseMs ? o.priorWeight : 0,
			bonus: phase === 'searching' ? view : null,
			bonusWeight: o.viewWeight,
		})
		if (!result) {
			return false
		}
		const { best } = result
		const clear = best.raw >= o.acceptScore && result.margin >= o.acceptMargin
		remember(trail, { endMs: best.endMs, atMs, rate: best.rate, margin: result.margin, raw: best.raw }, 3)
		const agrees = settled()
		const here = time.confirmedMs()
		// Diagnostics for the measuring rig (tools/follow-replay.mjs).
		o.onSearch?.({ atMs, phase, best, second: result.second, margin: result.margin, clear, agrees })

		// Near also on paper: the same bar in another verse needs no jump -
		// the page is the same, and where the verses part the warp loses
		// the music and the search finds the right one.
		const near = here !== null && (Math.abs(best.endMs - here) < o.jumpDistanceMs
			|| Math.abs(printedPlaceMs(reference, best.endMs) - printedPlaceMs(reference, here)) < o.jumpDistanceMs)
		const local = here === null ? -Infinity : result.scoreAt(here)
		if (phase === 'searching' || phase === 'lost') {
			if (phase === 'lost' && near && local >= best.raw - o.acceptMargin) {
				// The search finds the music where the warp already is.
				phase = 'following'
				offer = null
				worseCount = 0
				return false
			}
			if (agrees && !near) {
				takeCandidate(best, atMs)
				return true
			}
			if (agrees && near) {
				phase = 'following'
				offer = null
				return false
			}
			// Plausible but not settled (repeated passages): offer, never take.
			if (phase === 'lost' && best.raw >= o.acceptScore) {
				offer = { timeMs: best.endMs }
			}
			return false
		}
		if (here === null || near) {
			worseCount = 0
			return false
		}
		worseCount = best.raw >= o.acceptScore && best.raw - local >= o.lostGap ? worseCount + 1 : 0
		if (agrees && best.raw - local >= o.jumpAdvantage) {
			takeCandidate(best, atMs)
			return true
		}
		if (worseCount >= 2) {
			phase = 'lost'
			offer = best.raw >= o.acceptScore ? { timeMs: best.endMs } : null
		}
		return false
	}

	/**
	 * Has the search settled on one place? Either twice in a row by a clear
	 * margin, or three times in a row by a small but steady one. Ties (two
	 * identical passages, margin 0) settle never - which is F10.
	 *
	 * @return {boolean}
	 */
	function settled() {
		// Two searches agree if they name the same place on paper: with equal
		// verses the best match may land in either.
		const same = (a, b) => {
			const expected = a.endMs + (b.atMs - a.atMs) * b.rate
			return Math.abs(b.endMs - expected) <= o.agreeMs
				|| Math.abs(printedPlaceMs(reference, b.endMs) - printedPlaceMs(reference, expected)) <= o.agreeMs
		}
		const n = trail.length
		const ok = (t) => t.raw >= o.acceptScore
		if (n >= 2) {
			const [a, b] = trail.slice(-2)
			if (ok(a) && ok(b) && a.margin >= o.acceptMargin && b.margin >= o.acceptMargin && same(a, b)) {
				return true
			}
		}
		if (n >= 3) {
			const [a, b, c] = trail.slice(-3)
			const mean = (a.margin + b.margin + c.margin) / 3
			return [a, b, c].every((t) => ok(t) && t.margin >= o.trackMargin) && mean >= o.trackMeanMargin
				&& same(a, b) && same(b, c)
		}
		return false
	}

	function takeCandidate(best, atMs) {
		if (best.rotation) {
			// The sound sits a semitone off: shift the tuning estimate and
			// the history with it, so the warp folds the same way.
			tuning.cents += 100 * best.rotation
			for (let i = 0; i < history.length; i++) {
				if (history[i]) {
					history[i] = rotateChroma(history[i], -best.rotation)
				}
			}
		}
		// The same bar in another verse sounds the same: take the
		// occurrence that continues from where the follower was.
		const endMs = nearestOccurrenceMs(reference, best.endMs, time.confirmedMs(), { backCost: o.verseBackCost })
		place(endMs + (o.windowMs / 2) * best.rate, atMs)
	}

	/**
	 * What the screen shows, as score time ranges - every pass of the
	 * systems on screen, since a repeat shows the same notes. Null: unknown.
	 * Replay only (cold-start measurements): the viewer starts from a tap
	 * and never calls it.
	 *
	 * @param {?Array<{fromMs:number, toMs:number}>} ranges
	 */
	function setView(ranges) {
		if (!ranges || ranges.length === 0) {
			view = null
			return
		}
		const censMs = reference.censMs
		view = new Float32Array(reference.cens[0].length)
		for (const { fromMs, toMs } of ranges) {
			for (let i = Math.max(0, Math.floor(fromMs / censMs)); i < Math.min(view.length, Math.ceil(toMs / censMs)); i++) {
				view[i] = 1
			}
		}
	}

	return {
		anchor,
		acceptOffer,
		setView,
		step,
		shownMs: (nowMs) => time.shownMs(nowMs),
		state: () => last,
	}
}

function remember(list, value, max) {
	list.push(value)
	if (list.length > max) {
		list.shift()
	}
}
