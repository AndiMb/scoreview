import { describe, expect, it } from 'vitest'
import { createWakeWindow, SETTLE_MS } from './timeLoopWake.js'

describe('timeLoopWake', () => {
	it('sleeps when nothing has happened', () => {
		const w = createWakeWindow()
		expect(w.shouldRun({ playing: false, following: false, nowMs: 0 })).toBe(false)
	})

	it('runs for the settle window after a wake and then sleeps', () => {
		const w = createWakeWindow(1000)
		w.wake(5000)
		expect(w.shouldRun({ playing: false, following: false, nowMs: 5999 })).toBe(true)
		expect(w.shouldRun({ playing: false, following: false, nowMs: 6000 })).toBe(false)
	})

	it('extends the window with a later wake but never shortens it', () => {
		const w = createWakeWindow(1000)
		w.wake(5000)
		w.wake(5500)
		expect(w.shouldRun({ playing: false, following: false, nowMs: 6400 })).toBe(true)
		w.wake(3000)
		expect(w.shouldRun({ playing: false, following: false, nowMs: 6400 })).toBe(true)
	})

	it('keeps running while playing or following, whatever the window says', () => {
		const w = createWakeWindow()
		expect(w.shouldRun({ playing: true, following: false, nowMs: 1e9 })).toBe(true)
		expect(w.shouldRun({ playing: false, following: true, nowMs: 1e9 })).toBe(true)
	})

	it('runs out after the end of a piece: playing turns false, the window decides', () => {
		const w = createWakeWindow()
		w.wake(0)
		expect(w.shouldRun({ playing: true, following: false, nowMs: 60000 })).toBe(true)
		expect(w.shouldRun({ playing: false, following: false, nowMs: 60001 })).toBe(false)
	})

	it('uses a settle window of one second by default', () => {
		expect(SETTLE_MS).toBe(1000)
	})
})
