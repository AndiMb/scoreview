/**
 * When the playback AudioContext may rest (`suspend()`).
 *
 * A running context keeps the audio thread rendering - silence, too - in
 * 128-frame quanta, and on Android/iOS it keeps the audio hardware awake.
 * Measured before this module existed: the context stayed `running` from
 * opening the viewer until closing it, paused or not.
 *
 * Suspending right after `pause()` would be wrong, because the context is
 * SHARED (player.js): the metronome and the count-in click on it - the
 * count-in BEFORE play() -, the microphone (intonation, recording) captures
 * through it, and listening back to a recording plays through it. Each of
 * these holds the context with `hold(reason)` for as long as it needs it;
 * the context rests only when nobody holds it, nothing plays, and `idleMs`
 * have passed. The delay keeps reverb tails and quick pause/play sequences
 * from being cut off.
 *
 * Playing is asked through `isPlaying()` when the timer fires, not tracked
 * through calls: the sequencer stops by itself at the end of the piece, and
 * nobody calls pause() then. While playing, the timer re-arms every `idleMs` -
 * one timeout every few seconds, negligible against rendering audio.
 */

export const AUDIO_IDLE_MS = 3000

/**
 * @param {object} deps
 * @param {() => boolean} deps.isPlaying
 * @param {() => Promise<void>|void} deps.suspend
 * @param {() => Promise<void>|void} deps.resume
 * @param {number} [deps.idleMs]
 * @param {(fn: () => void, ms: number) => unknown} [deps.setTimer]
 * @param {(handle: unknown) => void} [deps.clearTimer]
 */
export function createAudioIdle({ isPlaying, suspend, resume, idleMs = AUDIO_IDLE_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
	const holders = new Set()
	let timer = null
	let destroyed = false

	function cancel() {
		if (timer !== null) {
			clearTimer(timer)
			timer = null
		}
	}

	function busy() {
		return holders.size > 0 || isPlaying()
	}

	/** Start (or restart) the countdown to rest. */
	function settle() {
		cancel()
		if (destroyed || holders.size > 0) {
			return
		}
		timer = setTimer(() => {
			timer = null
			if (destroyed) {
				return
			}
			if (busy()) {
				// Still playing: look again later. Holders re-arm on release.
				if (holders.size === 0) {
					settle()
				}
				return
			}
			Promise.resolve(suspend()).catch(() => {})
		}, idleMs)
	}

	/**
	 * Wake the context and start the countdown - for anything that starts
	 * sound and ends by itself (play: the end of the piece is seen by the
	 * timer).
	 *
	 * @return {Promise<void>}
	 */
	async function wake() {
		cancel()
		await resume()
		settle()
	}

	/**
	 * Keep the context awake until the returned function is called. Calling
	 * it twice does nothing the second time.
	 *
	 * @param {string} reason only for debugging
	 * @return {(() => void) & {ready: Promise<void>}}
	 */
	function hold(reason) {
		const token = { reason }
		holders.add(token)
		cancel()
		let released = false
		const release = () => {
			if (released) {
				return
			}
			released = true
			holders.delete(token)
			settle()
		}
		release.ready = Promise.resolve(resume()).catch(() => {})
		return release
	}

	function destroy() {
		destroyed = true
		cancel()
		holders.clear()
	}

	return {
		hold,
		wake,
		settle,
		destroy,
		get holders() {
			return [...holders].map((h) => h.reason)
		},
	}
}
