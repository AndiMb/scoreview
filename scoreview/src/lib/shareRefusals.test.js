import { describe, expect, it } from 'vitest'
import { isShareRefusal, shareRefusalText } from './shareRefusals.js'

const t = (text) => text

describe('shareRefusals', () => {
	it('knows every code the server sends for a link request', () => {
		// Service\PublicShareException, DirectAccessMiddleware, the controllers' quota.
		for (const code of ['public_disabled', 'share_invalid', 'share_auth', 'share_no_read', 'share_not_allowed', 'share_quota', 'share_throttled', 'not_found']) {
			expect(isShareRefusal(code)).toBe(true)
			expect(shareRefusalText(code, t)).toMatch(/\.$/)
		}
	})

	it('gives the not_found refusal a sentence of its own', () => {
		expect(shareRefusalText('not_found', t)).toMatch(/^This score can no longer be found/)
	})

	it('groups link problems and the quota into two pieces of advice', () => {
		expect(shareRefusalText('share_no_read', t)).toBe(shareRefusalText('share_invalid', t))
		expect(shareRefusalText('public_disabled', t)).toBe(shareRefusalText('share_auth', t))
		expect(shareRefusalText('share_throttled', t)).toBe(shareRefusalText('share_quota', t))
		expect(shareRefusalText('share_quota', t)).not.toBe(shareRefusalText('share_auth', t))
	})

	it('leaves every other code to the caller', () => {
		for (const code of ['too_large', 'unknown', '', null, undefined, 'toString', '__proto__']) {
			expect(isShareRefusal(code)).toBe(false)
			expect(shareRefusalText(code, t)).toBeNull()
		}
	})
})
