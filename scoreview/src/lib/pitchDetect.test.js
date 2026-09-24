import { describe, expect, it } from 'vitest'
import { CLARITY_THRESHOLD, createPitchStream, detectPitch, FRAME_SIZE, HOP_SIZE, trackPitch } from './pitchDetect.js'

const RATE = 16000
const cents = (hz, ref) => 1200 * Math.log2(hz / ref)

/**
 * Ein Signal aus Teiltoenen, optional mit Vibrato - so nah an einer
 * Singstimme, wie es ohne Aufnahme geht.
 *
 * @param {Array<{hz:number, amp:number}>} partials
 * @param {number} samples
 * @param {object} [opts]
 * @param {number} [opts.vibratoCents]
 * @param {number} [opts.vibratoHz]
 * @return {Float32Array}
 */
function signal(partials, samples = FRAME_SIZE, { vibratoCents = 0, vibratoHz = 5.5 } = {}) {
	const out = new Float32Array(samples)
	const phase = partials.map(() => 0)
	for (let i = 0; i < samples; i++) {
		const factor = 2 ** ((vibratoCents * Math.sin((2 * Math.PI * vibratoHz * i) / RATE)) / 1200)
		let v = 0
		partials.forEach((p, k) => {
			phase[k] += (2 * Math.PI * p.hz * factor) / RATE
			v += p.amp * Math.sin(phase[k])
		})
		out[i] = v
	}
	return out
}

/** Eine Stimme mit abnehmenden Obertoenen. */
const stimme = (hz, n = 8) => Array.from({ length: n }, (_, k) => ({ hz: hz * (k + 1), amp: 0.3 / (k + 1) }))

describe('detectPitch - eine Stimme', () => {
	it.each([98, 220, 261.63, 440, 880])('findet einen reinen Sinus von %f Hz auf wenige Cent', (hz) => {
		const r = detectPitch(signal([{ hz, amp: 0.5 }]))
		expect(Math.abs(cents(r.hz, hz))).toBeLessThan(3)
		expect(r.clarity).toBeGreaterThan(0.9)
	})

	it('findet den Grundton einer obertonreichen Stimme, nicht einen Oberton', () => {
		const r = detectPitch(signal(stimme(196)))
		expect(Math.abs(cents(r.hz, 196))).toBeLessThan(3)
		expect(r.clarity).toBeGreaterThan(CLARITY_THRESHOLD)
	})

	it('erkennt +50 Cent als +50 Cent', () => {
		const soll = 220
		const r = detectPitch(signal(stimme(soll * 2 ** (50 / 1200))))
		expect(cents(r.hz, soll)).toBeCloseTo(50, -1)
	})
})

describe('detectPitch - ehrlich nicht auswertbar', () => {
	it.each([
		['Quinte', 220, 330],
		['grosse Terz', 220, 277.18],
		['kleine Sexte', 196, 311.13],
		['Sekunde', 220, 246.94],
	])('zwei Stimmen im Abstand einer %s', (_, a, b) => {
		const r = detectPitch(signal([...stimme(a, 4), ...stimme(b, 4)]))
		expect(r.clarity).toBeLessThan(CLARITY_THRESHOLD)
	})

	it('zwei reine Sinustoene im Quintabstand - der „gemeinsame Grundton" traegt nichts', () => {
		const r = detectPitch(signal([{ hz: 220, amp: 0.4 }, { hz: 330, amp: 0.4 }]))
		expect(r.clarity).toBeLessThan(CLARITY_THRESHOLD)
	})

	it('Rauschen', () => {
		let seed = 1
		const zufall = () => {
			seed = (seed * 16807) % 2147483647
			return seed / 2147483647 - 0.5
		}
		const r = detectPitch(new Float32Array(FRAME_SIZE).map(zufall))
		expect(r.clarity).toBeLessThan(CLARITY_THRESHOLD)
	})

	it('Stille', () => {
		const r = detectPitch(new Float32Array(FRAME_SIZE))
		expect(r.hz).toBeNull()
		expect(r.clarity).toBe(0)
	})

	it('eine Oktavverdopplung bleibt eine Stimme (musikalisch Unisono)', () => {
		const r = detectPitch(signal([...stimme(220, 4), ...stimme(440, 4)]))
		expect(r.clarity).toBeGreaterThan(CLARITY_THRESHOLD)
		expect(Math.abs(cents(r.hz, 220))).toBeLessThan(5)
	})
})

describe('trackPitch', () => {
	it('liefert je Vorschub einen Rahmen mit der Zeit seiner Mitte', () => {
		const frames = trackPitch(signal([{ hz: 330, amp: 0.5 }], RATE))
		expect(frames.length).toBe(Math.floor((RATE - FRAME_SIZE) / HOP_SIZE) + 1)
		expect(frames[0].timeSec).toBeCloseTo(FRAME_SIZE / 2 / RATE)
		expect(frames[1].timeSec - frames[0].timeSec).toBeCloseTo(0.02)
		expect(frames.every((f) => Math.abs(cents(f.hz, 330)) < 3)).toBe(true)
	})
})

describe('createPitchStream', () => {
	it('liefert blockweise dieselben Rahmen wie am Stueck, mit Kontextzeit', () => {
		const sig = signal([{ hz: 262, amp: 0.5 }], 8000)
		const stream = createPitchStream()
		const live = []
		for (let i = 0; i < sig.length; i += 320) {
			live.push(...stream.push(sig.subarray(i, i + 320), 100 + i / RATE))
		}
		const amStueck = trackPitch(sig)
		expect(live.length).toBe(amStueck.length)
		expect(live[0].contextTimeSec).toBeCloseTo(100 + amStueck[0].timeSec, 6)
		expect(live[3].hz).toBeCloseTo(amStueck[3].hz, 6)
	})
})
