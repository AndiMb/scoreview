import { describe, expect, it } from 'vitest'
import { HYSTERESIS_PX, initialBarFit, nextBarFit } from './barFit.js'

const KEY = 'k'

function wide() {
	return { ...initialBarFit(), contentKey: KEY }
}

describe('nextBarFit', () => {
	it('bleibt breit, solange nichts ueberlaeuft', () => {
		const state = wide()
		expect(nextBarFit(state, { rootWidth: 900, overflowing: false, contentKey: KEY })).toBe(state)
	})

	it('wird beim Ueberlauf kompakt und merkt sich die Breite', () => {
		const next = nextBarFit(wide(), { rootWidth: 800, overflowing: true, contentKey: KEY })
		expect(next).toEqual({ compact: true, switchWidth: 800, contentKey: KEY })
	})

	it('flattert nicht an der Ueberlaufkante', () => {
		let state = nextBarFit(wide(), { rootWidth: 800, overflowing: true, contentKey: KEY })
		for (const rootWidth of [790, 805, 810, 800 + HYSTERESIS_PX - 1]) {
			// In kompakter Gestalt meldet die Leiste nie einen Ueberlauf.
			state = nextBarFit(state, { rootWidth, overflowing: false, contentKey: KEY })
			expect(state.compact).toBe(true)
		}
	})

	it('versucht mit Abstand zur Ueberlaufbreite wieder breit', () => {
		const compact = nextBarFit(wide(), { rootWidth: 800, overflowing: true, contentKey: KEY })
		const next = nextBarFit(compact, { rootWidth: 800 + HYSTERESIS_PX, overflowing: false, contentKey: KEY })
		expect(next).toEqual({ compact: false, switchWidth: null, contentKey: KEY })
	})

	it('versucht bei neuem Inhalt breit, auch ohne Breitenaenderung', () => {
		const compact = nextBarFit(wide(), { rootWidth: 800, overflowing: true, contentKey: KEY })
		const next = nextBarFit(compact, { rootWidth: 800, overflowing: false, contentKey: 'performance' })
		expect(next).toEqual({ compact: false, switchWidth: null, contentKey: 'performance' })
	})

	it('wird nach dem Versuch wieder kompakt, wenn es nicht passt', () => {
		let state = nextBarFit(wide(), { rootWidth: 800, overflowing: true, contentKey: KEY })
		state = nextBarFit(state, { rootWidth: 800, overflowing: false, contentKey: 'other' })
		state = nextBarFit(state, { rootWidth: 800, overflowing: true, contentKey: 'other' })
		expect(state).toEqual({ compact: true, switchWidth: 800, contentKey: 'other' })
	})
})
