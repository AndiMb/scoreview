import { describe, expect, it } from 'vitest'
import { DISCOVERY_FAST_WINDOW_MS, DISCOVERY_SLOW_POLL_MS, followPollDelay, IDLE_POLL_MS, LEADER_POLL_MS } from './followPoll.js'

const base = { visible: true, active: true, mine: false, following: true, push: false, pollMs: 800, sinceAttentionMs: 0 }

describe('followPollDelay', () => {
	it('polls at the full rate only for a visible follower without push', () => {
		expect(followPollDelay(base)).toBe(800)
	})

	it('keeps the full rate for a follower however long nothing changes', () => {
		expect(followPollDelay({ ...base, sinceAttentionMs: 3_600_000 })).toBe(800)
	})

	it('slows the leader\'s own device down', () => {
		expect(followPollDelay({ ...base, mine: true })).toBe(LEADER_POLL_MS)
	})

	it('slows a detached device down', () => {
		expect(followPollDelay({ ...base, following: false })).toBe(IDLE_POLL_MS)
	})

	it('slows down next to push and in the background', () => {
		expect(followPollDelay({ ...base, push: true })).toBe(IDLE_POLL_MS)
		expect(followPollDelay({ ...base, visible: false })).toBe(IDLE_POLL_MS)
		expect(followPollDelay({ ...base, visible: false, mine: true })).toBe(IDLE_POLL_MS)
	})

	it('discovers a session quickly for a while after attention, then slowly', () => {
		const none = { ...base, active: false }
		expect(followPollDelay({ ...none, sinceAttentionMs: 0 })).toBe(IDLE_POLL_MS)
		expect(followPollDelay({ ...none, sinceAttentionMs: DISCOVERY_FAST_WINDOW_MS - 1 })).toBe(IDLE_POLL_MS)
		expect(followPollDelay({ ...none, sinceAttentionMs: DISCOVERY_FAST_WINDOW_MS })).toBe(DISCOVERY_SLOW_POLL_MS)
	})

	it('does not let push shorten discovery: push only reaches joined devices', () => {
		expect(followPollDelay({ ...base, active: false, push: true, sinceAttentionMs: DISCOVERY_FAST_WINDOW_MS })).toBe(DISCOVERY_SLOW_POLL_MS)
	})
})
