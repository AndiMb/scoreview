import { afterEach, describe, expect, it, vi } from 'vitest'
import { readStored, writeStored } from './storage.js'

describe('storage', () => {
	afterEach(() => vi.unstubAllGlobals())

	it('reads and writes through localStorage', () => {
		const data = new Map()
		vi.stubGlobal('localStorage', {
			getItem: (k) => (data.has(k) ? data.get(k) : null),
			setItem: (k, v) => data.set(k, v),
			removeItem: (k) => data.delete(k),
		})
		expect(readStored('a')).toBe(null)
		writeStored('a', 3)
		expect(readStored('a')).toBe('3')
		writeStored('a', null)
		expect(readStored('a')).toBe(null)
	})

	it('swallows a throwing storage', () => {
		const boom = () => {
			throw new Error('SecurityError')
		}
		vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom })
		expect(readStored('a')).toBe(null)
		expect(() => writeStored('a', 'x')).not.toThrow()
		expect(() => writeStored('a', null)).not.toThrow()
	})

	it('copes without localStorage at all', () => {
		vi.stubGlobal('localStorage', undefined)
		expect(readStored('a')).toBe(null)
		expect(() => writeStored('a', 'x')).not.toThrow()
	})
})
