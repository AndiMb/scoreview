import { describe, expect, it } from 'vitest'
import { ACTIONS, allowed } from './interactionPolicy.js'

// Die vollstaendige Tabelle: jede Aktion in allen vier Zustaenden. Eine neue
// Aktion ohne Zeile hier laesst den Vollstaendigkeitstest unten scheitern.
const TABLE = {
	//            normal  folgt   Auffuehrung  Auffuehrung+folgt
	seek: [true, true, false, false],
	noteClick: [true, true, false, false],
	loop: [true, true, false, false],
	mixer: [true, true, false, false],
	annotate: [true, true, false, false],
	play: [true, true, false, false],
	tone: [true, true, false, false],
	settings: [true, true, false, false],
	page: [true, true, true, true],
	zoom: [true, true, true, true],
	nextPiece: [true, true, true, true],
	followJump: [false, true, false, true],
}

const CONTEXTS = [
	{ performance: false, following: false },
	{ performance: false, following: true },
	{ performance: true, following: false },
	{ performance: true, following: true },
]

describe('interactionPolicy.allowed', () => {
	it('hat fuer jede Aktion eine Zeile in der Tabelle', () => {
		expect(Object.keys(TABLE).sort()).toEqual([...ACTIONS].sort())
	})

	for (const [action, expected] of Object.entries(TABLE)) {
		CONTEXTS.forEach((ctx, i) => {
			it(`${action} bei ${JSON.stringify(ctx)} → ${expected[i]}`, () => {
				expect(allowed(action, ctx)).toBe(expected[i])
			})
		})
	}

	it('sperrt eine unbekannte Aktion in jedem Zustand', () => {
		for (const ctx of CONTEXTS) {
			expect(allowed('pley', ctx)).toBe(false)
		}
	})

	it('nimmt ohne Kontext den Normalzustand an', () => {
		expect(allowed('seek')).toBe(true)
		expect(allowed('followJump')).toBe(false)
	})
})
