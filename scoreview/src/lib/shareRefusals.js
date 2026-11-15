/**
 * Refusals of a request made with a public link's token
 * (Middleware\DirectAccessMiddleware, Service\PublicShareException, the
 * controllers' share_quota). They come as an HTTP error, not as a stored
 * conversion error, but carry a code of their own and get a sentence like
 * one - a raw "Request failed with status code 401" tells a visitor nothing.
 *
 * One table for the base score (useConversionStatus) and the display
 * variants (useScoreVariant): both reach the same middleware, and two
 * copies of these sentences drifted apart once already.
 *
 * `t` is passed in so the table is testable without Nextcloud; the calls
 * stay literal t() calls, which is how tools/l10n.mjs finds the strings.
 */

/**
 * @param {(text: string) => string} t
 * @return {Record<string, string>}
 */
function texts(t) {
	const linkInvalid = t('This link is no longer valid or needs its password again. Open the link again.')
	const tryLater = t('Too many new scores were prepared through this link. Try again later.')
	return {
		// The link is gone, its password is to be entered again, or this
		// route is not open to links - the same advice helps in each case.
		share_auth: linkInvalid,
		share_invalid: linkInvalid,
		share_no_read: linkInvalid,
		share_not_allowed: linkInvalid,
		public_disabled: linkInvalid,
		// The link's hourly quota of new conversions, or the brute-force
		// protection - both pass with time.
		share_quota: tryLater,
		share_throttled: tryLater,
		// The score left the shared folder (or the token's file was deleted
		// or unshared): opening the link again shows what is there now.
		not_found: t('This score can no longer be found. It may have been moved or deleted, or it is no longer shared.'),
	}
}

/** The codes this table knows - without needing a translation function. */
const CODES = new Set(Object.keys(texts((s) => s)))

/**
 * @param {unknown} code
 * @return {boolean}
 */
export function isShareRefusal(code) {
	return typeof code === 'string' && CODES.has(code)
}

/**
 * The sentence for a share refusal, or null for any other code.
 *
 * @param {unknown} code
 * @param {(text: string) => string} t
 * @return {?string}
 */
export function shareRefusalText(code, t) {
	return isShareRefusal(code) ? texts(t)[code] : null
}
