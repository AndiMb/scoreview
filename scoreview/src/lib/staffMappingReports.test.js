import { describe, expect, it } from 'vitest'
import { createStaffMappingReports } from './staffMappingReports.js'

describe('createStaffMappingReports', () => {
	it('stays yes when a later page cannot map', () => {
		const r = createStaffMappingReports()
		expect(r.report(0, true)).toBe(true)
		expect(r.report(1, false)).toBe(true)
	})
	it('is yes once any page can map, whatever the order', () => {
		const r = createStaffMappingReports()
		expect(r.report(1, false)).toBe(false)
		expect(r.report(0, true)).toBe(true)
	})
	it('follows a page changing its answer and forgets on clear', () => {
		const r = createStaffMappingReports()
		r.report(0, true)
		expect(r.report(0, false)).toBe(false)
		r.report(2, true)
		r.clear()
		expect(r.report(3, false)).toBe(false)
	})
})
