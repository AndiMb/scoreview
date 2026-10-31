// A run is stored once, when it was sung through from the start - and not
// when it was sought in, paused, waited for, or had nothing of my part.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

const axiosGet = vi.fn()
const axiosPost = vi.fn()
const axiosDelete = vi.fn()

vi.mock('@nextcloud/axios', () => ({ default: { get: axiosGet, post: axiosPost, put: vi.fn(), delete: axiosDelete } }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (url) => url }))

const { useSingScore } = await import('./useSingScore.js')

const hzOf = (pitch) => 440 * 2 ** ((pitch - 69) / 12)

const NOTES = [
	{ onMs: 500, offMs: 1300, pitch: 64, channel: 1 },
	{ onMs: 1500, offMs: 2300, pitch: 67, channel: 1 },
	{ onMs: 2500, offMs: 3300, pitch: 65, channel: 1 },
	{ onMs: 500, offMs: 3300, pitch: 76, channel: 0 },
]
const DURATION = 4000

function setup({ channels = [1], loop = null, notes = NOTES } = {}) {
	let listener = null
	const playing = ref(false)
	const position = ref(0)
	const waiting = ref(false)
	let clock = 0
	const intonation = {
		live: ref(false),
		startLive: vi.fn(async () => {
			intonation.live.value = true
		}),
		stopLive: vi.fn(() => {
			intonation.live.value = false
		}),
		onScoreFrames: (cb) => {
			listener = cb
			return () => {
				listener = null
			}
		},
	}
	const scope = effectScope()
	const sing = scope.run(() => useSingScore({
		fileId: () => 42,
		enabled: () => true,
		intonation,
		notes: () => notes,
		myChannels: () => channels,
		measureOf: (ms) => Math.floor(ms / 1000) + 1,
		loopRange: () => loop,
		durationMs: () => DURATION,
		isPlaying: () => playing.value,
		positionMs: () => position.value,
		waitModeActive: () => waiting.value,
		now: () => clock,
	}))

	/**
	 * Feed frames as the intonation would, 100 ms per batch, singing my notes
	 * exactly (or `sing(ms)` for something else).
	 *
	 * @param {number} fromMs
	 * @param {number} toMs
	 * @param {function(number): ?number} [sing] score ms → MIDI pitch or null
	 */
	function feed(fromMs, toMs, sing = (ms) => NOTES.find((n) => n.channel === 1 && n.onMs <= ms && ms < n.offMs)?.pitch ?? null) {
		for (let start = fromMs; start < toMs; start += 100) {
			const frames = []
			const level = []
			for (let ms = start; ms < Math.min(start + 100, toMs); ms += 20) {
				const pitch = sing(ms)
				frames.push(pitch === null ? { scoreMs: ms, hz: null, clarity: 0 } : { scoreMs: ms, hz: hzOf(pitch), clarity: 0.95 })
			}
			for (let ms = start; ms < Math.min(start + 100, toMs); ms += 5) {
				level.push({ scoreMs: ms, db: sing(ms) === null ? -80 : -20 })
			}
			clock += 100
			listener?.({ frames, level, tempoFactor: 1 })
		}
	}

	return { sing, intonation, playing, position, waiting, feed, scope }
}

