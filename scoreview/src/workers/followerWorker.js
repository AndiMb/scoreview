// The microphone score follower, off the main thread.
//
// The viewer reads the spectrum from its AnalyserNode (only a main-thread
// object can) and posts features every 50 ms; the place in the score comes
// back. Why a worker: the global search runs once a second over the whole
// piece - measured on a desktop 17 ms at p99 and up to 41 ms, so a phone
// would drop several frames of cursor and scrolling every second.
//
// Nothing here keeps sound: what arrives are 36 chroma values and a level
// per tap (S7), and they are forgotten after the follower's short history.
//
// Messages in:
//   {type: 'init', input}               input from lib/followInput.js
//   {type: 'frame', c36, levelDb, atMs} one tap; c36 null when nothing is in range
//   {type: 'anchor', scoreMs, atMs}     the singer tapped the starting place
// Messages out:
//   {type: 'state', atMs, phase, shownMs, confirmedMs, tempoRatio, matched, jumped}
//   {type: 'error', message}

import { buildFollowReference } from '../lib/followRef.js'
import { createScoreFollower } from '../lib/scoreFollower.js'

let follower = null

self.onmessage = ({ data }) => {
	try {
		if (data.type === 'init') {
			const { notes, parts, options } = data.input
			follower = createScoreFollower(buildFollowReference(notes, parts, options))
		} else if (!follower) {
			// Frames before the reference exists have nothing to match against.
		} else if (data.type === 'anchor') {
			follower.anchor(data.scoreMs, data.atMs)
		} else if (data.type === 'frame') {
			const state = follower.step({ c36: data.c36, levelDb: data.levelDb }, data.atMs)
			self.postMessage({
				type: 'state',
				atMs: data.atMs,
				phase: state.phase,
				shownMs: follower.shownMs(data.atMs),
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
