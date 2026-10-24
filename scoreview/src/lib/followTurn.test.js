import { describe, expect, it } from 'vitest'
import { decideTurn, rowAt } from './followTurn.js'

// Rows of 10 s, two on screen.
const rows = [0, 1, 2, 3, 4, 5].map((i) => ({ fromMs: i * 10000, toMs: (i + 1) * 10000 }))
const following = (confirmedMs, extra = {}) => ({ phase: 'following', confirmedMs, tempoRatio: 1, evidence: 1, jumped: false, ...extra })

describe('rowAt', () => {
	it('finds and clamps', () => {
		expect(rowAt(rows, 0)).toBe(0)
		expect(rowAt(rows, 19999)).toBe(1)
		expect(rowAt(rows, 99999)).toBe(5)
	})
})

describe('decideTurn', () => {
	it('stays while the music ahead is on screen', () => {
		expect(decideTurn({ first: 0, visible: 2, rows, state: following(15000) })).toBeNull()
	})

	it('turns when the music 1.5 s ahead leaves the screen, keeping the sung row', () => {
		expect(decideTurn({ first: 0, visible: 2, rows, state: following(18600) })).toBe(1)
	})

	it('turns earlier at a faster tempo', () => {
		expect(decideTurn({ first: 0, visible: 2, rows, state: following(17500) })).toBeNull()
		expect(decideTurn({ first: 0, visible: 2, rows, state: following(17500, { tempoRatio: 2 }) })).toBe(1)
	})

	it('never turns on a guess: not while unsure or lost, not without evidence', () => {
		expect(decideTurn({ first: 0, visible: 2, rows, state: following(19000, { phase: 'unsure' }) })).toBeNull()
		expect(decideTurn({ first: 0, visible: 2, rows, state: following(19000, { phase: 'lost' }) })).toBeNull()
		expect(decideTurn({ first: 0, visible: 2, rows, state: following(19000, { evidence: 0.3 }) })).toBeNull()
		expect(decideTurn({ first: 0, visible: 2, rows, state: null })).toBeNull()
	})

	it('goes back only after a jump', () => {
		expect(decideTurn({ first: 3, visible: 2, rows, state: following(5000) })).toBeNull()
		expect(decideTurn({ first: 3, visible: 2, rows, state: following(5000, { jumped: true }) })).toBe(0)
	})

	it('with one row on screen it moves to the row ahead only when the sung row ends', () => {
		// The sung row must stay visible - so the turn waits for the row change.
		expect(decideTurn({ first: 0, visible: 1, rows, state: following(9000) })).toBeNull()
		expect(decideTurn({ first: 0, visible: 1, rows, state: following(10100) })).toBe(1)
	})
})
