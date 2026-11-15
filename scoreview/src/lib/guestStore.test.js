import { afterEach, describe, expect, it, vi } from 'vitest'
import { GUEST_KEYS, readGuest, writeGuest } from './guestStore.js'

function memoryStorage() {
	const data = new Map()
	return {
		data,
		getItem: (k) => (data.has(k) ? data.get(k) : null),
		setItem: (k, v) => data.set(k, String(v)),
		removeItem: (k) => data.delete(k),
	}
}

describe('guestStore', () => {
	afterEach(() => vi.unstubAllGlobals())

	it('keeps a value across a write and a read', () => {
		vi.stubGlobal('localStorage', memoryStorage())
		writeGuest(GUEST_KEYS.prefs, { layout: 'band', referencePitch: 442 })
		expect(readGuest(GUEST_KEYS.prefs)).toEqual({ layout: 'band', referencePitch: 442 })
	})

	it('names one key per score for the part and the practice settings', () => {
		expect(GUEST_KEYS.prefs).toBe('scoreview.guest.prefs')
		expect(GUEST_KEYS.myPart(7)).toBe('scoreview.guest.myPart.7')
		expect(GUEST_KEYS.practice('7')).toBe('scoreview.guest.practice.7')
	})

	it('reads null for nothing stored and for what is not JSON', () => {
		const storage = memoryStorage()
		vi.stubGlobal('localStorage', storage)
		expect(readGuest('scoreview.guest.prefs')).toBe(null)
		storage.data.set('scoreview.guest.prefs', '{broken')
		expect(readGuest('scoreview.guest.prefs')).toBe(null)
	})

	it('reads null and writes nothing when localStorage throws', () => {
		const boom = () => {
			throw new Error('SecurityError')
		}
		vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom })
		expect(readGuest('scoreview.guest.prefs')).toBe(null)
		expect(() => writeGuest('scoreview.guest.prefs', { a: 1 })).not.toThrow()
	})

	it('removes the entry for null', () => {
		const storage = memoryStorage()
		vi.stubGlobal('localStorage', storage)
		writeGuest('scoreview.guest.myPart.7', 'P2')
		writeGuest('scoreview.guest.myPart.7', null)
		expect(storage.data.has('scoreview.guest.myPart.7')).toBe(false)
	})
})
