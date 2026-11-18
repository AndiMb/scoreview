import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRIEF_TONE_MS, createBriefTone } from './briefTone.js'

describe('createBriefTone', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	it('stops the tone after its time', async () => {
		const stop = vi.fn()
		const tone = createBriefTone({ start: vi.fn(), stop })
		await tone.sound(60)
		vi.advanceTimersByTime(BRIEF_TONE_MS - 1)
		expect(stop).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(stop).toHaveBeenCalledTimes(1)
	})

	it('does not let an earlier timer cut a later tone short', async () => {
		const stop = vi.fn()
		const tone = createBriefTone({ start: vi.fn(), stop })
		await tone.sound(60)
		vi.advanceTimersByTime(500)
		await tone.sound(62)
		vi.advanceTimersByTime(500)
		expect(stop).not.toHaveBeenCalled()
		vi.advanceTimersByTime(BRIEF_TONE_MS - 500)
		expect(stop).toHaveBeenCalledTimes(1)
	})

	it('lets the newer tone own the stop when starts overlap', async () => {
		const stop = vi.fn()
		let release
		const start = vi.fn()
			.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
			.mockImplementationOnce(() => undefined)
		const tone = createBriefTone({ start, stop })
		const first = tone.sound(60)
		await tone.sound(62)
		vi.advanceTimersByTime(300)
		release()
		await first
		// Only the second call's timer exists: it fires at 700 ms, not 1000.
		vi.advanceTimersByTime(BRIEF_TONE_MS - 300)
		expect(stop).toHaveBeenCalledTimes(1)
		vi.advanceTimersByTime(BRIEF_TONE_MS)
		expect(stop).toHaveBeenCalledTimes(1)
	})

	it('cancel drops a pending stop', async () => {
		const stop = vi.fn()
		const tone = createBriefTone({ start: vi.fn(), stop })
		await tone.sound(60)
		tone.cancel()
		vi.advanceTimersByTime(BRIEF_TONE_MS * 2)
		expect(stop).not.toHaveBeenCalled()
	})
})
