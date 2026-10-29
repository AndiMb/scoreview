// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BAND_ZOOM_MAX, BAND_ZOOM_MIN } from '../lib/systemBand.js'
import { useBandZoom } from './useBandZoom.js'

describe('useBandZoom', () => {
	beforeEach(() => window.localStorage.clear())

	it('starts at the default size', () => {
		expect(useBandZoom().zoom.value).toBe(1)
	})

	it('keeps to its range', () => {
		const z = useBandZoom()
		z.set(10)
		expect(z.zoom.value).toBe(BAND_ZOOM_MAX)
		z.set(0.01)
		expect(z.zoom.value).toBe(BAND_ZOOM_MIN)
	})

	it('steps by 1.2 and resets', () => {
		const z = useBandZoom()
		z.zoomIn()
		expect(z.zoom.value).toBeCloseTo(1.2)
		expect(z.percent.value).toBe(120)
		z.zoomOut()
		expect(z.zoom.value).toBeCloseTo(1)
		z.set(2)
		z.reset()
		expect(z.zoom.value).toBe(1)
	})

	it('is kept on the device, and the default leaves nothing behind', () => {
		useBandZoom().set(1.5)
		expect(useBandZoom().zoom.value).toBe(1.5)
		useBandZoom().reset()
		expect(window.localStorage.getItem('scoreview-band-zoom')).toBeNull()
	})

	it('ignores a broken stored value', () => {
		window.localStorage.setItem('scoreview-band-zoom', 'nonsense')
		expect(useBandZoom().zoom.value).toBe(1)
	})

	describe('two fingers', () => {
		const touches = (distance) => ({ touches: [{ clientX: 100, clientY: 100 }, { clientX: 100 + distance, clientY: 100 }] })
		let frames
		beforeEach(() => {
			frames = []
			vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb))
			vi.stubGlobal('cancelAnimationFrame', () => {
				frames = []
			})
		})
		afterEach(() => vi.unstubAllGlobals())

		it('zooms by the change in distance, once per frame', () => {
			const z = useBandZoom()
			z.onTouchStart(touches(100))
			z.onTouchMove(touches(150))
			z.onTouchMove(touches(200))
			expect(frames).toHaveLength(1)
			expect(z.zoom.value).toBe(1)
			frames.shift()()
			expect(z.zoom.value).toBeCloseTo(2)
		})

		it('keeps to the range', () => {
			const z = useBandZoom()
			z.onTouchStart(touches(100))
			z.onTouchMove(touches(1000))
			frames.shift()()
			expect(z.zoom.value).toBe(BAND_ZOOM_MAX)
		})

		it('ignores one finger and ends when a finger lifts', () => {
			const z = useBandZoom()
			z.onTouchStart({ touches: [{ clientX: 0, clientY: 0 }] })
			z.onTouchMove(touches(300))
			expect(frames).toHaveLength(0)
			z.onTouchStart(touches(100))
			z.onTouchEnd({ touches: [{ clientX: 0, clientY: 0 }] })
			z.onTouchMove(touches(300))
			expect(frames).toHaveLength(0)
		})

		it('previews on the compositor and sets the zoom once, when the fingers let go', () => {
			const animation = { effect: { setKeyframes: vi.fn() }, cancel: vi.fn() }
			const target = {
				animate: vi.fn(() => animation),
				getBoundingClientRect: () => ({ left: 0, top: 0 }),
			}
			const withTarget = (event) => ({ ...event, currentTarget: target })
			const z = useBandZoom()
			z.onTouchStart(withTarget(touches(100)))
			z.onTouchMove(withTarget(touches(150)))
			frames.shift()()
			z.onTouchMove(withTarget(touches(200)))
			frames.shift()()
			expect(z.zoom.value).toBe(1)
			expect(target.animate).toHaveBeenCalledTimes(1)
			expect(target.animate.mock.calls[0][0][0].transform).toBe('scale(1.5)')
			expect(animation.effect.setKeyframes.mock.calls[0][0][0].transform).toBe('scale(2)')
			z.onTouchEnd(withTarget({ touches: [] }))
			expect(animation.cancel).toHaveBeenCalled()
			expect(z.zoom.value).toBeCloseTo(2)
		})

		it('drops a pending frame on stop', () => {
			const z = useBandZoom()
			z.onTouchStart(touches(100))
			z.onTouchMove(touches(200))
			z.stop()
			expect(frames).toHaveLength(0)
			expect(z.zoom.value).toBe(1)
		})
	})
})
