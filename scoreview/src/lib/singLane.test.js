import { describe, expect, it } from 'vitest'
import { buildLyrics } from './lyricsLayout.js'
import { firstNoteFrom, labelText, laneSyllables, laneWindow, NOW_AT, pitchRange, sungPitch, syllableIndex, syllablesIn, xOf, yOf } from './singLane.js'

const hzOf = (pitch, cents = 0) => 440 * 2 ** ((pitch - 69 + cents / 100) / 12)

describe('laneWindow', () => {
	it('shows 2 s behind and 4 s ahead in real time', () => {
		expect(laneWindow(10000, 1)).toEqual({ fromMs: 8000, toMs: 14000, nowMs: 10000 })
		expect(laneWindow(10000, 0.5)).toEqual({ fromMs: 9000, toMs: 12000, nowMs: 10000 })
		expect(laneWindow(10000, 1.5)).toEqual({ fromMs: 7000, toMs: 16000, nowMs: 10000 })
	})

	it('puts now a third in', () => {
		const win = laneWindow(10000, 1)
		expect(xOf(10000, win, 900)).toBeCloseTo(900 * NOW_AT, 6)
		expect(NOW_AT).toBeCloseTo(1 / 3, 6)
	})
})

describe('pitchRange and yOf', () => {
	it('spans my notes with a semitone to spare', () => {
		expect(pitchRange([{ pitch: 60 }, { pitch: 72 }])).toEqual({ low: 59, high: 73 })
	})

	it('is at least seven semitones wide, centred', () => {
		expect(pitchRange([{ pitch: 64 }])).toEqual({ low: 61, high: 68 })
		expect(pitchRange([])).toEqual({ low: 57, high: 69 })
	})

	it('puts high pitches at the top', () => {
		const range = { low: 60, high: 69 }
		expect(yOf(69, range, 100)).toBeCloseTo(5, 6)
		expect(yOf(60, range, 100)).toBeCloseTo(95, 6)
		expect(yOf(64.5, range, 100)).toBeCloseTo(50, 6)
	})
})

describe('sungPitch', () => {
	it('folds onto the octave of the reference', () => {
		expect(sungPitch({ hz: 220, clarity: 1 }, 69)).toBeCloseTo(69, 6)
		expect(sungPitch({ hz: 220, clarity: 1 }, 57)).toBeCloseTo(57, 6)
		expect(sungPitch({ hz: hzOf(64, -30), clarity: 1 }, 64)).toBeCloseTo(63.7, 6)
	})

	it('has nothing for unvoiced frames', () => {
		expect(sungPitch({ hz: null, clarity: 0 }, 64)).toBeNull()
		expect(sungPitch({ hz: 300, clarity: 0.2 }, 64)).toBeNull()
	})
})

describe('labelText', () => {
	const t = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k])

	it('names what was off, with cents', () => {
		expect(labelText({ kind: 'perfect', value: null }, t)).toBe('Perfect')
		expect(labelText({ kind: 'low', value: -42 }, t)).toBe('low −42 ct')
		expect(labelText({ kind: 'late', value: 150 }, t)).toBe('late')
		expect(labelText({ kind: 'notHeard', value: null }, t)).toBe('not heard')
	})
})

describe('laneSyllables', () => {
	const syllables = [
		{ elid: 10, staff: 0, voice: 0, verse: 1, syllabic: 'begin', text: 'Ma' },
		{ elid: 11, staff: 0, voice: 0, verse: 1, syllabic: 'end', text: 'ry' },
		{ elid: 12, staff: 0, voice: 0, verse: 1, syllabic: 'single', text: 'sang' },
	]
	const { blocks } = buildLyrics({ syllables, staves: [0] })
	const events = [{ elid: 10 }, { elid: 11 }, { elid: 99 }, { elid: 12 }]
	const times = [0, 500, 750, 1000]

	it('writes the sung syllables inside the window', () => {
		const out = laneSyllables({ blocks, events, times, fromMs: 0, toMs: 800 })
		expect(out.map((s) => s.scoreMs)).toEqual([0, 500])
		expect(out[0].text).toMatch(/^Ma/)
		expect(out[1].text).toBe('ry')
	})

	it('has none without lyrics', () => {
		expect(laneSyllables({ blocks: [], events, times, fromMs: 0, toMs: 2000 })).toEqual([])
	})
})

describe('syllable index and window', () => {
	const syllables = [
		{ elid: 10, staff: 0, voice: 0, verse: 1, syllabic: 'single', text: 'one' },
		{ elid: 11, staff: 0, voice: 0, verse: 1, syllabic: 'single', text: 'two' },
		{ elid: 10, staff: 0, voice: 0, verse: 2, syllabic: 'single', text: 'three' },
		{ elid: 11, staff: 0, voice: 0, verse: 2, syllabic: 'single', text: 'four' },
	]
	const { blocks } = buildLyrics({ syllables, staves: [0] })
	// A repeat: the second pass sings verse 2.
	const events = [{ elid: 10 }, { elid: 11 }, { elid: 10 }, { elid: 11 }]
	const times = [0, 500, 1000, 1500]

	it('takes the verse of each pass and keeps score order', () => {
		const index = syllableIndex(blocks, events, times)
		expect(index.sorted).toBe(true)
		expect(index.entries.map((e) => e.text)).toEqual(['one', 'two', 'three', 'four'])
		expect(syllablesIn(index, 400, 1000).map((e) => e.scoreMs)).toEqual([500, 1000])
		expect(syllablesIn(index, 2000, 3000)).toEqual([])
	})

	it('answers each frame alike, built once or anew', () => {
		const first = laneSyllables({ blocks, events, times, fromMs: 0, toMs: 600 })
		expect(laneSyllables({ blocks, events, times, fromMs: 0, toMs: 600 })).toEqual(first)
		expect(laneSyllables({ blocks, events: [...events], times, fromMs: 900, toMs: 1600 }).map((s) => s.text)).toEqual(['three', 'four'])
	})

	it('reads all syllables where the times run backwards', () => {
		const index = syllableIndex(blocks, events, [0, 500, 200, 1500])
		expect(index.sorted).toBe(false)
		expect(syllablesIn(index, 100, 600).map((e) => e.scoreMs)).toEqual([500, 200])
	})

	it('starts the bars at the first note that can still reach the window', () => {
		const notes = [{ onMs: 0 }, { onMs: 100 }, { onMs: 900 }, { onMs: 1000 }, { onMs: 2000 }]
		expect(firstNoteFrom(notes, 1000, 200)).toBe(2)
		expect(firstNoteFrom(notes, 1000, 0)).toBe(3)
		expect(firstNoteFrom(notes, -50, 0)).toBe(0)
		expect(firstNoteFrom(notes, 5000, 0)).toBe(5)
	})
})
