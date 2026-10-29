/**
 * Gives the main thread back before going on: a tap or a frame that is
 * waiting runs in between. `scheduler.yield()` where the browser has it - the
 * continuation then goes ahead of other queued tasks -, otherwise a
 * zero-delay timeout.
 *
 * Loading a page used to be one task from the parsed SVG to the finished
 * indexes; on a phone profile 330-560 ms in which a scroll or a tap had to
 * wait (ScorePage.vue#load).
 *
 * @return {Promise<void>}
 */
export function yieldToMain() {
	const scheduler = globalThis.scheduler
	if (typeof scheduler?.yield === 'function') {
		return scheduler.yield()
	}
	return new Promise((resolve) => setTimeout(resolve, 0))
}
