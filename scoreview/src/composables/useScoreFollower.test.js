// @vitest-environment jsdom
// Nothing moves before the singer taps the starting place: in a rehearsal
// the follower that found a place by itself was the one that jumped from
// the middle of a piece to its end. wait() goes back to that state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../l10n.js', () => ({ translate: (app, text) => text }))

let worker
class FakeWorker {
	constructor() {
		this.posted = []
		worker = this
	}

	postMessage(message) {
		this.posted.push(message)
	}

	terminate() {}

	/** A report of the follower inside, for a frame heard at atMs. */
	report(atMs, shownMs, phase = 'following') {
		this.onmessage({ data: { type: 'state', atMs, phase, shownMs, tempoRatio: 1 } })
	}
}

const { useScoreFollower } = await import('./useScoreFollower.js')

function setup() {
	const analysers = []
	const context = {
		currentTime: 0,
		sampleRate: 48000,
		createAnalyser: () => {
			const analyser = { connect() {}, disconnect: vi.fn(), frequencyBinCount: 8, getFloatFrequencyData: vi.fn(), fftSize: 2048 }
			analysers.push(analyser)
			return analyser
		},
	}
	// The shared microphone source: who hangs on it.
	const source = {
		attached: new Set(),
		connect(node) {
			this.attached.add(node)
		},
		disconnect(node) {
			if (node === undefined) {
				this.attached.clear()
			} else {
				this.attached.delete(node)
			}
		},
	}
	const microphone = {
		acquire: vi.fn(async () => ({ context, source })),
		release: vi.fn(),
	}
	let getter = null
	const follower = useScoreFollower({
		microphone,
		input: async () => ({ notes: [], parts: [], options: {} }),
		followTime: (g) => {
			getter = g
		},
	})
	const shown = () => getter?.()
	const at = (seconds) => {
		context.currentTime = seconds
	}
	const frames = () => worker.posted.filter((m) => m.type === 'frame')
	return { follower, shown, at, source, analysers, frames }
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

describe('useScoreFollower', () => {
	it('shows nothing the follower finds before the tap', async () => {
		const { follower, shown, at } = setup()
		await follower.start()
		expect(follower.phase.value).toBe('waiting')
		at(5)
		worker.report(5000, 42000)
		expect(follower.phase.value).toBe('waiting')
		expect(shown()).toBeNaN()
		follower.destroy()
	})

	it('follows from the tapped place, and ignores reports from before the tap', async () => {
		const { follower, shown, at } = setup()
		await follower.start()
		at(10)
		follower.anchor(8000)
		expect(follower.phase.value).toBe('following')
		expect(shown()).toBe(8000)
		worker.report(9950, 42000)
		expect(shown()).toBe(8000)
		worker.report(10050, 8100)
		expect(shown()).toBeCloseTo(8100, 0)
		follower.destroy()
	})

	it('holds the place on wait() until the next tap', async () => {
		const { follower, shown, at } = setup()
		await follower.start()
		at(10)
		follower.anchor(8000)
		at(12)
		worker.report(12000, 10000)
		follower.wait()
		expect(follower.phase.value).toBe('waiting')
		expect(follower.held.value).toBe(true)
		const held = shown()
		at(20)
		worker.report(20000, 60000)
		expect(shown()).toBe(held)
		follower.anchor(4000)
		expect(follower.held.value).toBe(false)
		expect(shown()).toBe(4000)
		follower.destroy()
	})

	it('posts no frames to the worker while waiting for a tap', async () => {
		const { follower, at, frames } = setup()
		await follower.start()
		vi.advanceTimersByTime(500)
		expect(frames()).toHaveLength(0)
		at(1)
		follower.anchor(2000)
		vi.advanceTimersByTime(500)
		const listening = frames().length
		expect(listening).toBeGreaterThan(5)
		follower.wait()
		vi.advanceTimersByTime(500)
		expect(frames()).toHaveLength(listening)
		follower.destroy()
	})

	it('takes its analyser off the shared source when it stops', async () => {
		const { follower, source, analysers } = setup()
		// Someone else (the tuner) also hangs on the source.
		const tuner = {}
		source.connect(tuner)
		for (let i = 0; i < 3; i++) {
			await follower.start()
			expect(source.attached.size).toBe(2)
			follower.stop()
		}
		expect([...source.attached]).toEqual([tuner])
		expect(analysers).toHaveLength(3)
		for (const analyser of analysers) {
			expect(analyser.disconnect).toHaveBeenCalled()
		}
		follower.destroy()
	})

	it('removes its visibility listener on destroy, also outside an effect scope', () => {
		const add = vi.spyOn(document, 'addEventListener')
		const remove = vi.spyOn(document, 'removeEventListener')
		const { follower } = setup()
		const listener = add.mock.calls.find(([type]) => type === 'visibilitychange')?.[1]
		expect(listener).toBeTypeOf('function')
		follower.destroy()
		expect(remove).toHaveBeenCalledWith('visibilitychange', listener)
		add.mockRestore()
		remove.mockRestore()
	})

	describe('anchorAfterSeek', () => {
		/** A playback clock: reports the old place until 'timechange'. */
		function clockAt(ms) {
			const listeners = new Set()
			return {
				ms,
				getCurrentTimeMs() { return this.ms },
				addEventListener(type, fn) { listeners.add(fn) },
				removeEventListener(type, fn) { listeners.delete(fn) },
				land(ms) {
					this.ms = ms
					for (const fn of [...listeners]) {
						fn()
					}
				},
				listeners,
			}
		}

		it('anchors where the seek lands, not where the clock was', async () => {
			const { follower, shown, at } = setup()
			await follower.start()
			at(3)
			const clock = clockAt(50000)
			follower.anchorAfterSeek(clock)
			expect(follower.phase.value).toBe('waiting')
			clock.land(12000)
			expect(shown()).toBe(12000)
			expect(clock.listeners.size).toBe(0)
			vi.advanceTimersByTime(500)
			expect(worker.posted.filter((m) => m.type === 'anchor')).toHaveLength(1)
			follower.destroy()
		})

		it('reads a clock without the event after a moment', async () => {
			const { follower, shown, at } = setup()
			await follower.start()
			at(3)
			const silent = { getCurrentTimeMs: () => 7000 }
			follower.anchorAfterSeek(silent)
			vi.advanceTimersByTime(299)
			expect(follower.phase.value).toBe('waiting')
			vi.advanceTimersByTime(1)
			expect(shown()).toBe(7000)
			follower.destroy()
		})

		it('lets a newer seek replace a pending one, and stop() drop it', async () => {
			const { follower, shown, at } = setup()
			await follower.start()
			at(3)
			const first = clockAt(0)
			const second = clockAt(0)
			follower.anchorAfterSeek(first)
			follower.anchorAfterSeek(second)
			expect(first.listeners.size).toBe(0)
			second.land(9000)
			expect(shown()).toBe(9000)
			const third = clockAt(0)
			follower.anchorAfterSeek(third)
			follower.stop()
			expect(third.listeners.size).toBe(0)
			vi.advanceTimersByTime(500)
			expect(worker.posted.filter((m) => m.type === 'anchor')).toHaveLength(1)
			follower.destroy()
		})
	})
})
