import axios from '@nextcloud/axios'
import { buildTimeline } from '../lib/scoreLayout.js'

/**
 * The three JSON artifacts of a conversion or a display variant (E19),
 * fetched together and built for use. Viewer and print page load the base
 * and a variant through this one door, so a fourth artifact or a change in
 * how timelines are built cannot reach one of them and miss the other.
 *
 * @param {object} files the `files` of a status or variant answer
 * @param {string} files.timingJson
 * @param {string} files.measuresJson
 * @param {string} files.metaJson
 * @param {string[]} files.pages
 * @return {Promise<{timeline: object, measures: object, meta: object, pages: string[]}>}
 */
export async function loadPictureArtifacts(files) {
	const [timingRes, measuresRes, metaRes] = await Promise.all([
		axios.get(files.timingJson),
		axios.get(files.measuresJson),
		axios.get(files.metaJson),
	])
	return {
		timeline: buildTimeline(timingRes.data),
		measures: buildTimeline(measuresRes.data),
		meta: metaRes.data,
		pages: files.pages,
	}
}
