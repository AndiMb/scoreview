import { Buffer } from 'node:buffer'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { encodeWav } from '../../src/lib/wavCodec.js'
import { barOccurrences, loadAudio, marksToTruth, resolveMarks, systemSlices } from './recording.mjs'
import { truthAt } from './synth.mjs'

// Four bars of 2 s, bars 1-2 repeated: played 1 2 1 2 3 4. Bars 1-2 stand
// in the first system, 3-4 in the second.
const measures = {
	events: [[0, 0], [1, 2000], [0, 4000], [1, 6000], [2, 8000], [3, 10000]].map(([elid, timeMs]) => ({ elid, timeMs })),
	elements: {
		0: { page: 0, x: 0, y: 100, w: 50, h: 300 },
		1: { page: 0, x: 50, y: 100, w: 50, h: 300 },
		2: { page: 0, x: 0, y: 600, w: 50, h: 300 },
		3: { page: 0, x: 50, y: 610, w: 50, h: 290 },
	},
}
const bars = barOccurrences(measures)
const score = { bars, durationMs: 12000 }

describe('barOccurrences / systemSlices', () => {
	it('numbers the passes of repeated bars', () => {
		expect(bars.map((b) => `${b.measure}.${b.pass}`)).toEqual(['1.1', '2.1', '1.2', '2.2', '3.1', '4.1'])
	})

	it('gives every system and pass its own row', () => {
		expect(systemSlices(measures, 12000).map((s) => [s.fromMs, s.toMs, s.system])).toEqual([
			[0, 8000, 0],
			[8000, 12000, 1],
		])
	})
})

describe('marksToTruth', () => {
	it('interpolates between bars and finds the second pass inside a run', () => {
		const { truth, warnings } = marksToTruth([
			{ measure: 1, atMs: 1000 },
			{ measure: 2, atMs: 3000 },
			{ measure: 1, atMs: 5000 },
			{ measure: 3, atMs: 9000 },
		], score)
		expect(warnings).toEqual(['mark 0: bar 1 is played 2 times - taking the first, set "pass" if that is wrong'])
		expect(truthAt(truth, 500)).toBeNull()
		expect(truthAt(truth, 2000)).toBeCloseTo(1000, -1)
		// The second bar-1 mark is the repeat at 4000, not a jump back.
		expect(truthAt(truth, 5000)).toBeCloseTo(4000, -1)
		expect(truthAt(truth, 7000)).toBeCloseTo(6000, -1)
		// Nothing after the last mark without a stop.
		expect(truthAt(truth, 9500)).toBeNull()
	})

	it('runs on to a stop at the last tempo, but not into the next bar', () => {
		const { truth } = marksToTruth([
			{ measure: 3, atMs: 1000 },
			{ measure: 4, atMs: 2000 },
			{ type: 'stop', atMs: 2500 },
			{ measure: 1, pass: 2, atMs: 4000 },
			{ measure: 2, atMs: 6000 },
			{ type: 'stop', atMs: 9000 },
		], score)
		// Twice the score tempo: 2000 ms of score in 1000 ms.
		expect(truthAt(truth, 2400)).toBeCloseTo(10800, -1)
		expect(truthAt(truth, 2600)).toBeNull()
		expect(truthAt(truth, 4000)).toBeCloseTo(4000, -1)
		// Capped at bar 3, which nobody marked.
		expect(truthAt(truth, 8900)).toBe(8000)
		expect(truthAt(truth, 9100)).toBeNull()
	})

	it('ends a run at a jump, skips remarks and warns about what does not follow on', () => {
		const { runs, warnings } = resolveMarks([
			{ measure: 3, atMs: 1000 },
			{ type: 'partial', atMs: 1500, note: 'tenors' },
			{ measure: 4, atMs: 2000 },
			{ type: 'jump', atMs: 3000 },
			{ measure: 1, pass: 1, atMs: 3000 },
			{ measure: 3, atMs: 2500 },
			{ measure: 9, atMs: 4000 },
		], bars, 12000)
		expect(runs.map((r) => r.points.length)).toEqual([2, 2])
		expect(runs[0].endMs).toBe(3000)
		expect(warnings).toEqual([
			'mark 5: bar 3 does not follow on - a "jump" or "stop" missing before it?',
			'mark 6: bar 9 is not in the score',
		])
	})

	it('takes the bar after the last as the end of the piece', () => {
		const { runs } = resolveMarks([{ measure: 4, atMs: 0 }, { measure: 5, atMs: 2000 }], bars, 12000)
		expect(runs[0].points[1].scoreMs).toBe(12000)
	})
})

describe('loadAudio', () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'follow-'))
	afterAll(() => rmSync(dir, { recursive: true, force: true }))

	it('reads a 16-bit WAV without ffmpeg', () => {
		const samples = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i / 10) * 0.5)
		const file = path.join(dir, 'a.wav')
		writeFileSync(file, Buffer.from(encodeWav(samples, 16000)))
		const audio = loadAudio(file)
		expect(audio.sampleRate).toBe(16000)
		expect(audio.samples).toHaveLength(1600)
		expect(audio.samples[100]).toBeCloseTo(samples[100], 3)
	})
})
