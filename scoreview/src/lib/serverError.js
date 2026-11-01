/**
 * The message a failed request should show: the server's own `error` text
 * when it sent one (the controllers phrase it for people, translated), else
 * the caller's fallback. An empty string from the server counts as none.
 *
 * @param {?object} err an axios error or anything thrown
 * @param {string} fallback
 * @return {string}
 */
export function serverError(err, fallback) {
	const fromServer = err?.response?.data?.error
	return typeof fromServer === 'string' && fromServer !== '' ? fromServer : fallback
}
