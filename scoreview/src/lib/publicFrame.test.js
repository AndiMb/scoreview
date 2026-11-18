import { describe, expect, it } from 'vitest'
import { publicFrameUrl } from './publicFrame.js'

// Stands in for @nextcloud/router's generateUrl: placeholders, each encoded.
const generateUrl = (path, params) => '/index.php' + path.replace(/{(\w+)}/g, (_, k) => encodeURIComponent(params[k]))

describe('publicFrameUrl', () => {
	it('points at the app page for a token and a file', () => {
		expect(publicFrameUrl(generateUrl, 'abc', 42)).toMatch(/\/apps\/scoreview\/public\/abc\/42$/)
	})

	it('accepts a file id given as a string', () => {
		expect(publicFrameUrl(generateUrl, 'abc', '7')).toMatch(/\/public\/abc\/7$/)
	})

	it('hands the token to generateUrl as a placeholder value, so it gets encoded', () => {
		const url = publicFrameUrl(generateUrl, 'a/b', 1)
		expect(url).toContain('a%2Fb')
		expect(url).not.toContain('a/b')
	})
})
