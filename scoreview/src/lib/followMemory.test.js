import { describe, expect, it } from 'vitest'
import { decodeMemory, encodeMemory, MAX_AGE_MS, memoryKey } from './followMemory.js'

describe('followMemory', () => {
	it('round-trips for the same conversion', () => {
		const raw = encodeMemory('etag-1', 42123.4, 1000)
		expect(decodeMemory(raw, 'etag-1', 2000)).toBe(42123)
	})

	it('forgets for another conversion, when too old, or when broken', () => {
		const raw = encodeMemory('etag-1', 5000, 0)
		expect(decodeMemory(raw, 'etag-2', 10)).toBeNull()
		expect(decodeMemory(raw, 'etag-1', MAX_AGE_MS + 1)).toBeNull()
		expect(decodeMemory('{not json', 'etag-1', 10)).toBeNull()
		expect(decodeMemory(null, 'etag-1', 10)).toBeNull()
		expect(decodeMemory(JSON.stringify({ etag: 'etag-1', timeMs: -5, savedAt: 0 }), 'etag-1', 10)).toBeNull()
	})

	it('keys by file', () => {
		expect(memoryKey(1233)).toBe('scoreview.follow.1233')
	})
})
