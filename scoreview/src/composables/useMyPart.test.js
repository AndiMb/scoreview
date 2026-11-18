import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@nextcloud/axios', () => ({ default: { get: vi.fn(), put: vi.fn(async () => ({})) } }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (path) => path }))

const { useMyPart } = await import('./useMyPart.js')

describe('useMyPart myPartEntry', () => {
	it('finds my part among the score parts, ids compared as strings', async () => {
		const parts = ref([{ id: 1, name: 'Soprano' }, { id: 2, name: 'Alto' }])
		const myPart = useMyPart({ fileId: () => 7, parts: () => parts.value })
		expect(myPart.myPartEntry.value).toBeNull()
		await myPart.set('2')
		expect(myPart.myPartEntry.value).toEqual({ id: 2, name: 'Alto' })
		// A re-upload without that part: the choice stays, the entry goes.
		parts.value = [{ id: 1, name: 'Soprano' }]
		expect(myPart.myPartEntry.value).toBeNull()
		expect(myPart.myPartId.value).toBe('2')
	})
})
