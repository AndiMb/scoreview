import { describe, expect, it } from 'vitest'
import { forward } from './forward.js'

describe('forward', () => {
	it('answers with the fallback until bound, then with the bound function', () => {
		const f = forward(() => false)
		expect(f.call()).toBe(false)
		f.to((x) => x * 2)
		expect(f.call(21)).toBe(42)
	})

	it('refuses a second binding', () => {
		const f = forward(() => null)
		f.to(() => 1)
		expect(() => f.to(() => 2)).toThrow()
		expect(f.call()).toBe(1)
	})
})
