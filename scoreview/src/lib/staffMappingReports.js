/**
 * Whether "my part" can be marked: each page reports whether its staves map
 * to parts (lib/staffBands.js), and the answer for the score is "yes" as soon
 * as one page says so. A page that cannot map - a system with a staff left
 * out, an interlude for fewer parts - only skips the marking on itself
 * (ScorePage's partsMappable). Taking the last report instead let the page
 * that happened to load last switch the control off for the whole score.
 *
 * @return {{report: (page: number, possible: boolean) => boolean, clear: () => void}}
 */
export function createStaffMappingReports() {
	const byPage = new Map()
	return {
		/**
		 * @param {number} page index of the reporting page
		 * @param {boolean} possible
		 * @return {boolean} whether any page can map now
		 */
		report(page, possible) {
			byPage.set(page, possible === true)
			return [...byPage.values()].some(Boolean)
		},
		clear() {
			byPage.clear()
		},
	}
}
