import { describe, expect, it, vi } from 'vitest'
import { cachedSvgPage, cacheSvgPage, clearSvgPageCache, staffBandsOf, svgPageCacheGeneration } from './svgPageCache.js'

vi.mock('../lib/staffBands.js', () => ({ findStaffBands: vi.fn(() => [{ top: 1, bottom: 2 }]) }))

describe('svgPageCache', () => {
	it('forgets every page when the viewer closes', () => {
		cacheSvgPage('a|0', { markup: '<svg/>' })
		expect(cachedSvgPage('a|0')).toBeDefined()
		clearSvgPageCache()
		expect(cachedSvgPage('a|0')).toBeUndefined()
	})

	it('drops a page that was still loading when the cache was cleared', () => {
		const before = svgPageCacheGeneration()
		clearSvgPageCache()
		cacheSvgPage('late|0', { markup: '<svg/>' }, before)
		expect(cachedSvgPage('late|0')).toBeUndefined()
		cacheSvgPage('late|0', { markup: '<svg/>' }, svgPageCacheGeneration())
		expect(cachedSvgPage('late|0')).toBeDefined()
		clearSvgPageCache()
	})

	it('finds the staff bands of a page once', async () => {
		const { findStaffBands } = await import('../lib/staffBands.js')
		const page = { markup: '<svg/>' }
		const first = staffBandsOf(page)
		expect(staffBandsOf(page)).toBe(first)
		expect(findStaffBands).toHaveBeenCalledTimes(1)
	})
})
