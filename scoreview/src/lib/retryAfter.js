/**
 * Milliseconds to wait from a `Retry-After` header: delta-seconds or an
 * HTTP date, clamped to [1 s, 30 s] so a wrong header neither hammers the
 * server nor leaves the viewer silent for minutes.
 *
 * @param {?string} header
 * @param {number} fallbackMs used when the header cannot be read
 * @param {number} [now] Date.now(), for tests
 * @return {number}
 */
export function retryAfterMs(header, fallbackMs, now = Date.now()) {
	const clamp = (ms) => Math.min(30000, Math.max(1000, ms))
	const text = String(header ?? '').trim()
	if (/^\d+$/.test(text)) {
		return clamp(Number(text) * 1000)
	}
	const date = Date.parse(text)
	return clamp(Number.isNaN(date) ? fallbackMs : date - now)
}

/**
 * setTimeout as a promise that rejects with the signal's reason on abort.
 *
 * @param {number} ms
 * @param {?AbortSignal} signal
 * @return {Promise<void>}
 */
export function abortableDelay(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
			return
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort)
			resolve()
		}, ms)
		function onAbort() {
			clearTimeout(timer)
			reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
		}
		signal?.addEventListener('abort', onAbort, { once: true })
	})
}
