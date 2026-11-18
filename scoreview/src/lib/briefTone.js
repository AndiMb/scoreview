// "Sound briefly": a tapped note (D13) and a step with Shift+arrow (#34)
// each play a tone for a moment and stop it again. Both go through one
// instance with one timer: with two timers, or one not remembered, the
// earlier timer stops the later tone after a fraction of its time - two
// quick taps, or a tap followed by a step, and the second tone is cut short.

export const BRIEF_TONE_MS = 700

/**
 * @param {object} deps
 * @param {(pitches: number|number[]) => Promise<void>|void} deps.start sounds the tone(s)
 * @param {() => void} deps.stop silences them
 * @param {number} [deps.durationMs]
 * @return {{sound: (pitches: number|number[]) => Promise<void>, cancel: () => void}}
 */
export function createBriefTone({ start, stop, durationMs = BRIEF_TONE_MS }) {
	let timer = null
	// start() is awaited (the synth may still be waking up). A newer tone
	// that begins meanwhile owns the stop; the older call then sets no
	// timer of its own when its await returns.
	let generation = 0

	function clear() {
		clearTimeout(timer)
		timer = null
	}

	async function sound(pitches) {
		const mine = ++generation
		clear()
		await start(pitches)
		if (mine !== generation) {
			return
		}
		timer = setTimeout(() => {
			timer = null
			stop()
		}, durationMs)
	}

	/** Forget a pending stop - on unmount, when the clock is going anyway. */
	function cancel() {
		generation++
		clear()
	}

	return { sound, cancel }
}
