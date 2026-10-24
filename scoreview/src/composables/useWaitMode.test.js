import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'
// Wait mode against a fake clock and a fake microphone: where it stops, when
// it goes on, and that it leaves the player as it found it.
import { WAIT_LEAD_MS } from '../lib/waitMode.js'
import { useWaitMode } from './useWaitMode.js'

const hzOf = (pitch) => 440 * 2 ** ((pitch - 69) / 12)

// My part on channel 1: two notes; the soprano on channel 0 sounds throughout.
const NOTES = [
	{ onMs: 1000, offMs: 2000, pitch: 64, channel: 1, velocity: 90 },
	{ onMs: 2000, offMs: 3000, pitch: 67, channel: 1, velocity: 90 },
	{ onMs: 0, offMs: 4000, pitch: 72, channel: 0, velocity: 70 },
]

/** A clock whose time runs with the fake timers while it plays. */
function fakeClock() {
	const listeners = { wake: new Set(), seeked: new Set() }
	let playing = false
	let base = 0
	let startedAt = 0
	const emit = (type) => listeners[type].forEach((cb) => cb())
	const c = {
		getCurrentTimeMs: () => (playing ? base + (Date.now() - startedAt) : base),
		isPlaying: () => playing,
		play: vi.fn(async () => {
			c.releaseChord()
			startedAt = Date.now()
			playing = true
			emit('wake')
		}),
		pause: vi.fn(() => {
			base = c.getCurrentTimeMs()
			playing = false
			emit('wake')
		}),
		seek: (ms) => {
			base = ms
			startedAt = Date.now()
			emit('seeked')
			emit('wake')
		},
		holdChord: vi.fn(),
		releaseChord: vi.fn(),
		addEventListener: (type, cb) => listeners[type]?.add(cb),
		removeEventListener: (type, cb) => listeners[type]?.delete(cb),
	}
	return c
}

function setup() {
	const clock = shallowRef(fakeClock())
	const live = ref(false)
	let frameCb = null
	const intonation = {
		live,
		startLive: vi.fn(async () => {
			live.value = true
		}),
		stopLive: vi.fn(() => {
			live.value = false
		}),
		onFrames: (cb) => {
			frameCb = cb
			return () => {
				frameCb = null
			}
		},
	}
	const setMineMuted = vi.fn()
	const wait = useWaitMode({
		clock: () => clock.value,
		tempoFactor: () => 1,
		targets: () => NOTES,
		synthNotes: () => NOTES,
		myChannels: () => [1],
		intonation,
		setMineMuted,
	})
	const sing = (pitch, n = 3) => frameCb?.(Array.from({ length: n }, () => ({ hz: pitch === null ? null : hzOf(pitch), clarity: pitch === null ? 0 : 0.95 })))
	return { clock: clock.value, wait, intonation, setMineMuted, sing }
}

describe('useWaitMode', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it('stops WAIT_LEAD_MS before my next note and holds the accompaniment', async () => {
		const { clock, wait, setMineMuted } = setup()
		await wait.start()
		expect(setMineMuted).toHaveBeenCalledWith(true)
		await clock.play()
		vi.advanceTimersByTime(1000 - WAIT_LEAD_MS)
		expect(clock.pause).toHaveBeenCalledTimes(1)
		expect(wait.waiting.value).toBe(true)
		expect(clock.getCurrentTimeMs()).toBe(1000 - WAIT_LEAD_MS)
		expect(clock.holdChord).toHaveBeenCalledWith([{ channel: 0, pitch: 72, velocity: 70 }])
	})

	it('goes on after three frames on the note - not on a wrong one', async () => {
		const { clock, wait, sing } = setup()
		await wait.start()
		await clock.play()
		vi.advanceTimersByTime(1000)
		sing(65)
		expect(wait.waiting.value).toBe(true)
		sing(52) // an octave lower counts
		await nextTick()
		expect(wait.waiting.value).toBe(false)
		expect(clock.play).toHaveBeenCalledTimes(2)
		// And the next stop is planned for the following note, not this one again.
		// Resumed at 970: the stop for 2000 comes 1000 ms later.
		vi.advanceTimersByTime(999)
		expect(clock.pause).toHaveBeenCalledTimes(1)
		vi.advanceTimersByTime(2)
		expect(clock.pause).toHaveBeenCalledTimes(2)
	})

	it('does not stop when the note is already being sung', async () => {
		const { clock, wait, sing } = setup()
		await wait.start()
		await clock.play()
		vi.advanceTimersByTime(900)
		sing(64)
		vi.advanceTimersByTime(100)
		expect(clock.pause).not.toHaveBeenCalled()
	})

	it('a seek while waiting releases the chord and ends the wait, playback stays paused', async () => {
		const { clock, wait } = setup()
		await wait.start()
		await clock.play()
		vi.advanceTimersByTime(1000)
		clock.seek(0)
		expect(clock.releaseChord).toHaveBeenCalled()
		expect(wait.waiting.value).toBe(false)
		expect(clock.isPlaying()).toBe(false)
	})

	it('stopping gives back my part and the microphone it switched on', async () => {
		const { clock, wait, intonation, setMineMuted } = setup()
		await wait.start()
		await clock.play()
		vi.advanceTimersByTime(1000)
		wait.stop()
		expect(setMineMuted).toHaveBeenLastCalledWith(false)
		expect(intonation.stopLive).toHaveBeenCalled()
		expect(clock.releaseChord).toHaveBeenCalled()
		expect(wait.active.value).toBe(false)
	})

	it('ends by itself when the microphone is switched off elsewhere', async () => {
		const { wait, intonation } = setup()
		await wait.start()
		intonation.live.value = false
		await nextTick()
		expect(wait.active.value).toBe(false)
	})
})
