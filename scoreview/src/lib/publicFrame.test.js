import { describe, expect, it, vi } from 'vitest'

vi.mock('@nextcloud/router', () => ({
	generateUrl: (path, params) => '/index.php' + path.replace(/{(\w+)}/g, (_, k) => encodeURIComponent(params[k])),
}))

import { publicFrameUrl } from './publicFrame.js'

describe('publicFrameUrl', () => {
	it('points at the app page for a token and a file', () => {
		expect(publicFrameUrl('abc', 42)).toMatch(/\/apps\/scoreview\/public\/abc\/42$/)
	})

	it('accepts a file id given as a string', () => {
		expect(publicFrameUrl('abc', '7')).toMatch(/\/public\/abc\/7$/)
	})

	it('encodes a token containing a slash', () => {
		const url = publicFrameUrl('a/b', 1)
		expect(url).toContain('a%2Fb')
		expect(url).not.toContain('a/b')
	})
})
