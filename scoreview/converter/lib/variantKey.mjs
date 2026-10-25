/**
 * The key of a display variant (docs/architecture.md E19): a second
 * engraving of the same score version - a part, a phone page, concert pitch,
 * transposed notation - written as four fields in a fixed order:
 *
 *     <source>~<format>~<pitch>~<transposition>
 *     full~phone~w~0      the full score on a phone page
 *     ex1~orig~w~0        the second stored part, as the file has it
 *     part3~phone~w~-2    a generated part for part id 3, phone page, a tone lower
 *
 * One module for all three places that read a key: the converter (which
 * engine calls to make), the server (Service\VariantKey mirrors the grammar
 * and is tested against the same cases) and the viewer (which key a choice
 * means). Pure, no engine import - `npm test` runs it.
 *
 * Exactly one spelling per variant. A key that parses but is not written the
 * way variantKey() would write it ("tr" as "+2", "ex01") is refused: two
 * addresses for the same bytes would be two cache entries and two browser
 * caches - the same reasoning that refuses `page-01` on the artifact route.
 * The neutral point of all four axes is the base conversion itself and not a
 * variant either, for the same reason.
 */

export const SOURCES = Object.freeze(['full', 'ex', 'part'])
export const FORMATS = Object.freeze(['orig', 'phone', 'phonel'])
export const PITCHES = Object.freeze(['w', 'c'])
export const MAX_TRANSPOSE = 12

/** The neutral key: the base conversion, never a variant. */
export const BASE_KEY = 'full~orig~w~0'

const SOURCE_RE = /^(?:full|ex(0|[1-9][0-9]{0,2})|part([A-Za-z0-9_-]{1,40}))$/
const TRANSPOSE_RE = /^(?:0|-?(?:[1-9]|1[0-2]))$/

/**
 * @typedef {object} Variant
 * @property {{kind: 'full'} | {kind: 'ex', index: number} | {kind: 'part', partId: string}} source the score, a stored part, or a part to generate
 * @property {'orig'|'phone'|'phonel'} format the file's pages or a phone-sized page
 * @property {'w'|'c'} pitch  w = as the file is written, c = concert pitch
 * @property {number} transpose semitones, -12 … 12
 */

/**
 * @param {Variant['source']} source
 * @return {?string}
 */
function sourceText(source) {
	switch (source?.kind) {
		case 'full': return 'full'
		case 'ex': return Number.isInteger(source.index) && source.index >= 0 && source.index <= 999 ? `ex${source.index}` : null
		case 'part': return typeof source.partId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(source.partId) ? `part${source.partId}` : null
		default: return null
	}
}

/**
 * The canonical key of a variant; null for something that is no variant -
 * an invalid field, or the base conversion itself.
 *
 * @param {Variant} variant
 * @return {?string}
 */
export function variantKey(variant) {
	const src = sourceText(variant?.source)
	if (src === null
		|| !FORMATS.includes(variant.format)
		|| !PITCHES.includes(variant.pitch)
		|| !Number.isInteger(variant.transpose)
		|| Math.abs(variant.transpose) > MAX_TRANSPOSE) {
		return null
	}
	const key = `${src}~${variant.format}~${variant.pitch}~${variant.transpose}`
	return key === BASE_KEY ? null : key
}

/**
 * @param {string} key
 * @return {?Variant} null for anything but a canonical variant key
 */
export function parseVariantKey(key) {
	if (typeof key !== 'string' || key.length > 64) {
		return null
	}
	const fields = key.split('~')
	if (fields.length !== 4) {
		return null
	}
	const [src, format, pitch, tr] = fields
	const m = SOURCE_RE.exec(src)
	if (!m || !TRANSPOSE_RE.test(tr)) {
		return null
	}
	const source = m[1] !== undefined
		? { kind: 'ex', index: Number(m[1]) }
		: m[2] !== undefined ? { kind: 'part', partId: m[2] } : { kind: 'full' }
	const variant = { source, format, pitch, transpose: Number(tr) }
	// Round trip: the one check that holds every field to its one spelling.
	return variantKey(variant) === key ? variant : null
}

/**
 * The options for the engine's applyView() (scoreview-engine).
 *
 * @param {Variant} variant
 * @return {{format: string, concertPitch: ?boolean, transposeSemitones: number}}
 */
export function engineViewOptions(variant) {
	return {
		format: variant.format,
		// "w" keeps whatever the file says; only "c" asks for something.
		concertPitch: variant.pitch === 'c' ? true : null,
		transposeSemitones: variant.transpose,
	}
}
