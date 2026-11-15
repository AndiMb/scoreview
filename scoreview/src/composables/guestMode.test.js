// A visitor of a public link has no account. Every account route answers
// such a page 401 (`share_not_allowed`), so in guest mode the composables
// that would call one must not: settings go to this browser instead, and
// what lives only in accounts (notes, leaders, setlists, sung results) is not
// asked for. The goal is a console without a single 401 on opening.
//
// The composables get exactly the switches the viewer wires
// (lib/accountScope.js). The same calls with an account are the control:
// they must reach the server, or "no request" would prove nothing - a mock
// that never sees a call passes every not.toHaveBeenCalled().
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

const axios = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
vi.mock('@nextcloud/axios', () => ({ default: axios }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (url, params = {}) => url.replace(/\{(\w+)\}/g, (_, k) => String(params[k])) }))
vi.mock('@nextcloud/l10n', () => ({ translate: (app, text) => text }))
vi.mock('../l10n.js', () => ({ translate: (app, text) => text }))
const initialState = { 'viewer-preferences': { layout: 'pages', referencePitch: 440 } }
vi.mock('../initialState.js', () => ({ readInitialState: (key, fallback = null) => initialState[key] ?? fallback }))

const { accountScope } = await import('../lib/accountScope.js')
const { useMyPart } = await import('./useMyPart.js')
const { useViewerPreferences } = await import('./useViewerPreferences.js')
const { useLeaders } = await import('./useLeaders.js')
const { useAnnotations } = await import('./useAnnotations.js')
const { useSetlist } = await import('./useSetlist.js')
const { useSingScore } = await import('./useSingScore.js')

function memoryStorage() {
	const data = new Map()
	return {
		data,
		getItem: (k) => (data.has(k) ? data.get(k) : null),
		setItem: (k, v) => data.set(k, String(v)),
		removeItem: (k) => data.delete(k),
	}
}

/** Every request any axios method was asked for, as "METHOD url". */
function requests() {
	return Object.entries(axios).flatMap(([method, fn]) => fn.mock.calls.map((call) => `${method.toUpperCase()} ${call[0]}`))
}

/**
 * Opens a score as the viewer does and changes what a person changes on
 * opening: my part, a practice setting, a display setting; the leaders,
 * notes, setlists and sung results are loaded.
 *
 * @param {ReturnType<typeof accountScope>} account
 */
async function openAndUse(account) {
	const scope = effectScope()
	const { prefs, sing } = scope.run(() => ({
		prefs: useViewerPreferences({ local: account.local }),
		sing: useSingScore({
			fileId: () => 7,
			enabled: () => true,
			intonation: { live: ref(false), startLive: vi.fn(), stopLive: vi.fn(), onScoreFrames: () => () => {} },
			notes: () => [],
			myChannels: () => [],
			measureOf: () => 1,
			loopRange: () => null,
			durationMs: () => 1000,
			isPlaying: () => false,
			waitModeActive: () => false,
			persist: account.persist,
		}),
	}))

	const myPart = useMyPart({ fileId: () => 7, local: account.local })
	await myPart.load()
	await myPart.set('P2')
	await myPart.setPractice({ transpose: -2 })

	prefs.referencePitch.value = 442
	await nextTick()
	await vi.advanceTimersByTimeAsync(1000)

	await useLeaders({ fileId: () => 7, enabled: account.enabled }).load()
	await useAnnotations({
		fileId: () => 7,
		timeline: () => null,
		measuresTimeline: () => null,
		currentEtag: () => null,
		durationMs: () => 0,
		seek: () => {},
		enabled: account.enabled,
	}).load()
	const setlist = useSetlist({ fileId: () => 7, setFileId: vi.fn(), standalone: () => false, enabled: account.enabled })
	await setlist.loadOffers()
	await sing.loadHistory()

	scope.stop()
	return { myPart, prefs, setlist }
}

describe('guest mode', () => {
	let storage

	beforeEach(() => {
		for (const fn of Object.values(axios)) {
			fn.mockReset()
			fn.mockResolvedValue({ data: {} })
		}
		storage = memoryStorage()
		vi.stubGlobal('localStorage', storage)
		// No DOM here: the theme check finds no media query and no body.
		vi.stubGlobal('window', {})
		vi.useFakeTimers()
		// The account run below answers with empty bodies; the composables
		// log what they cannot read, which is not what is tested here.
		vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it('sends a visitor\'s viewer to no account route at all', async () => {
		const { setlist } = await openAndUse(accountScope(true))
		expect(requests()).toEqual([])
		expect(setlist.canCreate.value).toBe(false)
		expect(setlist.offers.value).toEqual([])
	})

	it('reaches every one of those routes with an account (the control)', async () => {
		await openAndUse(accountScope(false))
		const sent = requests()
		for (const route of [
			'GET /apps/scoreview/api/scores/7/my-part',
			'PUT /apps/scoreview/api/scores/7/my-part',
			'PUT /apps/scoreview/api/scores/7/practice',
			'POST /apps/scoreview/api/preferences',
		]) {
			expect(sent).toContain(route)
		}
		// Leaders, notes, setlists and sung results: one GET each.
		for (const part of ['leaders', 'annotations', 'setlists', 'sing']) {
			expect(sent.some((r) => r.startsWith('GET ') && r.includes(part))).toBe(true)
		}
	})

	it('keeps "my part" and the practice settings per score in the browser', async () => {
		const account = accountScope(true)
		await openAndUse(account)

		const again = useMyPart({ fileId: () => 7, local: account.local })
		await again.load()
		expect(again.myPartId.value).toBe('P2')
		expect(again.practice.value.transpose).toBe(-2)

		const other = useMyPart({ fileId: () => 8, local: account.local })
		await other.load()
		expect(other.myPartId.value).toBe(null)
		expect(requests()).toEqual([])
	})

	it('keeps the display settings in the browser, over the defaults of the page', async () => {
		storage.data.set('scoreview.guest.prefs', JSON.stringify({ layout: 'band' }))
		const scope = effectScope()
		const prefs = scope.run(() => useViewerPreferences({ local: accountScope(true).local }))
		expect(prefs.layout.value).toBe('band')
		expect(prefs.referencePitch.value).toBe(440)

		prefs.referencePitch.value = 442
		await nextTick()
		await vi.advanceTimersByTimeAsync(1000)
		expect(JSON.parse(storage.data.get('scoreview.guest.prefs'))).toMatchObject({ layout: 'band', referencePitch: 442 })
		expect(requests()).toEqual([])
		scope.stop()
	})
})
