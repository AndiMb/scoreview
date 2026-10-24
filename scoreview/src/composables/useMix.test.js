import { describe, expect, it } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'
import { useMix } from './useMix.js'

const CHANNELS = [
	{ channel: 0, partId: '1', name: 'S', program: 52 },
	{ channel: 1, partId: '2', name: 'A', program: 52 },
	{ channel: 2, partId: null, name: 'Piano', program: 0 },
]

function setup({ partId = null } = {}) {
	const real = ref(false)
	const mixerChannels = shallowRef([])
	const myPartId = ref(partId)
	const othersLevel = ref(40)
	const applied = []
	const programs = []
	const mix = useMix({
		hasRealPlayer: () => real.value,
		mixerChannels,
		baseVolumes: () => new Map([[0, 100], [1, 100], [2, 90]]),
		myPartId: () => myPartId.value,
		othersLevel: () => othersLevel.value,
		applyChannelVolumes: (volumes) => applied.push([...volumes]),
		setProgram: (change) => programs.push(change),
	})
	async function startPlayer() {
		mixerChannels.value = [...CHANNELS]
		real.value = true
		await nextTick()
	}
	return { mix, real, mixerChannels, myPartId, othersLevel, applied, programs, startPlayer }
}

describe('useMix', () => {
	it('gives every channel the score\'s volume as soon as a player exists, before any slider moved (issue #17)', async () => {
		const t = setup()
		expect(t.applied).toEqual([])
		await t.startPlayer()
		expect(t.applied.at(-1)).toEqual([[0, 100], [1, 100], [2, 90]])
	})

	it('starts a remembered part already in focus', async () => {
		const t = setup({ partId: '2' })
		await t.startPlayer()
		expect(t.applied.at(-1)).toEqual([[0, 31], [1, 100], [2, 28]])
		expect(t.mix.state.value.focusKey).toBe('2')
	})

	it('brings every part back to the score when "my part" is cleared from outside', async () => {
		const t = setup({ partId: '2' })
		await t.startPlayer()
		t.myPartId.value = null
		await nextTick()
		expect(t.applied.at(-1)).toEqual([[0, 100], [1, 100], [2, 90]])
	})

	it('follows the "other parts" slider', async () => {
		const t = setup({ partId: '1' })
		await t.startPlayer()
		t.othersLevel.value = 127
		await nextTick()
		expect(t.applied.at(-1)).toEqual([[0, 100], [1, 100], [2, 90]])
	})

	it('keeps levels, mute and solo for the player - the panel only shows them', async () => {
		const t = setup()
		await t.startPlayer()
		t.mix.setLevel([1], 0.6)
		t.mix.toggleMute([2])
		await nextTick()
		expect(t.applied.at(-1)).toEqual([[0, 100], [1, 60], [2, 0]])
		expect(t.mix.state.value.channels[1].level).toBe(0.6)
	})

	it('starts again at the score\'s mix with a new player', async () => {
		const t = setup()
		await t.startPlayer()
		t.mix.setLevel([1], 0.2)
		await t.startPlayer()
		expect(t.applied.at(-1)).toEqual([[0, 100], [1, 100], [2, 90]])
	})

	it('silences channels for the wait mode and gives their level back', async () => {
		const t = setup()
		await t.startPlayer()
		t.mix.setLevel([1], 0.5)
		t.mix.silence([1])
		await nextTick()
		expect(t.applied.at(-1)).toEqual([[0, 100], [1, 0], [2, 90]])
		t.mix.silence(null)
		await nextTick()
		expect(t.applied.at(-1)).toEqual([[0, 100], [1, 50], [2, 90]])
	})

	describe('toggleFocus', () => {
		it('asks to remember a row with a part, and to forget it again', async () => {
			const t = setup()
			await t.startPlayer()
			expect(t.mix.toggleFocus({ key: '1', partId: '1', channels: [0] })).toBe('1')
			t.myPartId.value = '1'
			await nextTick()
			expect(t.mix.toggleFocus({ key: '1', partId: '1', channels: [0] })).toBeNull()
		})

		it('focuses a row without a part locally, without touching "my part"', async () => {
			const t = setup()
			await t.startPlayer()
			const group = { key: 'idx:2', partId: null, channels: [2] }
			expect(t.mix.toggleFocus(group)).toBeUndefined()
			await nextTick()
			expect(t.mix.state.value.focusKey).toBe('idx:2')
			expect(t.applied.at(-1)).toEqual([[0, 31], [1, 31], [2, 90]])
			t.mix.toggleFocus(group)
			await nextTick()
			expect(t.applied.at(-1)).toEqual([[0, 100], [1, 100], [2, 90]])
		})
	})

	it('shows and applies an instrument chosen in the mixer', async () => {
		const t = setup()
		await t.startPlayer()
		t.mix.changeProgram({ channel: 1, program: 53 })
		expect(t.mix.state.value.channels[1].program).toBe(53)
		expect(t.programs).toEqual([{ channel: 1, program: 53 }])
	})
})
