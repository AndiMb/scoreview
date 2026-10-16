import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSilentClock } from './silentClock.js'

describe('createSilentClock', () => {
	let now
	beforeEach(() => {
		now = 1000
		vi.spyOn(performance, 'now').mockImplementation(() => now)
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('laeuft mit der Wanduhr und steht beim Pausieren', () => {
		const clock = createSilentClock(10_000)
		clock.play()
		now += 2500
		expect(clock.getCurrentTimeMs()).toBe(2500)
		clock.pause()
		now += 1000
		expect(clock.getCurrentTimeMs()).toBe(2500)
		expect(clock.isPlaying()).toBe(false)
	})

	it('haelt am Ende an', () => {
		const clock = createSilentClock(3000)
		clock.play()
		now += 5000
		expect(clock.getCurrentTimeMs()).toBe(3000)
		expect(clock.isPlaying()).toBe(false)
	})

	it('springt nach dem Ende, ohne von selbst weiterzulaufen', () => {
		const clock = createSilentClock(3000)
		clock.play()
		now += 5000
		clock.seek(1000)
		expect(clock.isPlaying()).toBe(false)
		now += 500
		expect(clock.getCurrentTimeMs()).toBe(1000)
	})

	it('springt waehrend der Wiedergabe und laeuft weiter', () => {
		const clock = createSilentClock(10_000)
		clock.play()
		now += 1000
		clock.seek(5000)
		now += 500
		expect(clock.getCurrentTimeMs()).toBe(5500)
		expect(clock.isPlaying()).toBe(true)
	})

	it('beginnt nach dem Ende von vorn', () => {
		const clock = createSilentClock(3000)
		clock.play()
		now += 5000
		clock.play()
		now += 100
		expect(clock.getCurrentTimeMs()).toBe(100)
	})

	it('meldet Spruenge und weckt die Zeitschleife', () => {
		const clock = createSilentClock(3000)
		const seeked = vi.fn()
		const wake = vi.fn()
		clock.addEventListener('seeked', seeked)
		clock.addEventListener('wake', wake)
		clock.seek(1000)
		clock.removeEventListener('seeked', seeked)
		clock.seek(2000)
		expect(seeked).toHaveBeenCalledTimes(1)
		expect(wake).toHaveBeenCalledTimes(2)
	})
})
