// What the microphone follower needs from a score, out of the artifacts the
// viewer already has (measures.json, meta.json, the parsed MIDI and the
// resolved mixer channels) - pure, so the viewer and the replay tools
// (tools/follow/recording.mjs) build the same reference.

import { followParts } from './followRef.js'
import { groupSystems } from './pagingPlan.js'

/**
 * Bar starts of the played-through score, one per occurrence (repeats are
 * unrolled, M7), in score time order.
 *
 * @param {{events: Array<{elid:number, timeMs:number}>}} measuresTimeline measures.json
 * @return {Array<{measure:number, pass:number, timeMs:number}>}
 */
export function barOccurrences(measuresTimeline) {
	const seen = new Map()
	return [...(measuresTimeline?.events ?? [])]
		.sort((a, b) => a.timeMs - b.timeMs)
		.map((e) => {
			const measure = e.elid + 1
			const pass = (seen.get(measure) ?? 0) + 1
			seen.set(measure, pass)
			return { measure, pass, timeMs: e.timeMs }
		})
}

/**
 * Rows of the score as the turn policy sees them: one per system and pass,
 * in score time. Systems come from the bar rectangles the same way the
 * viewer's paging finds them (lib/pagingPlan.js).
 *
 * @param {{events: Array<{elid:number, timeMs:number}>, elements: Object<string, {page:number, y:number, h:number}>}} measuresTimeline
 * @param {number} durationMs
 * @return {Array<{fromMs:number, toMs:number, page:number, system:number}>}
 */
export function systemSlices(measuresTimeline, durationMs) {
	const elements = measuresTimeline?.elements ?? {}
	const byPage = new Map()
	for (const el of Object.values(elements)) {
		if (!byPage.has(el.page)) {
			byPage.set(el.page, [])
		}
		byPage.get(el.page).push(el)
	}
	const systemsByPage = new Map([...byPage].map(([page, rects]) => [page, groupSystems(rects)]))
	const systemOf = (elid) => {
		const el = elements[String(elid)]
		if (!el) {
			return null
		}
		const index = (systemsByPage.get(el.page) ?? []).findIndex((s) => el.y < s.bottom && el.y + el.h > s.top)
		return { page: el.page, system: index }
	}
	const slices = []
	for (const e of [...(measuresTimeline?.events ?? [])].sort((a, b) => a.timeMs - b.timeMs)) {
		const where = systemOf(e.elid)
		if (!where) {
			continue
		}
		const last = slices[slices.length - 1]
		if (last && last.page === where.page && last.system === where.system) {
			continue
		}
		if (last) {
			last.toMs = e.timeMs
		}
		slices.push({ fromMs: e.timeMs, toMs: durationMs, ...where })
	}
	return slices
}

/**
 * The arguments of buildFollowReference for a score.
 *
 * @param {object} score
 * @param {Array<{onMs:number, offMs:number, pitch:number, channel:number}>} score.notes parsed MIDI notes
 * @param {Array<{timeMs:number}>} [score.markers] parsed MIDI markers (rehearsal marks)
 * @param {Array<{channel:number, partId:?string, name:string}>} score.mixerChannels lib/mixerLayout.js
 * @param {Array<object>} score.metaParts meta.json parts
 * @param {{events: Array<{elid:number, timeMs:number}>, elements: object}} score.measuresTimeline measures.json
 * @param {number} score.durationMs
 * @return {{notes: object[], parts: object[], options: object}}
 */
export function followReferenceInput({ notes, markers = [], mixerChannels, metaParts, measuresTimeline, durationMs }) {
	const bars = barOccurrences(measuresTimeline)
	const total = Math.max(durationMs, bars.at(-1)?.timeMs ?? 0)
	return {
		notes,
		parts: followParts(mixerChannels, metaParts ?? []),
		options: {
			durationMs: total,
			markersMs: markers.map((m) => m.timeMs),
			measureStartsMs: bars.map((b) => b.timeMs),
			measureIds: bars.map((b) => b.measure),
			systemStartsMs: systemSlices(measuresTimeline, total).map((x) => x.fromMs),
		},
	}
}
