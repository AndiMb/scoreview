import { describe, expect, it } from 'vitest'
import { createLru } from './lruCache.js'

describe('createLru', () => {
	it('vergisst das am laengsten Ungenutzte zuerst', () => {
		const cache = createLru(2)
		cache.set('a', 1)
		cache.set('b', 2)
		cache.get('a')
		cache.set('c', 3)
		expect(cache.get('b')).toBeUndefined()
		expect(cache.get('a')).toBe(1)
		expect(cache.get('c')).toBe(3)
	})

	it('ersetzt einen Wert, ohne zu wachsen', () => {
		const cache = createLru(1)
		cache.set('a', 1)
		cache.set('a', 2)
		expect(cache.get('a')).toBe(2)
		cache.clear()
		expect(cache.get('a')).toBeUndefined()
	})
})
