import { describe, expect, it } from 'vitest'
import { ConversionError, EXIT_CODES, exitCodeOf } from './errors.mjs'

describe('exitCodeOf', () => {
	it('gives a score without pages its own code', () => {
		expect(exitCodeOf(new ConversionError('no_pages', 'The engine returned no SVG page.'))).toBe(EXIT_CODES.no_pages)
	})

	it('keeps 1 for everything else', () => {
		expect(exitCodeOf(new Error('boom'))).toBe(1)
		expect(exitCodeOf(new ConversionError('not_a_code', 'x'))).toBe(1)
		expect(exitCodeOf('a string')).toBe(1)
		expect(exitCodeOf(undefined)).toBe(1)
	})

	it('does not take a Node system error code for one of ours', () => {
		const error = new Error('ENOENT: no such file')
		error.code = 'no_pages'
		expect(exitCodeOf(error)).toBe(1)
	})

	it('uses codes that cannot be mistaken for success, a crash or a signal', () => {
		// LocalConverter and the sidecar mirror these numbers; 0 is success,
		// 1 Node's own failure, and from 128 on a shell reports signals.
		for (const code of Object.values(EXIT_CODES)) {
			expect(code).toBeGreaterThan(1)
			expect(code).toBeLessThan(128)
		}
		expect(new Set(Object.values(EXIT_CODES)).size).toBe(Object.values(EXIT_CODES).length)
	})
})
