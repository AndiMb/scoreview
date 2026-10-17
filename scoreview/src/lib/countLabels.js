// Beat numbers over the notes (B1): which beat of its measure a chord stands
// on, from the engine's ticks - the notated tick of the chord's segment and
// the time signature and length of its measure (E12, measureFacts). Pure,
// no DOM: the page (countLayout.js) only puts the text next to the notehead.
//
// Ticks, not milliseconds: a chord on beat 3 is 960 ticks into a 4/4
// measure whatever the tempo does, and a ritardando would turn a time-based
// guess into "2.9". The MIDI fallback of the meters has no per-chord ticks,
// so counting needs the engine (capabilities.js, `meters`).

/** How the viewer may show beat numbers: not at all, on my staff, on all. */
export const COUNT_MODES = Object.freeze(['off', 'mine', 'all'])

const EPSILON = 1e-6

/**
 * The count of a position within a measure, as a singer would say it:
 * "1 2 3 4" on the beats, "+" on the halves between them in simple metres;
 * in compound metres every eighth gets its number ("1 2 3 4 5 6" in 6/8),
 * since that is how they are counted when subdivided at all. Anything off
 * that grid - triplets, sixteenths, a dotted figure's second half - stays
 * blank: a wrong number is worse than none.
 *
 * A pickup is counted from its end, so the last quarter of a one-quarter
 * pickup in 4/4 is "4", not "1" - that is the beat the music is on.
 *
 * @param {{n:number, d:number, beats:number, beatTicks:number, subdivisions:number, ticks:number, pickup:boolean}} meter
 * @param {number} posTicks ticks from the start of the measure
 * @return {string} the text, or '' for off-grid
 */
export function countText(meter, posTicks) {
	const nominalTicks = (meter.n * 1920) / meter.d
	const shift = meter.pickup ? nominalTicks - meter.ticks : 0
	const g = (posTicks + shift) / meter.beatTicks
	const beat = Math.floor(g + EPSILON)
	const frac = g - beat
	const compound = meter.subdivisions === 3
	if (Math.abs(frac) < EPSILON) {
		return String(compound ? beat * 3 + 1 : beat + 1)
	}
	const sub = frac * meter.subdivisions
	const subIndex = Math.round(sub)
	if (Math.abs(sub - subIndex) > EPSILON || subIndex <= 0 || subIndex >= meter.subdivisions) {
		return ''
	}
	return compound ? String(beat * 3 + subIndex + 1) : '+'
}

/**
 * The count of every chord, by elid. One voice only: the numbers belong
 * to the melody line a singer reads, and a second voice on the same staff
 * would print its own numbers over the same beats.
 *
 * @param {object} input
 * @param {Array<object>} input.meters scoreFacts.metersFromArtifacts, engine source (tick set)
 * @param {?Array<{elid:number, voice:number, tick?:number}>} input.spellings meta.noteSpellings
 * @param {number} [input.voice] 0 = first voice
 * @return {Map<number, string>} elid → text; chords off the grid are absent
 */
export function countLabels({ meters, spellings, voice = 0 }) {
	const out = new Map()
	const measures = (meters ?? []).filter((m) => Number.isFinite(m?.tick) && m.ticks > 0)
	if (measures.length === 0 || !Array.isArray(spellings)) {
		return out
	}
	for (const s of spellings) {
		if (s.voice !== voice || !Number.isInteger(s.tick) || out.has(s.elid)) {
			continue
		}
		const meter = measureAt(measures, s.tick)
		if (!meter) {
			continue
		}
		const text = countText(meter, s.tick - meter.tick)
		if (text !== '') {
			out.set(s.elid, text)
		}
	}
	return out
}

/**
 * @param {Array<object>} measures sorted by tick
 * @param {number} tick
 * @return {?object}
 */
function measureAt(measures, tick) {
	let lo = 0
	let hi = measures.length - 1
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1
		if (measures[mid].tick <= tick) {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	const m = measures[lo]
	return m && tick >= m.tick && tick < m.tick + m.ticks ? m : null
}
