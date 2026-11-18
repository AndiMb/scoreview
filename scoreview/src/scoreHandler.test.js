import { describe, expect, it, vi } from 'vitest'

// The handler registration shared by the Files and public-share entries.

vi.mock('@nextcloud/files', () => ({ DefaultType: { DEFAULT: 'default' }, registerFileAction: vi.fn() }))

describe('registerScoreHandler', () => {
	it('passes a group only when asked, so Files keeps its single-file viewer', async () => {
		const registerHandler = vi.fn()
		vi.stubGlobal('OCA', { Viewer: { registerHandler } })
		const { registerScoreHandler } = await import('./scoreHandler.js')
		registerScoreHandler({ name: 'A' })
		registerScoreHandler({ name: 'B' }, { group: 'scoreview' })
		expect(registerHandler.mock.calls[0][0]).not.toHaveProperty('group')
		expect(registerHandler.mock.calls[1][0].group).toBe('scoreview')
		vi.unstubAllGlobals()
	})
})
