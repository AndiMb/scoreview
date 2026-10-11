import { describe, expect, it } from 'vitest'
import { needleChanged } from './intonation.js'

describe('needleChanged', () => {
	it('draws the first needle', () => {
		expect(needleChanged(null, { cents: 3, cls: 'green' })).toBe(true)
	})

	it('ignores changes below one cent within the same class', () => {
		expect(needleChanged({ cents: 3.1, cls: 'green' }, { cents: 3.4, cls: 'green' })).toBe(false)
	})

	it('redraws for a different rounded cent value or class', () => {
		expect(needleChanged({ cents: 3.1, cls: 'green' }, { cents: 3.6, cls: 'green' })).toBe(true)
		expect(needleChanged({ cents: 24.6, cls: 'green' }, { cents: 24.6, cls: 'yellow' })).toBe(true)
	})

	it('treats "not evaluable" as a value of its own', () => {
		expect(needleChanged({ cents: null, cls: 'na' }, { cents: null, cls: 'na' })).toBe(false)
		expect(needleChanged({ cents: null, cls: 'na' }, { cents: 0, cls: 'na' })).toBe(true)
	})
})
