import { describe, expect, it } from 'vitest'
import { serverError } from './serverError.js'

describe('serverError', () => {
	it('prefers the server text', () => {
		expect(serverError({ response: { data: { error: 'Nope' } } }, 'fb')).toBe('Nope')
	})
	it('falls back on missing, empty or non-string text', () => {
		expect(serverError({ response: { data: { error: '' } } }, 'fb')).toBe('fb')
		expect(serverError({ response: { data: {} } }, 'fb')).toBe('fb')
		expect(serverError({ response: { data: { error: 42 } } }, 'fb')).toBe('fb')
		expect(serverError(null, 'fb')).toBe('fb')
		expect(serverError(new Error('x'), 'fb')).toBe('fb')
	})
})
