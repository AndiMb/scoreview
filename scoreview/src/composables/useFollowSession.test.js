// The leader's sending and the staleness rules around it. All failures this
// guards against are silent: a second tap lost while the first was on its
// way ("B, no C" arriving as B), an answer for the previous piece landing
// on the next one, and a poll that left before the leader's own action
// flashing the fresh session as "ended".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const axiosRequest = vi.fn()
const axiosGet = vi.fn()
vi.mock('@nextcloud/axios', () => ({
	default: Object.assign(axiosRequest, { get: axiosGet, post: vi.fn(), patch: vi.fn(() => Promise.resolve({})) }),
}))
vi.mock('@nextcloud/router', () => ({ generateUrl: (url) => url }))
vi.mock('@nextcloud/notify_push', () => ({ listen: () => false }))
vi.mock('../l10n.js', () => ({ translate: (app, text) => text }))

const { useFollowSession } = await import('./useFollowSession.js')

/** The leader's own session, as FollowController answers it. */
const MINE = { active: true, version: '2', state: { session: 's1' }, leader: { me: true, displayName: 'Lea' } }

/** A request whose answer (or failure) the test releases itself. */
function hanging(mock) {
	let answer
	let fail
	mock.mockReturnValueOnce(new Promise((resolve, reject) => {
		answer = resolve
		fail = reject
	}))
	return { answer: (data, status = 200) => answer({ data, status }), fail: (err) => fail(err) }
}

function create({ enabled = false } = {}) {
	let measure = 1
	const follow = useFollowSession({
		fileId: () => 42,
		enabled: () => enabled,
		// Skips the push sign-up, which is not under test here.
		standalone: () => true,
		ready: () => true,
		permitted: () => true,
	}, {
		seekToMeasure: vi.fn(() => 0),
		setLoop: vi.fn(),
		clearLoop: vi.fn(),
		playTone: vi.fn(),
		currentPosition: () => ({ measure, mark: null }),
		currentLoop: () => null,
	})
	return {
		follow,
		at: (m) => {
			measure = m
		},
	}
}

/** Lets the promise chains of run() and pump() finish. */
async function flush() {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve()
	}
}

describe('useFollowSession – leader sending', () => {
	let current = null

	beforeEach(() => {
		vi.useFakeTimers()
		axiosRequest.mockReset()
		axiosGet.mockReset()
	})

	afterEach(() => {
		current?.stop()
		current = null
		vi.useRealTimers()
	})

	it('sends one step at a time and merges what was tapped meanwhile, the last tap winning', async () => {
		const { follow, at } = create()
		current = follow
		const first = hanging(axiosRequest)
		const second = hanging(axiosRequest)

		at(2)
		const sentB = follow.sendPosition()
		at(3)
		const sentC = follow.sendPosition()
		at(4)
		const sentD = follow.sendPosition()
		expect(axiosRequest).toHaveBeenCalledTimes(1)
		expect(follow.busy.value).toBe(true)

		first.answer(MINE)
		await flush()
		expect(axiosRequest).toHaveBeenCalledTimes(2)
		expect(axiosRequest.mock.calls[0][0].data.position.measure).toBe(2)
		expect(axiosRequest.mock.calls[1][0].data.position.measure).toBe(4)

		second.answer(MINE)
		await flush()
		await expect(sentB).resolves.toBe(true)
		await expect(sentC).resolves.toBe(true)
		await expect(sentD).resolves.toBe(true)
		expect(follow.busy.value).toBe(false)
		expect(follow.mine.value).toBe(true)
	})

	it('drops an answer that arrives after the score changed (generation)', async () => {
		const { follow } = create()
		current = follow
		const pending = hanging(axiosRequest)

		const sent = follow.start()
		const queued = follow.sendPosition()
		follow.restart()
		// What waited behind the request belonged to the old piece.
		await expect(queued).resolves.toBe(false)

		pending.answer(MINE)
		await flush()
		await sent
		expect(follow.active.value).toBe(false)
		expect(follow.error.value).toBe('')
		// Nothing more goes out for the old piece.
		expect(axiosRequest).toHaveBeenCalledTimes(1)
	})

	it('drops a poll that left before the leader\'s own action was answered (epoch)', async () => {
		const { follow } = create({ enabled: true })
		current = follow
		const poll = hanging(axiosGet)
		follow.restart()
		await vi.advanceTimersByTimeAsync(0)
		expect(axiosGet).toHaveBeenCalledTimes(1)

		axiosRequest.mockResolvedValueOnce({ data: MINE, status: 200 })
		await follow.start()
		expect(follow.mine.value).toBe(true)

		// Still the state from before the start: "no session".
		poll.answer({ active: false, version: '1' })
		await flush()
		expect(follow.mine.value).toBe(true)
	})

	it('shows the server\'s reason, else its own text, and keeps the queue going', async () => {
		const { follow } = create()
		current = follow
		axiosRequest.mockRejectedValueOnce({ response: { status: 429, data: { error: 'Too many changes.' } } })
		await expect(follow.sendPosition()).resolves.toBe(false)
		expect(follow.error.value).toBe('Too many changes.')

		axiosRequest.mockRejectedValueOnce({ response: { status: 500, data: {} } })
		await expect(follow.sendLoop()).resolves.toBe(false)
		expect(follow.error.value).toBe('Could not send the loop.')

		axiosRequest.mockResolvedValueOnce({ data: MINE, status: 200 })
		await expect(follow.sendTone()).resolves.toBe(true)
		expect(follow.error.value).toBe('')
		expect(follow.busy.value).toBe(false)
	})
})
