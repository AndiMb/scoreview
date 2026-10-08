import { describe, expect, it } from 'vitest'
import { clampLevel, COACH_PROGRAM, coachMix, DEFAULT_OTHERS_LEVEL, programsToRestore } from './coachMix.js'
import { PAN_MINE, PAN_OTHERS } from './panLayout.js'

const programs = new Map([[0, 52], [1, 52], [2, 53], [3, 52]])

describe('coachMix', () => {
	it('hebt die eigene Stimme als Klavier rechts hervor', () => {
		const mix = coachMix({ channels: [0, 1, 2, 3], myChannels: [2], programs })
		expect(mix.volumes.get(2)).toBe(127)
		expect(mix.volumes.get(0)).toBe(DEFAULT_OTHERS_LEVEL)
		expect(mix.pans.get(2)).toBe(PAN_MINE)
		expect(mix.pans.get(1)).toBe(PAN_OTHERS)
		expect(mix.programs.get(2)).toBe(COACH_PROGRAM)
		// Die uebrigen behalten ihr Instrument.
		expect(mix.programs.get(0)).toBe(52)
	})

	it('behandelt eine Stimme mit zwei Kanaelen (divisi) als eine', () => {
		const mix = coachMix({ channels: [0, 1, 2], myChannels: [0, 1], programs })
		expect(mix.volumes.get(0)).toBe(127)
		expect(mix.volumes.get(1)).toBe(127)
		expect(mix.volumes.get(2)).toBe(DEFAULT_OTHERS_LEVEL)
	})

	it('nimmt den Regler fuer die uebrigen', () => {
		const mix = coachMix({ channels: [0, 1], myChannels: [0], othersLevel: 0 })
		expect(mix.volumes.get(1)).toBe(0)
	})

	it('liefert ohne eigene Stimme nichts', () => {
		expect(coachMix({ channels: [0, 1], myChannels: null })).toBeNull()
		expect(coachMix({ channels: [0, 1], myChannels: [] })).toBeNull()
	})
})

describe('programsToRestore', () => {
	it('stellt genau die von Coach veraenderten Programme zurueck', () => {
		const mix = coachMix({ channels: [0, 1, 2, 3], myChannels: [2], programs })
		expect([...programsToRestore(programs, mix.programs)]).toEqual([[2, 53]])
	})

	it('laesst eine Stimme in Ruhe, die schon Klavier war', () => {
		const before = new Map([[0, 0], [1, 52]])
		const mix = coachMix({ channels: [0, 1], myChannels: [0], programs: before })
		expect(programsToRestore(before, mix.programs).size).toBe(0)
	})
})

describe('clampLevel', () => {
	it('begrenzt auf 0..127 und rundet', () => {
		expect(clampLevel(-5)).toBe(0)
		expect(clampLevel(200)).toBe(127)
		expect(clampLevel(63.6)).toBe(64)
	})

	it('faellt bei Unsinn auf die Vorgabe zurueck', () => {
		expect(clampLevel('abc')).toBe(DEFAULT_OTHERS_LEVEL)
		expect(clampLevel(undefined)).toBe(DEFAULT_OTHERS_LEVEL)
	})
})
