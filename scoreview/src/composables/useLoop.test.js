import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
// The loop's single numeric range: what playback jumps back to must be what
// markers and every other reader see, also after the fields change mid-loop.
import { useLoop } from './useLoop.js'

const MEASURES = {
	events: [0, 1, 2, 3].map((elid) => ({ elid, timeMs: elid * 1000 })),
	elements: Object.fromEntries([0, 1, 2, 3].map((i) => [String(i), { page: 0, x: i * 100, y: 0, w: 100, h: 50 }])),
}

function makeLoop({ playing = false } = {}) {
	const deps = {
		measuresTimeline: () => MEASURES,
		durationMs: () => 4000,
		isPlaying: () => playing,
		seek: vi.fn(),
		startCountIn: vi.fn(),
		clearCountIn: vi.fn(),
		onWrap: vi.fn(),
	}
	return { loop: useLoop(deps), deps }
}

describe('useLoop', () => {
	it('freezes the range on toggle and jumps back at its end', () => {
		const { loop, deps } = makeLoop()
		loop.fromMeasure.value = 2
		loop.toMeasure.value = 3
		loop.toggle()
		expect(loop.range.value).toEqual({ from: 2, to: 3, startMs: 1000, endMs: 3000 })
		expect(deps.seek).toHaveBeenCalledWith(1000)
		expect(deps.startCountIn).toHaveBeenCalledWith(1000)
		expect(loop.wrapIfDue(2999)).toBe(false)
		expect(loop.wrapIfDue(3000)).toBe(true)
		expect(deps.seek).toHaveBeenLastCalledWith(1000)
	})

	it('moves the loop itself when a field changes while it runs', async () => {
		const { loop } = makeLoop()
		loop.fromMeasure.value = 1
		loop.toMeasure.value = 3
		loop.toggle()
		loop.toMeasure.value = 2
		await nextTick()
		expect(loop.endMs.value).toBe(2000)
		expect(loop.restartTarget(2000)).toBe(0)
		expect(loop.markers.value.map((m) => m.x)).toEqual([0, 100])
	})

	it('keeps the last valid range while a field is empty', async () => {
		const { loop } = makeLoop()
		loop.fromMeasure.value = 1
		loop.toMeasure.value = 3
		loop.toggle()
		loop.toMeasure.value = ''
		await nextTick()
		expect(loop.range.value).toEqual({ from: 1, to: 3, startMs: 0, endMs: 3000 })
	})

	it('leaves the range alone while off', async () => {
		const { loop } = makeLoop()
		loop.fromMeasure.value = 1
		loop.toMeasure.value = 2
		await nextTick()
		expect(loop.range.value).toBeNull()
		expect(loop.markers.value).toEqual([])
	})

	it('does not switch on for a backwards range', () => {
		const { loop, deps } = makeLoop()
		loop.fromMeasure.value = 3
		loop.toMeasure.value = 2
		loop.toggle()
		expect(loop.active.value).toBe(false)
		expect(deps.seek).not.toHaveBeenCalled()
	})

	it('setRange applies at once, without seek or count-in', () => {
		const { loop, deps } = makeLoop()
		expect(loop.setRange(2, 4)).toBe(true)
		expect(loop.range.value).toEqual({ from: 2, to: 4, startMs: 1000, endMs: 4000 })
		expect(loop.fromMeasure.value).toBe(2)
		expect(deps.seek).not.toHaveBeenCalled()
		expect(loop.setRange(4, 2)).toBe(false)
	})

	it('clears the range when switched off', () => {
		const { loop, deps } = makeLoop()
		loop.setRange(1, 2)
		loop.toggle()
		expect(loop.range.value).toBeNull()
		expect(loop.startMs.value).toBeNull()
		expect(deps.clearCountIn).toHaveBeenCalled()
	})
})
