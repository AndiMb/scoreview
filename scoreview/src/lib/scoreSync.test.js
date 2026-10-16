import { describe, expect, it, vi } from 'vitest'
import { buildTimeline } from './scoreLayout.js'
import { createScoreSync } from './scoreSync.js'

const timeline = buildTimeline({
	events: [
		{ elid: 1, timeMs: 0 },
		{ elid: 2, timeMs: 1000 },
		{ elid: 1, timeMs: 2000 },
	],
	elements: {
		1: { page: 0, x: 0, y: 0, w: 1, h: 1 },
		2: { page: 0, x: 5, y: 0, w: 1, h: 1 },
	},
})

describe('createScoreSync', () => {
	it('liefert das elid und meldet nur einen Wechsel des Rechtecks', () => {
		const onChange = vi.fn()
		const sync = createScoreSync(timeline, onChange)
		expect(sync.update(0)).toBe(1)
		expect(sync.update(500)).toBe(1)
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(sync.update(1500)).toBe(2)
		expect(onChange).toHaveBeenLastCalledWith(timeline.elements['2'])
		expect(onChange).toHaveBeenCalledTimes(2)
	})

	it('meldet nach reset() dasselbe Rechteck erneut', () => {
		const onChange = vi.fn()
		const sync = createScoreSync(timeline, onChange)
		sync.update(0)
		sync.reset()
		sync.update(0)
		expect(onChange).toHaveBeenCalledTimes(2)
	})

	it('bleibt bei leerer Zeitachse still', () => {
		const onChange = vi.fn()
		const sync = createScoreSync(buildTimeline({ events: [], elements: {} }), onChange)
		expect(sync.update(100)).toBeNull()
		expect(onChange).not.toHaveBeenCalled()
	})
})
