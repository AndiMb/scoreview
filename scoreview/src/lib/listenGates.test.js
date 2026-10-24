import { describe, expect, it } from 'vitest'
import { createLevelGate } from './listenGates.js'

describe('createLevelGate', () => {
	it('lets music through and shuts on silence', () => {
		const gate = createLevelGate()
		expect(gate.accept(-10, 0)).toBe(true)
		gate.noteMusic(-10)
		expect(gate.accept(-12, 50)).toBe(true)
		expect(gate.accept(-60, 100)).toBe(false)
		expect(gate.accept(-Infinity, 150)).toBe(false)
	})

	it('keeps a long piece without pauses open', () => {
		// A running minimum would climb to the music; the peak does not.
		const gate = createLevelGate()
		let open = 0
		for (let at = 0; at < 120000; at += 50) {
			const level = -15 + 5 * Math.sin(at / 3000)
			if (gate.accept(level, at)) {
				open++
				gate.noteMusic(level)
			}
		}
		expect(open).toBe(120000 / 50)
	})

	it('rejects a spike of handling noise and the window after it', () => {
		const gate = createLevelGate()
		gate.accept(-20, 0)
		gate.noteMusic(-20)
		expect(gate.accept(-5, 50)).toBe(false)
		expect(gate.accept(-20, 150)).toBe(false)
		expect(gate.accept(-20, 300)).toBe(true)
	})

	it('forgets a loud passage slowly in a long silence', () => {
		const gate = createLevelGate({ decayDbPerSec: 1.5, dropDb: 30 })
		gate.accept(-5, 0)
		gate.noteMusic(-5)
		// Quiet singing 20 s later: the remembered peak sank by 30 dB.
		expect(gate.accept(-40, 20000)).toBe(true)
	})
})
