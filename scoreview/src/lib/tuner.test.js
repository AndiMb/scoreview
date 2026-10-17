import { describe, expect, it } from 'vitest'
import { A4_HZ } from './intonation.js'
import { nameOf } from './noteNames.js'
import { nearest, octaveOf, smooth, tpcForPitch } from './tuner.js'

const hzOf = (midi, cents = 0, a4 = 440) => a4 * 2 ** ((midi - 69 + cents / 100) / 12)

describe('nearest', () => {
	it('finds a4 at 440 Hz with ±0 cents', () => {
		expect(A4_HZ).toBe(440)
		expect(nearest(440)).toEqual({ midi: 69, cents: 0 })
	})

	it('reads 442 Hz as a4 almost 8 cents sharp, 415 Hz as g♯4 slightly flat', () => {
		const a = nearest(442)
		expect(a.midi).toBe(69)
		expect(a.cents).toBeCloseTo(7.85, 1)
		const gis = nearest(415)
		expect(gis.midi).toBe(68)
		expect(gis.cents).toBeCloseTo(-1.27, 1)
	})

	it('folds to the nearest note, never past ±50 cents', () => {
		expect(nearest(hzOf(60, 49)).midi).toBe(60)
		expect(nearest(hzOf(60, 51)).midi).toBe(61)
		expect(nearest(hzOf(60, 51)).cents).toBeCloseTo(-49)
	})

	it('keeps the octave (a tuner shows it)', () => {
		expect(nearest(220).midi).toBe(57)
		expect(nearest(880).midi).toBe(81)
	})

	it('measures against another reference when asked', () => {
		expect(nearest(442, 442).cents).toBeCloseTo(0)
	})

	it('returns null without a usable frequency', () => {
		expect(nearest(null)).toBeNull()
		expect(nearest(0)).toBeNull()
		expect(nearest(NaN)).toBeNull()
	})
})

describe('octaveOf', () => {
	it('uses scientific pitch notation', () => {
		expect(octaveOf(69)).toBe(4)
		expect(octaveOf(60)).toBe(4)
		expect(octaveOf(59)).toBe(3)
		expect(octaveOf(48)).toBe(3)
	})
})

describe('smooth', () => {
	const frame = (t, hz, clarity = 0.9) => ({ contextTimeSec: t, hz, clarity })

	it('takes the median of the voiced frames in the window', () => {
		const frames = [frame(0, 438), frame(0.02, 440), frame(0.04, 441), frame(0.06, 439), frame(0.08, 442)]
		expect(smooth(frames, 100)).toBe(440)
	})

	it('is not pulled by one outlier', () => {
		const frames = [frame(0, 440), frame(0.02, 440), frame(0.04, 880), frame(0.06, 441), frame(0.08, 440)]
		expect(smooth(frames, 100)).toBe(440)
	})

	it('only looks back as far as the window, measured from the newest frame', () => {
		const frames = [frame(0, 200), frame(0.02, 200), frame(0.5, 440), frame(0.52, 441)]
		expect(smooth(frames, 100)).toBeCloseTo(440.5)
	})

	it('ignores unclear frames and reports silence as null', () => {
		expect(smooth([frame(0, 440, 0.2), frame(0.02, null, 0)], 100)).toBeNull()
		expect(smooth([], 100)).toBeNull()
		expect(smooth(null, 100)).toBeNull()
		expect(smooth([frame(0, 440, 0.2), frame(0.02, 442, 0.9)], 100)).toBe(442)
	})

	it('accepts frames with timeSec as well', () => {
		expect(smooth([{ timeSec: 1, hz: 300, clarity: 0.9 }], 50)).toBe(300)
	})
})

describe('tpcForPitch', () => {
	const de = (midi, key) => nameOf({ tpc: tpcForPitch(midi, key), system: 'de' })
	const en = (midi, key) => nameOf({ tpc: tpcForPitch(midi, key), system: 'en' })

	it('spells naturals as themselves in every key', () => {
		expect(tpcForPitch(60, 0)).toBe(14)
		expect(tpcForPitch(65, 0)).toBe(13)
		expect(tpcForPitch(67, 3)).toBe(15)
		expect(tpcForPitch(62, -4)).toBe(16)
	})

	it('spells C major the way MuseScore does', () => {
		expect([61, 63, 66, 68, 70].map((m) => en(m, 0))).toEqual(['C♯', 'E♭', 'F♯', 'A♭', 'B♭'])
		expect(en(61)).toBe('C♯')
		expect(en(61, null)).toBe('C♯')
	})

	it('writes the sharps of G major and keeps F natural as F', () => {
		expect(de(66, 1)).toBe('Fis')
		expect(de(70, 1)).toBe('B')
		expect(de(71, 1)).toBe('H')
		expect(de(65, 1)).toBe('F')
		// Four fifths below the tonic beats eight above: E♭, as MuseScore spells it.
		expect(de(63, 1)).toBe('Es')
	})

	it('writes the flats of F major, with B♭ as the scale tone and B natural as H', () => {
		expect(de(70, -1)).toBe('B')
		expect(de(63, -1)).toBe('Es')
		expect(de(61, -1)).toBe('Des')
		expect(de(71, -1)).toBe('H')
		expect(de(66, -1)).toBe('Fis')
	})

	it('keeps the scale tones of distant keys (E♭ major A♭, B major A♯)', () => {
		expect(de(68, -3)).toBe('As')
		expect(de(70, 5)).toBe('Ais')
		expect(de(64, 5)).toBe('E')
		expect(de(65, 3)).toBe('F')
	})
})
