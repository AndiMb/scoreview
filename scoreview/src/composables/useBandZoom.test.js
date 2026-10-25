// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
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
})
