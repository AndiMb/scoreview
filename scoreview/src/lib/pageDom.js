// What a ScorePage knows about its page SVG beyond the markup: indexes into
// the DOM, the nodes it has coloured, measured boxes and laid-out note
// names. None of it is read by a template, so none of it sits in data() -
// Vue would put a proxy around every SVG node. It used to be a dozen loose
// fields on the component, set up in created() and reset by hand on load,
// re-index and unload; a field forgotten in one of those places kept
// detached nodes alive. One object, replaced as a whole, cannot forget one.

/**
 * @typedef {object} PageDom
 * @property {?object} page the cache entry (components/svgPageCache.js): markup, parsed nodes, staff bands
 * @property {?Map} segmentIndex elid -> nodes (M10, lib/svgIndex.js)
 * @property {Array} highlighted nodes coloured as sounding
 * @property {?Map} noteIndex `elid:staff` -> noteheads, for intonation marks
 * @property {Array<{node: object, cls: string}>} marked judged notes coloured
 * @property {Array<{node: object, cls: string}>} liveMarked the live note coloured
 * @property {Array<object>} noteItems noteheads with pitch, spelling and box (lib/noteSpellingIndex.js)
 * @property {boolean} noteItemsMeasured whether noteItems are measured for the current spellings
 * @property {?Array<object>} labelObstacles what note names must not cover, measured on first need
 * @property {Map<string, object>} labelLayouts note name layouts by zoom band
 * @property {?string} labelScaleKey the zoom band shown now
 * @property {WeakMap<object, number>} headYs vertical place of a notehead, read once
 */

/**
 * A page state with nothing loaded or indexed.
 *
 * @param {?object} [page] the cache entry this state belongs to
 * @return {PageDom}
 */
export function emptyPageDom(page = null) {
	return {
		page,
		segmentIndex: null,
		highlighted: [],
		noteIndex: null,
		marked: [],
		liveMarked: [],
		noteItems: [],
		noteItemsMeasured: false,
		labelObstacles: null,
		labelLayouts: new Map(),
		labelScaleKey: null,
		headYs: new WeakMap(),
	}
}

/**
 * Drop what was derived from the spellings - the note names and their
 * measured boxes - and keep the indexes.
 *
 * @param {PageDom} dom changed in place
 */
export function forgetSpellings(dom) {
	dom.labelObstacles = null
	dom.noteItems = []
	dom.noteItemsMeasured = false
	dom.labelLayouts.clear()
	dom.labelScaleKey = null
}
