/**
 * Remembers translations without placeholders. @nextcloud/l10n's translate()
 * runs every result through DOMPurify (its `sanitize` option is on by
 * default), and the viewer's root template calls t() about a hundred times
 * per render - measured during playback on a phone profile: 37 % of all
 * script time went into that sanitizer. A text without placeholders yields
 * the same string for the whole page load (the language does not change
 * without a reload), so it is translated once.
 *
 * Calls with placeholders or a count still go through every time: their
 * result depends on values, and caching them would let the map grow without
 * bound (a measure number, a time).
 *
 * @param {(app: string, text: string, vars?: object, count?: number, options?: object) => string} translate
 * @return {(app: string, text: string, vars?: object, count?: number, options?: object) => string}
 */
export function createCachedTranslate(translate) {
	const cache = new Map()
	return (app, text, vars, count, options) => {
		if (vars !== undefined || count !== undefined || options !== undefined) {
			return translate(app, text, vars, count, options)
		}
		const key = `${app}\u0000${text}`
		let value = cache.get(key)
		if (value === undefined) {
			value = translate(app, text)
			cache.set(key, value)
		}
		return value
	}
}
