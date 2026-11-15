// A visitor of a public link has no account. Every account route answers
// such a page 401 (`share_not_allowed`), so in guest mode the composables
// that would call one must not: settings go to this browser instead, and
// what lives only in accounts (notes, leaders, setlists) is not asked for.
// The goal is a console without a single 401 on opening.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

const axiosGet = vi.fn()
const axiosPost = vi.fn()
const axiosPut = vi.fn()
vi.mock('@nextcloud/axios', () => ({ default: { get: axiosGet, post: axiosPost, put: axiosPut, delete: vi.fn() } }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (url) => url }))
vi.mock('@nextcloud/l10n', () => ({ translate: (app, text) => text }))
vi.mock('../l10n.js', () => ({ translate: (app, text) => text }))
const initialState = { 'viewer-preferences': { layout: 'pages', referencePitch: 440 } }
vi.mock('../initialState.js', () => ({ readInitialState: (key, fallback = null) => initialState[key] ?? fallback }))

const { useMyPart } = await import('./useMyPart.js')
const { useViewerPreferences } = await import('./useViewerPreferences.js')
const { useLeaders } = await import('./useLeaders.js')
const { useAnnotations } = await import('./useAnnotations.js')
const { useSetlist } = await import('./useSetlist.js')

function memoryStorage() {
	const data = new Map()
	return {
		data,
		getItem: (k) => (data.has(k) ? data.get(k) : null),
		setItem: (k, v) => data.set(k, String(v)),
		removeItem: (k) => data.delete(k),
	}
}

describe('guest mode', () => {
	let storage

	beforeEach(() => {
		axiosGet.mockReset()
		axiosPost.mockReset()
		axiosPut.mockReset()
		storage = memoryStorage()
		vi.stubGlobal('localStorage', storage)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})

	it('keeps "my part" and the practice settings per score in the browser', async () => {
		const first = useMyPart({ fileId: () => 7, local: () => true })
		await first.load()
		expect(first.myPartId.value).toBe(null)
		await first.set('P2')
		await first.setPractice({ transpose: -2 })

		const again = useMyPart({ fileId: () => 7, local: () => true })
		await again.load()
		expect(again.myPartId.value).toBe('P2')
		expect(again.practice.value.transpose).toBe(-2)

		const other = useMyPart({ fileId: () => 8, local: () => true })
		await other.load()
		expect(other.myPartId.value).toBe(null)
		expect(axiosGet).not.toHaveBeenCalled()
		expect(axiosPut).not.toHaveBeenCalled()
	})

	it('keeps the display settings in the browser, over the defaults of the page', async () => {
		vi.useFakeTimers()
		// No DOM here: the theme check finds no media query and no body.
		vi.stubGlobal('window', {})
		storage.data.set('scoreview.guest.prefs', JSON.stringify({ layout: 'band' }))
		const scope = effectScope()
		const prefs = scope.run(() => useViewerPreferences({ local: () => true }))
		expect(prefs.layout.value).toBe('band')
		expect(prefs.referencePitch.value).toBe(440)

		prefs.referencePitch.value = 442
		await nextTick()
		await vi.advanceTimersByTimeAsync(1000)
		expect(JSON.parse(storage.data.get('scoreview.guest.prefs'))).toMatchObject({ layout: 'band', referencePitch: 442 })
		expect(axiosPost).not.toHaveBeenCalled()
		scope.stop()
	})

	it('asks for no leaders, notes or setlists', async () => {
		const leaders = useLeaders({ fileId: () => 7, enabled: () => false })
		await leaders.load()
		const annotations = useAnnotations({
			fileId: () => 7,
			timeline: () => null,
			measuresTimeline: () => null,
			currentEtag: () => null,
			durationMs: () => 0,
			seek: () => {},
			enabled: () => false,
		})
		await annotations.load()
		const setlist = useSetlist({ fileId: () => 7, setFileId: vi.fn(), standalone: () => false, enabled: () => false })
		await setlist.loadOffers()

		expect(axiosGet).not.toHaveBeenCalled()
		expect(setlist.canCreate.value).toBe(false)
		expect(setlist.offers.value).toEqual([])
	})
})
