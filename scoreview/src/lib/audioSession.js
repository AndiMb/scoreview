// The page's audio session type (issue #23) - pure, the navigator is
// injected.
//
// ScoreView plays only through Web Audio. With the default type 'auto',
// Safari treats Web Audio as ambient sound, and iOS mutes ambient sound when
// the ring/silent switch is set to silent - while Safari still shows its
// speaker icon, because WebKit sets it from the rendered samples, before the
// mute. 'playback' makes it media playback, as in music and video apps;
// 'play-and-record' is the same while the microphone captures.
//
// The type is set right before a context starts to sound (created in a
// gesture or resumed), not when the viewer opens: a 'playback' session pauses
// the audio of other apps, and someone who only reads the score should keep
// their music. There is one session per page, not one per context, hence one
// instance for all of them (`audioSession` below).
//
// Recognised by the API, never by the user agent (as in micAccess.js):
// Chrome has no `navigator.audioSession`, Firefox only in preview builds,
// iOS before 16.4 neither - there nothing changes.

/**
 * @param {{audioSession?: {type: string}}} [nav]
 */
export function createAudioSession(nav = globalThis.navigator) {
	// What the page wants while nobody captures: 'auto' until the first
	// sound, 'playback' after it, 'auto' again once the viewer closes.
	let base = 'auto'
	let captures = 0

	function apply() {
		const session = nav?.audioSession
		if (!session) {
			return
		}
		const type = captures > 0 ? 'play-and-record' : base
		// Written only on a change: forPlayback() runs on every wake of the
		// context, and every write makes WebKit re-evaluate the session.
		try {
			if (session.type !== type) {
				session.type = type
			}
		} catch {
			// A preview implementation that rejects a type - then the
			// browser's default stays, as without the API.
		}
	}

	return {
		/** Before a context is created or resumed for sound. */
		forPlayback() {
			base = 'playback'
			apply()
		},

		/**
		 * Before getUserMedia. While anybody captures, the type stays
		 * 'play-and-record' - a playback starting meanwhile must not take the
		 * input away from the tuner.
		 *
		 * @return {() => void} after the tracks stopped; a second call does nothing
		 */
		forCapture() {
			captures++
			apply()
			let released = false
			return () => {
				if (released) {
					return
				}
				released = true
				captures--
				apply()
			}
		},

		/**
		 * When the viewer is torn down: back to the browser's default, for
		 * whatever else runs in this tab (Files stays open). A microphone
		 * still open keeps its type until it is released.
		 */
		reset() {
			base = 'auto'
			apply()
		},
	}
}

export const audioSession = createAudioSession()

/**
 * `new AudioContext()` with the session type set first - a context created
 * in a gesture runs, and sounds, at once.
 *
 * @param {AudioContextOptions} [options]
 * @return {AudioContext}
 */
export function createAudioContext(options) {
	audioSession.forPlayback()
	return new AudioContext(options)
}