describe('useSingScore', () => {
	beforeEach(() => {
		axiosGet.mockReset()
		axiosPost.mockReset()
		axiosDelete.mockReset()
		axiosGet.mockResolvedValue({ data: { runs: [], best: [] } })
		axiosPost.mockResolvedValue({ data: {} })
	})

	it('stores a run sung from the start to the end, once', async () => {
		const { sing, playing, feed, intonation } = setup()
		await sing.start()
		expect(intonation.startLive).toHaveBeenCalled()
		playing.value = true
		feed(0, 3700)
		await nextTick()
		expect(axiosPost).toHaveBeenCalledTimes(1)
		const [, body] = axiosPost.mock.calls[0]
		expect(body).toMatchObject({ level: 'choir', tempoPct: 100, totalPct: 100, notesScored: 3 })
		expect(body.from).toBeUndefined()
		expect(sing.lastRun.value.summary.totalPct).toBe(100)
		expect(sing.lastRun.value.isNewBest).toBe(true)
		// The lane keeps the colours of the run just sung.
		expect(sing.results.value.size).toBe(3)
	})

	it('scores silence as 0 %', async () => {
		const { sing, playing, feed } = setup()
		await sing.start()
		playing.value = true
		feed(0, 3700, () => null)
		await nextTick()
		expect(axiosPost.mock.calls[0][1].totalPct).toBe(0)
	})

	it('counts from the start when the first frames come just after the first note', async () => {
		const { sing, playing, feed } = setup()
		await sing.start()
		playing.value = true
		// Nothing is analysed before playback runs: the first frame is late.
		feed(600, 3700)
		await nextTick()
		expect(axiosPost).toHaveBeenCalledTimes(1)
	})

	it('play again after the end: stale frames from the end start no run', async () => {
		const { sing, playing, position, feed } = setup()
		await sing.start()
		playing.value = true
		feed(0, 3700)
		position.value = DURATION
		playing.value = false
		await nextTick()
		// The clock restarts from 0 only after the first batch.
		position.value = 0
		playing.value = true
		// Its frames are dated back by the analysis - just before the end.
		feed(DURATION - 200, DURATION - 100)
		feed(0, 200)
		// The result just sung stays until the next run is over.
		expect(sing.lastRun.value).toMatchObject({ scored: true, summary: { notesScored: 3 } })
		feed(200, 3700)
		await nextTick()
		expect(axiosPost).toHaveBeenCalledTimes(2)
		expect(sing.lastRun.value.scored).toBe(true)
	})

	it('a run started in the middle is not stored', async () => {
		const { sing, playing, feed } = setup()
		await sing.start()
		playing.value = true
		feed(1400, 3700)
		expect(sing.run.value).toBeNull()
		expect(axiosPost).not.toHaveBeenCalled()
		expect(sing.lastRun.value.scored).toBe(false)
	})

	it('a seek makes the run live only', async () => {
		const { sing, playing, feed } = setup()
		await sing.start()
		playing.value = true
		feed(0, 900)
		feed(2000, 2100)
		expect(sing.run.value.state).toBe('liveOnly')
		feed(2100, 3700)
		expect(axiosPost).not.toHaveBeenCalled()
	})

	it('the end of the piece completes the run although the last frames lag behind', async () => {
		const { sing, playing, position, feed } = setup()
		await sing.start()
		playing.value = true
		// The microphone's frames trail the clock: when playback stops at the
		// end, the last note's end has not been heard yet.
		feed(0, 3100)
		position.value = DURATION
		playing.value = false
		await nextTick()
		expect(axiosPost).toHaveBeenCalledTimes(1)
		expect(axiosPost.mock.calls[0][1]).toMatchObject({ notesScored: 3, totalPct: 100 })
		expect(sing.results.value.get(2500).release).toBeNull()
	})

	it('a pause before the end drops the run', async () => {
		const { sing, playing, position, feed } = setup()
		await sing.start()
		playing.value = true
		feed(0, 1800)
		position.value = 1800
		playing.value = false
		expect(sing.run.value).toBeNull()
		expect(sing.lastRun.value).toBeNull()
		expect(axiosPost).not.toHaveBeenCalled()
	})

	it('wait mode scores nothing', async () => {
		const { sing, playing, feed, waiting } = setup()
		await sing.start()
		waiting.value = true
		playing.value = true
		feed(0, 3700)
		expect(axiosPost).not.toHaveBeenCalled()
	})

	it('every pass of a loop is a run of its own', async () => {
		const loop = { from: 2, to: 3, startMs: 1000, endMs: 3000 }
		const { sing, playing, feed } = setup({ loop })
		await sing.start()
		playing.value = true
		feed(1000, 3000)
		feed(1000, 3000)
		feed(1000, 1100)
		expect(axiosPost).toHaveBeenCalledTimes(2)
		expect(axiosPost.mock.calls[0][1]).toMatchObject({ from: 2, to: 3, notesScored: 2 })
	})

	it('a part without notes in the unit stores nothing', async () => {
		const { sing, playing, feed } = setup({ channels: [5] })
		await sing.start()
		playing.value = true
		feed(0, 3700)
		playing.value = false
		expect(axiosPost).not.toHaveBeenCalled()
	})

	it('says so when saving failed', async () => {
		axiosPost.mockRejectedValue(new Error('offline'))
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const { sing, playing, feed } = setup()
		await sing.start()
		playing.value = true
		feed(0, 3700)
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(sing.lastRun.value.saved).toBe(false)
		expect(sing.lastRun.value.saving).toBe(false)
	})

	it('stops the intonation it started, and only that', async () => {
		const { sing, intonation } = setup()
		await sing.start()
		sing.stop()
		expect(intonation.stopLive).toHaveBeenCalledTimes(1)
		intonation.live.value = true
		await sing.start()
		sing.stop()
		expect(intonation.stopLive).toHaveBeenCalledTimes(1)
	})
})
