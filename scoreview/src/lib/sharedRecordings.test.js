import { describe, expect, it } from 'vitest'
import { visibleSharedRecordings } from './sharedRecordings.js'

const parts = [{ id: '1', name: 'Sopran' }, { id: '2', name: 'Alt' }, { id: '3', name: 'Bass' }]
const forAlto = { id: 7, sharedParts: [{ id: '2', name: 'Alt' }] }
const forBass = { id: 8, sharedParts: [{ id: '3', name: 'Bass' }] }

describe('visibleSharedRecordings', () => {
	it('shows a singer the recordings for their part and hides the others', () => {
		const list = visibleSharedRecordings([forAlto, forBass], '2', parts, false)
		expect(list.map((r) => r.id)).toEqual([7])
		expect(list[0].dimmed).toBe(false)
		expect(list[0].voices).toEqual(['Alt'])
	})

	it('dims all of them for someone without a part - nothing is lost', () => {
		const list = visibleSharedRecordings([forAlto, forBass], null, parts, false)
		expect(list.map((r) => [r.id, r.dimmed])).toEqual([[7, true], [8, true]])
	})

	it('shows leaders every one', () => {
		expect(visibleSharedRecordings([forAlto, forBass], '1', parts, true).map((r) => r.id)).toEqual([7, 8])
	})

	it('keeps a recording whose parts are gone visible for all', () => {
		const orphan = { id: 9, sharedParts: [{ id: '99', name: 'Tenor' }] }
		expect(visibleSharedRecordings([orphan], '1', parts, false).map((r) => r.id)).toEqual([9])
	})
})
