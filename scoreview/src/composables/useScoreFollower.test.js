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
	const context = {
		currentTime: 0,
		sampleRate: 48000,
		createAnalyser: () => ({ connect() {}, disconnect() {}, frequencyBinCount: 8, getFloatFrequencyData() {} }),
	}
	const microphone = {
		acquire: vi.fn(async () => ({ context, source: { connect() {} } })),
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
	return { follower, shown, at }
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
})
