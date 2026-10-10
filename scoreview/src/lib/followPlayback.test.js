import { describe, expect, it } from 'vitest'
import { freshPlayback, JUMP_MS, leaderTimeMs, RESYNC_MS, shouldSendPlayback } from './followPlayback.js'

describe('followPlayback', () => {
	it('rechnet die Zeit der Leitung mit Tempo hoch und steht im Halt', () => {
		const p = { playing: true, timeMs: 10000, rate: 0.5, at: 1000 }
		expect(leaderTimeMs(p, 3000)).toBe(11000)
		// Eine Serveruhr „vor" dem Stempel laesst die Zeit nicht zurueckgehen.
		expect(leaderTimeMs(p, 500)).toBe(10000)
		expect(leaderTimeMs({ ...p, playing: false }, 9000)).toBe(10000)
	})

	it('meldet Start und Halt, aber keinen Halt ohne Start', () => {
		expect(shouldSendPlayback(null, { playing: false, timeMs: 0, rate: 1 }, 0)).toBe(false)
		expect(shouldSendPlayback(null, { playing: true, timeMs: 0, rate: 1 }, 0)).toBe(true)
		const last = { playing: true, timeMs: 0, rate: 1, sentAt: 0 }
		expect(shouldSendPlayback(last, { playing: false, timeMs: 500, rate: 1 }, 500)).toBe(true)
	})

	it('schweigt, solange die Vorhersage stimmt, und meldet Spruenge und Tempo', () => {
		const last = { playing: true, timeMs: 1000, rate: 1, sentAt: 0 }
		expect(shouldSendPlayback(last, { playing: true, timeMs: 3100, rate: 1 }, 2000)).toBe(false)
		expect(shouldSendPlayback(last, { playing: true, timeMs: 3000 + JUMP_MS + 1, rate: 1 }, 2000)).toBe(true)
		// Loop: zurueck an den Anfang
		expect(shouldSendPlayback(last, { playing: true, timeMs: 1000, rate: 1 }, 2000)).toBe(true)
		expect(shouldSendPlayback(last, { playing: true, timeMs: 3000, rate: 0.9 }, 2000)).toBe(true)
	})

	it('stellt waehrend der Wiedergabe regelmaessig nach', () => {
		const last = { playing: true, timeMs: 0, rate: 1, sentAt: 0 }
		expect(shouldSendPlayback(last, { playing: true, timeMs: RESYNC_MS, rate: 1 }, RESYNC_MS)).toBe(true)
	})

	it('bewegt im Stillstand niemanden', () => {
		const last = { playing: false, timeMs: 1000, rate: 1, sentAt: 0 }
		expect(shouldSendPlayback(last, { playing: false, timeMs: 50000, rate: 1 }, 60000)).toBe(false)
	})

	it('zieht einen wartenden Stand beim Absenden nach', () => {
		expect(freshPlayback({ playing: true, timeMs: 1000, rate: 2, capturedAt: 100 }, 400)).toEqual({ playing: true, timeMs: 1600, rate: 2 })
		expect(freshPlayback({ playing: false, timeMs: 1000, rate: 2, capturedAt: 100 }, 400)).toEqual({ playing: false, timeMs: 1000, rate: 2 })
	})
})
