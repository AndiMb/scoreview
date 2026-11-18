// The microphone score follower, off the main thread.
//
// The viewer reads the spectrum from its AnalyserNode (only a main-thread
// object can) and posts features every 50 ms; the place in the score comes
// back. Why a worker: the global search runs once a second over the whole
// piece - measured on a desktop 17 ms at p99 and up to 41 ms, so a phone
// would drop several frames of cursor and scrolling every second.
//
// Nothing here keeps sound: what arrives are 36 chroma values, a level and
// the pitch of the clearest voice per tap (S7), and they are forgotten after
// the follower's short history.
//
// Messages in:
//   {type: 'init', input}               input from lib/followInput.js
//   {type: 'frame', c36, levelDb, voice, atMs} one tap; c36 null when nothing is in range,
//                                       voice from lib/voicePitch.js. Sent only after an
//                                       anchor and until the singer waits again.
//   {type: 'anchor', scoreMs, atMs}     the singer tapped the starting place
// Messages out:
//   {type: 'state', atMs, phase, shownMs, snapped, confirmedMs, tempoRatio, matched, jumped}
//   {type: 'error', message}

import { buildFollowReference } from '../lib/followRef.js'
import { createScoreFollower } from '../lib/scoreFollower.js'
import { snapToTurn, voiceTurnWindows } from '../lib/voiceTurns.js'

/** How far ahead of the confirmed place the display runs while the music moves. */
const SHOWN_LEAD_MS = 600

let follower = null
let reference = null
let systemStartsMs = []
// Turn windows per part, built when the heard voice first lies on its line.
const turnWindows = new Map()

/**
 * What the display shows: in a rest of the singer's own part before a new
 * system, that system already (lib/voiceTurns.js).
 *
 * @param {object} state of the follower
 * @param {?number} shown
 * @return {?number}
 */
function shownFor(state, shown) {
	if (shown === null || state.phase !== 'following' || !state.voice) {
		return shown
	}
	if (!turnWindows.has(state.voice)) {
		const line = reference.voices.find((v) => v.id === state.voice)?.line
		turnWindows.set(state.voice, line ? voiceTurnWindows(line, reference.frameMs, systemStartsMs) : [])
	}
	return snapToTurn(turnWindows.get(state.voice), shown)
}

self.onmessage = ({ data }) => {
	try {
		if (data.type === 'init') {
			const { notes, parts, options } = data.input
			// Shown ahead of what the sound confirmed: the confirmation is late
			// (measured on hand-labelled rehearsal recordings: ~270 ms), and a
			// singer must see the next system before reaching it - the cursor,
			// the scrolling and the system band all hang on this time
			// (lib/followerTime.js). Replayed with this lead, bars within one
			// bar stayed as they were.
			reference = buildFollowReference(notes, parts, options)
			systemStartsMs = options.systemStartsMs ?? []
			turnWindows.clear()
			follower = createScoreFollower(reference, { time: { leadMs: SHOWN_LEAD_MS } })
		} else if (!follower) {
			// Frames before the reference exists have nothing to match against.
		} else if (data.type === 'anchor') {
			follower.anchor(data.scoreMs, data.atMs)
		} else if (data.type === 'frame') {
			const state = follower.step({ c36: data.c36, levelDb: data.levelDb, voice: data.voice }, data.atMs)
			const place = follower.shownMs(data.atMs)
			const shown = shownFor(state, place)
			self.postMessage({
				type: 'state',
				atMs: data.atMs,
				phase: state.phase,
				shownMs: shown,
				// Moved to the next system ahead of the music: the display
				// must not run on from there by itself.
				snapped: shown !== place,
				confirmedMs: state.confirmedMs,
				tempoRatio: state.tempoRatio,
				matched: state.matched,
				jumped: state.jumped,
			})
		}
	} catch (err) {
		self.postMessage({ type: 'error', message: String(err?.message ?? err) })
	}
}
