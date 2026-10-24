import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ambiguityOf, buildFollowReference, followParts, isVocal, notesToChroma, planEnsembles } from './followRef.js'
import { parseMidiNotes } from './midiNotes.js'
import { resolveMixerChannels } from './mixerLayout.js'

const fixture = (name) => readFileSync(new URL(`./__fixtures__/follow/${name}`, import.meta.url))

function part(id, vocal, channels = [Number(id)]) {
	return { id: String(id), label: `P${id}`, channels, vocal }
}

describe('followParts / isVocal', () => {
	it('reads the two sung parts of lyrics-test', () => {
		const meta = JSON.parse(fixture('lyrics-test.meta.json'))
		const midi = parseMidiNotes(fixture('lyrics-test.mid'))
		const channels = [...new Set(midi.notes.map((n) => n.channel))].sort().map((c) => [c])
		const mixer = resolveMixerChannels(meta.tracks, meta.parts, channels)
		const parts = followParts(mixer, meta.parts)
		expect(parts.map((p) => p.label)).toEqual(['Sopran', 'Bass'])
		expect(parts.every((p) => p.vocal)).toBe(true)
	})

	it('tells voices from instruments', () => {
		expect(isVocal({ instrumentId: 'grand-piano', program: 0 })).toBe(false)
		expect(isVocal({ instrumentId: 'grand-piano', program: 52 })).toBe(true)
		expect(isVocal({ instrumentId: 'grand-piano', lyricCount: 3 })).toBe(true)
		expect(isVocal({ instrumentId: 'tenor', program: 0 })).toBe(true)
		expect(isVocal({ instrumentId: 'bass-guitar', program: 33 })).toBe(false)
		expect(isVocal({ instrumentId: 'bassoon', program: 70 })).toBe(false)
	})
})

describe('planEnsembles', () => {
	it('SATB with piano: tutti, accompaniment, voices, each voice', () => {
		const ids = planEnsembles([part(0, true), part(1, true), part(2, true), part(3, true), part(4, false)]).map((e) => e.id)
		expect(ids).toEqual(['tutti', 'accompaniment', 'voices', 'part:0', 'part:1', 'part:2', 'part:3'])
	})

	it('a piano piece has tutti only', () => {
		expect(planEnsembles([part(0, false)]).map((e) => e.id)).toEqual(['tutti'])
	})

	it('pairs divided voices to stay within the limit', () => {
		const parts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => part(i, true))
		parts.push(part(8, false))
		const ensembles = planEnsembles(parts)
		expect(ensembles.length).toBeLessThanOrEqual(8)
		expect(ensembles.map((e) => e.id)).toContain('part:0+part:1')
	})
})

describe('notesToChroma', () => {
	it('marks frames without notes as silent and weighs partial frames', () => {
		const notes = [{ onMs: 0, offMs: 100, pitch: 60, channel: 0 }, { onMs: 175, offMs: 200, pitch: 67, channel: 0 }]
		const { chroma, silent } = notesToChroma(notes, new Set([0]), 5, 50)
		expect([...silent]).toEqual([0, 0, 1, 0, 1])
		// Middle C: pitch class 0 dominates, the fifth (third harmonic) follows.
		expect(chroma[0]).toBeGreaterThan(chroma[7])
		expect(chroma[7]).toBeGreaterThan(0)
	})

	it('ignores channels outside the ensemble', () => {
		const notes = [{ onMs: 0, offMs: 50, pitch: 60, channel: 3 }]
		expect([...notesToChroma(notes, new Set([0]), 1, 50).silent]).toEqual([1])
	})
})

describe('buildFollowReference', () => {
	// Two voices: a phrase, a bar of rest, the same phrase again, then
	// something different. The repetition must read as ambiguous.
	const phrase = [60, 62, 64, 65, 67, 65, 64, 62]
	const notes = []
	const add = (startMs, pitches, channel, offset = 0) => pitches.forEach((p, i) => notes.push({ onMs: startMs + i * 500, offMs: startMs + i * 500 + 480, pitch: p + offset, channel }))
	add(0, phrase, 0)
	add(0, phrase, 1, -12)
	add(6000, phrase, 0)
	add(6000, phrase, 1, -12)
	add(12000, [69, 71, 72, 74, 72, 71, 69, 67], 0)
	add(12000, [53, 55, 57, 59, 57, 55, 53, 52], 1)

	const reference = buildFollowReference(notes, [part(0, true), part(1, true)], { markersMs: [12000] })

	it('has a frame grid and one entry per ensemble', () => {
		expect(reference.frames).toBe(Math.ceil(16000 / 50))
		expect(reference.ensembles.map((e) => e.id)).toEqual(['tutti', 'part:0', 'part:1'])
		expect(reference.cens).toHaveLength(3)
	})

	it('finds the repeated phrase ambiguous and the new one not', () => {
		const at = (ms) => reference.ambiguity[Math.round(ms / reference.censMs)]
		expect(at(500)).toBeGreaterThan(0.9)
		expect(at(6500)).toBeGreaterThan(0.9)
		expect(at(12500)).toBeLessThan(at(500))
	})

	it('puts the entry prior at the start, after the rest and at the marker', () => {
		const at = (ms) => reference.entryPrior[Math.round(ms / reference.censMs)]
		expect(at(0)).toBe(1)
		expect(at(6000)).toBeGreaterThanOrEqual(0.6)
		expect(at(12000)).toBeGreaterThanOrEqual(0.8)
		expect(at(2000)).toBe(0)
	})
})

describe('ambiguityOf', () => {
	it('is linear in memory and symmetric', () => {
		const a = new Float32Array(12)
		a[0] = 1
		const b = new Float32Array(12)
		b[5] = 1
		const result = ambiguityOf([a, a, b, b, a, a], 2, 3)
		expect(result[0]).toBeCloseTo(1)
		expect(result[4]).toBeCloseTo(1)
		expect(result[2]).toBeLessThan(0.5)
	})
})
