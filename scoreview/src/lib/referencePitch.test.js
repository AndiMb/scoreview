import { describe, expect, it } from 'vitest'
import { centsOff, foldOctave } from './intonation.js'
import { fineTuneCents, framesAt440, normalizeReferencePitch, REFERENCE_PITCH_MAX, REFERENCE_PITCH_MIN } from './referencePitch.js'

describe('normalizeReferencePitch', () => {
	it('keeps whole Hz within the range', () => {
		expect(normalizeReferencePitch(442)).toBe(442)
		expect(normalizeReferencePitch('443')).toBe(443)
		expect(normalizeReferencePitch(442.6)).toBe(443)
	})

	it('clamps instead of rejecting, as the server does', () => {
		expect(normalizeReferencePitch(415)).toBe(REFERENCE_PITCH_MIN)
		expect(normalizeReferencePitch(9999)).toBe(REFERENCE_PITCH_MAX)
	})

	it('falls back to 440 without a number - also for a recording from before the setting', () => {
		for (const value of [undefined, null, '', 'a', NaN, true]) {
			expect(normalizeReferencePitch(value)).toBe(440)
		}
	})

	it('stays within the synthesizer fine tune of -100 to +99.986 cents', () => {
		expect(fineTuneCents(REFERENCE_PITCH_MIN)).toBeGreaterThan(-100)
		expect(fineTuneCents(REFERENCE_PITCH_MAX)).toBeLessThan(99.986)
	})
})

describe('fineTuneCents', () => {
	it('is 0 at 440 and about +7.85 cents at 442', () => {
		expect(fineTuneCents(440)).toBe(0)
		expect(fineTuneCents(442)).toBeCloseTo(7.85, 2)
	})
})

describe('framesAt440', () => {
	it('returns the same array at 440', () => {
		const frames = [{ hz: 441, clarity: 0.9 }]
		expect(framesAt440(frames, 440)).toBe(frames)
	})

	it('makes an a sung at 442 exact when the reference is 442', () => {
		const [frame] = framesAt440([{ hz: 442, clarity: 0.9 }], 442)
		expect(foldOctave(centsOff(frame.hz, 69))).toBeCloseTo(0, 6)
		expect(frame.clarity).toBe(0.9)
	})

	it('leaves unvoiced frames alone', () => {
		const frames = framesAt440([{ hz: null, clarity: 0 }, { hz: 0, clarity: 0 }], 442)
		expect(frames.map((f) => f.hz)).toEqual([null, 0])
	})
})
