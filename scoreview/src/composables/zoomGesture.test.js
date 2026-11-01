import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createZoomGesture, IDLE_MS } from './zoomGesture.js'

function fakePreview(supported) {
	return {
		shown: [],
		started: null,
		ended: 0,
		supported: () => supported,
		startAt(el, x, y) {
			this.started = { x, y }
		},
		show(scale) {
			this.shown.push(scale)
		},
		end() {
			this.ended++
		},
	}
}

const box = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 100 }) }

function setUp(supported) {
	let zoom = 1
	const commits = []
	const preview = fakePreview(supported)
	const gesture = createZoomGesture({
		target: () => box,
		current: () => zoom,
		clamp: (value) => Math.min(4, Math.max(0.25, value)),
		commit: (value) => {
			zoom = value
			commits.push(value)
		},
		preview,
	})
	return { gesture, commits, preview, zoom: () => zoom }
}

describe('createZoomGesture', () => {
	let frames
	beforeEach(() => {
		vi.useFakeTimers()
		frames = []
		vi.stubGlobal('requestAnimationFrame', (fn) => frames.push(fn))
		vi.stubGlobal('cancelAnimationFrame', () => {})
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})
	const flushFrame = () => frames.splice(0).forEach((fn) => fn())

	it('previews a wheel gesture and sets the zoom once after a rest', () => {
		const { gesture, commits, preview } = setUp(true)
		for (let i = 0; i < 10; i++) {
			gesture.by(1.2, { x: 40, y: 30 })
		}
		flushFrame()
		expect(commits).toEqual([])
		expect(preview.started).toEqual({ x: 40, y: 30 })
		expect(preview.shown).toHaveLength(1)
		vi.advanceTimersByTime(IDLE_MS)
		expect(commits).toEqual([4])
		expect(preview.ended).toBe(1)
	})

	it('sets the slider value on change, without waiting', () => {
		const { gesture, commits } = setUp(true)
		gesture.to(2)
		gesture.to(2.5)
		gesture.finish()
		expect(commits).toEqual([2.5])
		vi.advanceTimersByTime(IDLE_MS)
		expect(commits).toEqual([2.5])
	})

	it('scales the slider preview around the middle of what is seen', () => {
		const { gesture, preview } = setUp(true)
		gesture.to(2)
		expect(preview.started).toEqual({ x: 100, y: 50 })
	})

	it('without a preview sets the zoom at most once per frame', () => {
		const { gesture, commits } = setUp(false)
		gesture.to(1.5)
		gesture.to(1.6)
		gesture.to(1.7)
		flushFrame()
		expect(commits).toEqual([1.7])
		vi.advanceTimersByTime(IDLE_MS)
		expect(commits).toEqual([1.7])
	})

	it('drops a cancelled gesture', () => {
		const { gesture, commits } = setUp(true)
		gesture.by(2)
		gesture.cancel()
		vi.advanceTimersByTime(IDLE_MS)
		expect(commits).toEqual([])
		expect(gesture.pending()).toBe(null)
	})
})
