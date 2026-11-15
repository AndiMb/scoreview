// @vitest-environment jsdom
// The preferences reach the viewer as initial state of the Files page - read
// once, when the page loads. The Files app opens one score after the other
// in the same page, so a second viewer must start from what the first one
// changed, not from the page's stale copy: a pin set on the first score was
// gone on the second.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

const axios = { post: vi.fn(() => Promise.resolve({ data: {} })) }
vi.mock('@nextcloud/axios', () => ({ default: axios }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (url) => url }))
const initialState = { 'viewer-preferences': { layout: 'pages', referencePitch: 440, barPins: ['mixer'] } }
vi.mock('../initialState.js', () => ({ readInitialState: (key, fallback = null) => initialState[key] ?? fallback }))

let useViewerPreferences

beforeEach(async () => {
	vi.useFakeTimers()
	window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
	vi.resetModules()
	axios.post.mockClear()
	;({ useViewerPreferences } = await import('./useViewerPreferences.js'))
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

/** Opens a viewer as ScoreViewer does: inside a scope that closing disposes. */
function open() {
	const scope = effectScope()
	const prefs = scope.run(() => useViewerPreferences())
	return { prefs, close: () => scope.stop() }
}

describe('useViewerPreferences across scores in one page', () => {
	it('starts the next viewer from what the previous one changed', async () => {
		const first = open()
		first.prefs.barPins.value = ['mixer', 'follower']
		first.prefs.layout.value = 'band'
		await nextTick()
		await vi.advanceTimersByTimeAsync(1000)
		first.close()

		const second = open()
		expect(second.prefs.barPins.value).toEqual(['mixer', 'follower'])
		expect(second.prefs.layout.value).toBe('band')
		second.close()
	})

	it('keeps a change closed before the save ran', async () => {
		const first = open()
		first.prefs.barPins.value = ['follower']
		await nextTick()
		first.close()

		const second = open()
		expect(second.prefs.barPins.value).toEqual(['follower'])
		await vi.advanceTimersByTimeAsync(1000)
		expect(axios.post).toHaveBeenCalledTimes(1)
		second.close()
	})

	it('reads the page state when nothing was changed yet', () => {
		const viewer = open()
		expect(viewer.prefs.barPins.value).toEqual(['mixer'])
		expect(viewer.prefs.referencePitch.value).toBe(440)
		viewer.close()
	})
})
