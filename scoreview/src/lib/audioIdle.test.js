import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioIdle } from './audioIdle.js'

describe('audioIdle', () => {
	let playing
	let suspend
	let resume
	let idle

	beforeEach(() => {
		vi.useFakeTimers()
		playing = false
		suspend = vi.fn()
		resume = vi.fn()
		idle = createAudioIdle({ isPlaying: () => playing, suspend, resume, idleMs: 3000 })
	})

	it('rests idleMs after settle when nothing plays and nobody holds it', () => {
		idle.settle()
		vi.advanceTimersByTime(2999)
		expect(suspend).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(suspend).toHaveBeenCalledTimes(1)
	})

	it('never rests while playing, and rests after the piece ends by itself', async () => {
		playing = true
		await idle.wake()
		vi.advanceTimersByTime(30000)
		expect(suspend).not.toHaveBeenCalled()
		playing = false // end of the piece - nobody calls anything
		vi.advanceTimersByTime(3000)
		expect(suspend).toHaveBeenCalledTimes(1)
	})

	it('wakes the context and keeps it awake while held', async () => {
		const release = idle.hold('microphone')
		await release.ready
		expect(resume).toHaveBeenCalledTimes(1)
		vi.advanceTimersByTime(60000)
		expect(suspend).not.toHaveBeenCalled()
		release()
		vi.advanceTimersByTime(3000)
		expect(suspend).toHaveBeenCalledTimes(1)
	})

	it('counts holders: rests only after the last one lets go', () => {
		const a = idle.hold('microphone')
		const b = idle.hold('count-in')
		a()
		vi.advanceTimersByTime(10000)
		expect(suspend).not.toHaveBeenCalled()
		expect(idle.holders).toEqual(['count-in'])
		b()
		vi.advanceTimersByTime(3000)
		expect(suspend).toHaveBeenCalledTimes(1)
	})

	it('ignores a second release of the same hold', () => {
		const a = idle.hold('microphone')
		const b = idle.hold('tone')
		a()
		a()
		expect(idle.holders).toEqual(['tone'])
		vi.advanceTimersByTime(10000)
		expect(suspend).not.toHaveBeenCalled()
		b()
	})

	it('cancels a pending rest when woken again', async () => {
		idle.settle()
		vi.advanceTimersByTime(2000)
		playing = true
		await idle.wake()
		vi.advanceTimersByTime(2000)
		expect(suspend).not.toHaveBeenCalled()
	})

	it('does nothing after destroy', () => {
		idle.settle()
		idle.destroy()
		vi.advanceTimersByTime(10000)
		expect(suspend).not.toHaveBeenCalled()
	})
})
