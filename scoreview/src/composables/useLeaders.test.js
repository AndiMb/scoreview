// Leader actions are checked on the server; what comes back as an error has
// to reach the person - and a late answer must not overwrite a newer state.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const axiosGet = vi.fn()
const axiosPost = vi.fn()
const axiosDelete = vi.fn()
vi.mock('@nextcloud/axios', () => ({ default: { get: axiosGet, post: axiosPost, delete: axiosDelete } }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (url) => url }))
vi.mock('../l10n.js', () => ({ translate: (app, text) => text }))

const { useLeaders } = await import('./useLeaders.js')

const ANSWER = { leaders: [{ userId: 'anna', displayName: 'Anna' }], isLeader: true }

/**
 * A request the test settles itself.
 *
 * @param {Function} mock
 */
function pending(mock) {
	const handle = {}
	mock.mockReturnValueOnce(new Promise((resolve, reject) => {
		handle.answer = (data) => resolve({ data })
		handle.fail = reject
	}))
	return handle
}

describe('useLeaders', () => {
	beforeEach(() => {
		axiosGet.mockReset()
		axiosPost.mockReset()
		axiosDelete.mockReset()
	})

	it('shows the server\'s reason when appointing is refused', async () => {
		axiosPost.mockRejectedValueOnce({ response: { status: 403, data: { error: 'Only the owner can appoint leaders.' } } })
		const leaders = useLeaders({ fileId: () => 1 })
		await leaders.appoint('bob')
		expect(leaders.error.value).toBe('Only the owner can appoint leaders.')
	})

	it('falls back to its own text without one', async () => {
		axiosPost.mockRejectedValueOnce(new Error('Network Error'))
		const leaders = useLeaders({ fileId: () => 1 })
		await leaders.appoint('bob')
		expect(leaders.error.value).toBe('Could not appoint this person.')
	})

	it('reloads the list after a failed removal, which may have been someone else\'s', async () => {
		axiosDelete.mockRejectedValueOnce({ response: { status: 404, data: {} } })
		axiosGet.mockResolvedValueOnce({ data: ANSWER })
		const leaders = useLeaders({ fileId: () => 1 })
		await leaders.revoke('anna')
		expect(leaders.error.value).toBe('Could not remove this leader.')
		await vi.waitFor(() => expect(leaders.isLeader.value).toBe(true))
		expect(axiosGet).toHaveBeenCalledTimes(1)
	})

	it('drops a list that arrives after reset()', async () => {
		const request = pending(axiosGet)
		const leaders = useLeaders({ fileId: () => 1 })
		const loading = leaders.load()
		leaders.reset()
		request.answer(ANSWER)
		await loading
		expect(leaders.leaders.value).toEqual([])
		expect(leaders.isLeader.value).toBe(false)
	})

	it('keeps the error of an outdated search to itself', async () => {
		const first = pending(axiosGet)
		axiosGet.mockResolvedValueOnce({ data: [{ userId: 'carl' }] })
		const leaders = useLeaders({ fileId: () => 1 })
		const searching = leaders.search('ca')
		await leaders.search('car')
		first.fail({ response: { data: { error: 'too slow' } } })
		await searching
		expect(leaders.error.value).toBe('')
		expect(leaders.candidates.value).toEqual([{ userId: 'carl' }])
	})

	it('shows the failure of the current search', async () => {
		axiosGet.mockRejectedValueOnce(new Error('Network Error'))
		const leaders = useLeaders({ fileId: () => 1 })
		await leaders.search('carl')
		expect(leaders.error.value).toBe('Search failed.')
		expect(leaders.candidates.value).toEqual([])
	})
})
