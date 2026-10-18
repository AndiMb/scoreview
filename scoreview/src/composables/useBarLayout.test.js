// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useBarLayout } from './useBarLayout.js'

const IDLE_MS = 3000

/** jsdom has no ResizeObserver; this one lets the test report a size. */
let resize = null
class FakeResizeObserver {
	constructor(callback) {
		resize = (width, height) => callback([{ contentRect: { width, height } }])
	}

	observe() {}
	disconnect() {}
}

/**
 * @param {object} [overrides] initial values of the inputs
 * @return {object} the composable plus its inputs as refs
 */
function setup(overrides = {}) {
	const inputs = {
		fullscreen: ref(false),
		playing: ref(false),
		performance: ref(false),
		following: ref(false),
		busy: ref(false),
	}
	for (const [key, value] of Object.entries(overrides)) {
		inputs[key].value = value
	}
	const bar = useBarLayout({
		rootEl: () => document.createElement('div'),
		isFullscreen: () => inputs.fullscreen.value,
		isPlaying: () => inputs.playing.value,
		isPerformance: () => inputs.performance.value,
		isFollowing: () => inputs.following.value,
		isBusy: () => inputs.busy.value,
		contentKey: () => '',
	})
	bar.observe()
	return { bar, ...inputs }
}

/**
 * A phone in landscape: the compact bar is 53 px of a 290 px viewer.
 *
 * @param {object} bar the composable
 */
function phoneLandscape(bar) {
	resize(844, 290)
	bar.reportHeight(53)
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
	resize = null
})

describe('useBarLayout collapse', () => {
	it('retracts during playback on a tight viewer without fullscreen', async () => {
		const { bar, playing } = setup()
		phoneLandscape(bar)
		expect(bar.tight.value).toBe(true)
		playing.value = true
		await nextTick()
		vi.advanceTimersByTime(IDLE_MS)
		expect(bar.collapsed.value).toBe(true)
	})

	it('stays on a roomy viewer without fullscreen', async () => {
		const { bar, playing } = setup()
		resize(400, 800)
		bar.reportHeight(53)
		playing.value = true
		await nextTick()
		vi.advanceTimersByTime(IDLE_MS)
		expect(bar.collapsed.value).toBe(false)
	})

	it('retracts in performance mode and while following, also in fullscreen', async () => {
		for (const input of ['performance', 'following']) {
			const ctx = setup({ fullscreen: true })
			ctx[input].value = true
			await nextTick()
			vi.advanceTimersByTime(IDLE_MS)
			expect(ctx.bar.collapsed.value).toBe(true)
		}
	})

	it('comes back when the reason ends', async () => {
		const { bar, playing } = setup()
		phoneLandscape(bar)
		playing.value = true
		await nextTick()
		vi.advanceTimersByTime(IDLE_MS)
		playing.value = false
		await nextTick()
		expect(bar.collapsed.value).toBe(false)
	})

	it('stays tight while retracted, although the bar is then only a line', async () => {
		const { bar, playing } = setup()
		phoneLandscape(bar)
		playing.value = true
		await nextTick()
		vi.advanceTimersByTime(IDLE_MS)
		// the line is gone from the bar's observer; only the viewer reports
		resize(844, 292)
		expect(bar.tight.value).toBe(true)
		expect(bar.collapsed.value).toBe(true)
	})

	it('waits while a popover of the bar is open', async () => {
		const { bar, playing, busy } = setup({ busy: true })
		phoneLandscape(bar)
		playing.value = true
		await nextTick()
		vi.advanceTimersByTime(IDLE_MS)
		expect(bar.collapsed.value).toBe(false)
		busy.value = false
		vi.advanceTimersByTime(IDLE_MS)
		expect(bar.collapsed.value).toBe(true)
	})

	it('restarts the idle period after a tap on the line', async () => {
		const { bar, playing } = setup()
		phoneLandscape(bar)
		playing.value = true
		await nextTick()
		vi.advanceTimersByTime(IDLE_MS)
		bar.show()
		expect(bar.collapsed.value).toBe(false)
		vi.advanceTimersByTime(IDLE_MS - 1)
		expect(bar.collapsed.value).toBe(false)
		vi.advanceTimersByTime(1)
		expect(bar.collapsed.value).toBe(true)
	})
})
