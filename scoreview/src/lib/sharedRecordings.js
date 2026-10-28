// Recordings a leader released to parts (docs/architecture.md E21) - who
// sees which, pure. The same rule as part annotations (annotationFilter.js):
// the server hands them to everyone with access to the score; which part
// someone sings is a matter of display, not of access.

import { classify, DIM, HIDE, targetNames } from './annotationFilter.js'

/**
 * @param {Array<{id:number, sharedParts:Array<{id:string, name:string}>}>} recordings
 *   the `shared` list of the recordings API
 * @param {?(string|number)} myPartId
 * @param {Array<{id:(string|number), name:string}>} parts meta.parts
 * @param {boolean} isLeader leaders see every one, like every part note
 * @return {Array<object>} the recordings to list, each with `dimmed` and
 *   `voices` (the names of its parts)
 */
export function visibleSharedRecordings(recordings, myPartId, parts, isLeader) {
	return (recordings ?? [])
		.map((r) => {
			const asNote = { visibility: 'parts', targetParts: r.sharedParts ?? [] }
			return {
				...r,
				display: classify(asNote, myPartId, parts, isLeader),
				voices: targetNames(asNote, parts),
			}
		})
		.filter((r) => r.display !== HIDE)
		// The own part's first: that is what someone opens the list for.
		.sort((a, b) => (a.display === DIM) - (b.display === DIM))
		.map(({ display, ...r }) => ({ ...r, dimmed: display === DIM }))
}
