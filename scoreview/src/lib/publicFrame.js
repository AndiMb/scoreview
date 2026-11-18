/**
 * The address of the app's own page for one score of a public share.
 *
 * Pure so the one place that knows the route can be tested without a page;
 * the caller passes Nextcloud's generateUrl (@nextcloud/router), which keeps
 * lib/ free of Nextcloud imports. generateUrl() encodes each placeholder
 * value, so a token with unusual characters cannot break out of its path
 * segment.
 *
 * @param {(path: string, params: object) => string} generateUrl from @nextcloud/router
 * @param {string} token The share token (@nextcloud/sharing getSharingToken())
 * @param {number|string} fileId The score's file id
 * @return {string}
 */
export function publicFrameUrl(generateUrl, token, fileId) {
	return generateUrl('/apps/scoreview/public/{token}/{fileId}', { token, fileId })
}
