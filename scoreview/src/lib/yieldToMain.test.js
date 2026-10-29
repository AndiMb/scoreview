import { afterEach, describe, expect, it, vi } from 'vitest'
import { yieldToMain } from './yieldToMain.js'

describe('yieldToMain', () => {
	afterEach(() => {
		delete globalThis.scheduler
		vi.useRealTimers()
	})

	it('nimmt scheduler.yield(), wo es das gibt', async () => {
		const y = vi.fn(() => Promise.resolve())
		globalThis.scheduler = { yield: y }
		await yieldToMain()
		expect(y).toHaveBeenCalledTimes(1)
	})

	it('wartet sonst eine Runde der Ereignisschleife ab', async () => {
		vi.useFakeTimers()
		let done = false
		yieldToMain().then(() => {
			done = true
		})
		await Promise.resolve()
		expect(done).toBe(false)
		await vi.runAllTimersAsync()
		expect(done).toBe(true)
	})
})
