import { describe, expect, it } from 'vitest'
import { clampLevel, createMixState, effectiveVolumes, focusForPart, focusVolumes, othersFactor, scaledVolume, withChannels, withFocus } from './mixState.js'

const channels = [
	{ channel: 0, partId: '1', name: 'S', program: 52 },
	{ channel: 2, partId: '2', name: 'A', program: 52 },
	{ channel: 3, partId: '2', name: 'A', program: 53 },
]
const base = new Map([[0, 100], [2, 100], [3, 80]])

describe('createMixState', () => {
	it('starts at the score\'s mix with the score\'s instruments', () => {
		const state = createMixState(channels)
		expect(state.focusKey).toBeNull()
		expect(state.channels[3]).toEqual({ level: 1, muted: false, solo: false, program: 53 })
	})

	it('plays exactly the score\'s CC7 - nothing louder for a slider never touched (issue #17)', () => {
		expect([...effectiveVolumes(createMixState(channels), base)]).toEqual([[0, 100], [2, 100], [3, 80]])
	})

	it('takes the GM default for a channel the score gives no volume', () => {
		expect(effectiveVolumes(createMixState(channels), new Map()).get(0)).toBe(100)
	})
})

describe('effectiveVolumes', () => {
	it('without solo only each channel\'s own mute counts', () => {
		const state = withChannels(createMixState(channels), [2], { muted: true })
		expect([...effectiveVolumes(state, base)]).toEqual([[0, 100], [2, 0], [3, 80]])
	})

	it('with a solo only solo channels that are not muted are heard', () => {
		let state = withChannels(createMixState(channels), [0, 3], { solo: true })
		state = withChannels(state, [3], { muted: true })
		expect([...effectiveVolumes(state, base)]).toEqual([[0, 100], [2, 0], [3, 0]])
	})

	it('scales the score\'s volume by the level', () => {
		const state = withChannels(createMixState(channels), [3], { level: 0.5 })
		expect(effectiveVolumes(state, base).get(3)).toBe(40)
	})

	it('holds channels silent from outside without touching their state (wait mode)', () => {
		const state = createMixState(channels)
		expect([...effectiveVolumes(state, base, new Set([2, 3]))]).toEqual([[0, 100], [2, 0], [3, 0]])
		expect(state.channels[2].level).toBe(1)
	})
})

describe('withFocus', () => {
	it('keeps my part at the score\'s mix and lowers the others to the "other parts" level', () => {
		const state = withFocus(createMixState(channels), focusForPart(channels, '2'), 40)
		expect(state.focusKey).toBe('2')
		expect([...effectiveVolumes(state, base)]).toEqual([[0, 31], [2, 100], [3, 80]])
	})

	it('without focus brings every level back to the score and keeps mute', () => {
		let state = withChannels(createMixState(channels), [0], { muted: true })
		state = withFocus(state, focusForPart(channels, '2'), 40)
		state = withFocus(state, null, 40)
		expect(state.focusKey).toBeNull()
		expect(Object.values(state.channels).map((c) => c.level)).toEqual([1, 1, 1])
		expect(state.channels[0].muted).toBe(true)
	})

	it('leaves the state it got unchanged', () => {
		const before = createMixState(channels)
		withFocus(before, focusForPart(channels, '1'), 0)
		expect(before.channels[2].level).toBe(1)
	})
})

describe('focusForPart', () => {
	it('compares the part id as text (the server sends text, meta.json numbers)', () => {
		expect(focusForPart(channels, 2)).toEqual({ key: '2', channels: [2, 3] })
	})

	it('gives null without a part or for a part no row plays', () => {
		expect(focusForPart(channels, null)).toBeNull()
		expect(focusForPart(channels, '9')).toBeNull()
	})
})

describe('focusVolumes', () => {
	it('is the focused mix without a mixer state - for coach and export', () => {
		expect([...focusVolumes({ channels: [0, 2, 3], myChannels: [0], othersLevel: 40, baseVolumes: base })]).toEqual([[0, 100], [2, 31], [3, 25]])
	})
})

describe('levels', () => {
	it('clamps the "other parts" level and falls back on nonsense', () => {
		expect(clampLevel(200)).toBe(127)
		expect(clampLevel('x')).toBe(40)
		expect(othersFactor(127)).toBe(1)
	})

	it('never leaves 0..127', () => {
		expect(scaledVolume(127, 1.2)).toBe(127)
		expect(scaledVolume(100, -1)).toBe(0)
	})
})
