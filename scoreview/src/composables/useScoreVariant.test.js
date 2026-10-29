import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

vi.mock('@nextcloud/l10n', () => ({ translate: (app, text) => text }))

const { useScoreVariant } = await import('./useScoreVariant.js')

const meta = {
	parts: [{ id: '1', name: 'Sopran' }, { id: '3', name: 'Klarinette in B' }],
	excerpts: [{ id: 0, name: 'Sopran', partIds: ['1'] }],
	hasTransposingParts: true,
}

/**
 * A viewer around the composable: the base arrives, the person chooses,
 * the picture follows - or stays, with a reason.
 */
function viewer({ supported = true, answer = (key) => ({ status: 'ready', variant: key, files: {} }), apply = null } = {}) {
	const state = {
		meta: ref(null),
		practice: ref({ source: 'full', concert: false, transposeNotation: false }),
		transpose: ref(0),
		shown: ref(null),
		requests: [],
		applied: [],
	}
	const variant = useScoreVariant({
		fileId: () => 7,
		meta: () => state.meta.value,
		myPartId: () => null,
		practice: () => state.practice.value,
		setPractice: (changes) => { state.practice.value = { ...state.practice.value, ...changes } },
		transpose: () => state.transpose.value,
		supported: () => supported,
		requestVariant: async (key) => {
			state.requests.push(key)
			return answer(key)
		},
		applyPicture: apply ?? (async (a) => {
			state.applied.push(a?.variant ?? null)
			state.shown.value = a?.variant ?? null
			return true
		}),
		shownKey: () => state.shown.value,
		viewportWidth: () => 1200,
	})
	return { state, variant }
}

async function settle() {
	await nextTick()
	await vi.advanceTimersByTimeAsync(500)
}

describe('useScoreVariant', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		// The tests run without a DOM: a localStorage of their own.
		const store = new Map()
		vi.stubGlobal('window', {
			innerWidth: 1200,
			localStorage: {
				getItem: (k) => (store.has(k) ? store.get(k) : null),
				setItem: (k, v) => store.set(k, String(v)),
				removeItem: (k) => store.delete(k),
			},
		})
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it('asks for nothing while the score is the file\'s own', async () => {
		const { state } = viewer()
		state.meta.value = meta
		await settle()
		expect(state.requests).toEqual([])
	})

	it('shows the chosen part and goes back to the score', async () => {
		const { state, variant } = viewer()
		state.meta.value = meta
		variant.setSource('ex0')
		await settle()
		expect(state.applied).toEqual(['ex0~orig~w~0'])
		variant.setSource('full')
		await settle()
		expect(state.applied).toEqual(['ex0~orig~w~0', null])
	})

	it('keeps the page format per device and the rest per score', async () => {
		const { state, variant } = viewer()
		state.meta.value = meta
		variant.setFormat('phone')
		await settle()
		expect(window.localStorage.getItem('scoreview-variant-format')).toBe('phone')
		expect(state.practice.value.source).toBe('full')
		expect(state.shown.value).toBe('full~phone~w~0')
		expect(window.localStorage.getItem('scoreview-variant.7')).toBe('full~phone~w~0')
	})

	it('transposes the notation with the sound, once the steps have settled', async () => {
		const { state, variant } = viewer()
		state.meta.value = meta
		variant.setTransposeNotation(true)
		state.transpose.value = -1
		await nextTick()
		state.transpose.value = -2
		await settle()
		expect(state.requests).toEqual(['full~orig~w~-2'])
	})

	it('asks for concert pitch only where something transposes', async () => {
		const { state, variant } = viewer()
		state.meta.value = { ...meta, hasTransposingParts: false }
		variant.setConcert(true)
		await settle()
		expect(state.requests).toEqual([])
	})

	it('falls back to the score and says why, keeping the choice', async () => {
		const { state, variant } = viewer({ answer: (key) => ({ status: 'error', variant: key, errorCode: 'rate_limited' }) })
		state.meta.value = meta
		variant.setSource('part3')
		await settle()
		expect(variant.status.value).toBe('error')
		expect(variant.errorText.value).toMatch(/Too many/)
		expect(state.shown.value).toBeNull()
		expect(state.practice.value.source).toBe('part3')
	})

	it('lets the hint be dismissed and tried again', async () => {
		let fail = true
		const { state, variant } = viewer({
			answer: (key) => (fail
				? { status: 'error', variant: key, errorCode: 'unknown' }
				: { status: 'ready', variant: key, files: {} }),
		})
		state.meta.value = meta
		variant.setSource('part3')
		await settle()
		variant.dismissError()
		expect(variant.status.value).toBe('idle')
		expect(state.practice.value.source).toBe('part3')

		fail = false
		await variant.retry()
		expect(variant.status.value).toBe('idle')
		expect(state.shown.value).toBe(state.requests.at(-1))
	})

	it('says nothing when the score was switched while the picture loaded', async () => {
		let release
		// The session drops the picture once the score has changed meanwhile.
		const { state, variant } = viewer({
			apply: () => new Promise((resolve) => {
				release = resolve
			}),
		})
		state.meta.value = meta
		variant.setSource('part3')
		await settle()
		variant.reset()
		release(false)
		await vi.advanceTimersByTimeAsync(0)
		expect(variant.status.value).toBe('idle')
	})

	it('only says it is unavailable where the server cannot', async () => {
		const { state, variant } = viewer({ supported: false })
		state.meta.value = meta
		variant.setSource('ex0')
		await settle()
		expect(state.requests).toEqual([])
		expect(variant.unavailableReason.value).not.toBe('')
	})

	it('forgets a stored part the new version of the file no longer has', async () => {
		const { state, variant } = viewer()
		state.practice.value = { source: 'ex4', concert: false, transposeNotation: false }
		state.meta.value = meta
		await settle()
		expect(variant.source.value).toBe('full')
		expect(state.requests).toEqual([])
	})
})
