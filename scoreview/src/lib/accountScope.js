/**
 * What a viewer without an account hands the composables that would talk to
 * one - a visitor of a public link (Controller\PageController::publicViewer).
 *
 * Every account route answers such a page 401 (`share_not_allowed`), so the
 * three switches say what the composables are about, not who is looking:
 * - `local`: settings go to this browser (useMyPart, useViewerPreferences),
 * - `enabled`: nothing that lives only in accounts is asked for (useLeaders,
 *   useAnnotations, useSetlist),
 * - `persist`: a sung run is shown, not stored (useSingScore).
 *
 * One table instead of `guest` spelled out at every call site, so the rule
 * the viewer wires is the rule composables/guestMode.test.js checks.
 *
 * @param {boolean} guest
 * @return {{local: () => boolean, enabled: () => boolean, persist: () => boolean}}
 */
export function accountScope(guest) {
	const visitor = guest === true
	return Object.freeze({
		local: () => visitor,
		enabled: () => !visitor,
		persist: () => !visitor,
	})
}
