import { generateUrl } from '@nextcloud/router'

/**
 * The address of the app's own page for one score of a public share.
 *
 * Pure so the one place that knows the route can be tested without a page.
 * generateUrl() encodes each placeholder value, so a token with unusual
 * characters cannot break out of its path segment.
 *
 * @param {string} token The share token (@nextcloud/sharing getSharingToken())
 * @param {number|string} fileId The score's file id
 * @return {string}
 */
export function publicFrameUrl(token, fileId) {
	return generateUrl('/apps/scoreview/public/{token}/{fileId}', { token, fileId })
}
