// The setlist changes the piece inside the viewer while requests are still
// out. What these guard against is silent: a late answer for a list that
// was closed meanwhile would reopen it and switch the piece under the
// singer's hands.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const axiosGet = vi.fn()
vi.mock('@nextcloud/axios', () => ({ default: { get: axiosGet } }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (url) => url }))
vi.mock('../l10n.js', () => ({ translate: (app, text) => text }))

const { useSetlist } = await import('./useSetlist.js')

const LIST = {
	id: 5,
	entries: [
		{ fileId: null, status: 'missing' },
		{ fileId: 11, status: 'ok' },
		{ fileId: 12, status: 'ok' },
	],
}

/**
 * @param {object} [options]
 * @param {boolean} [options.standalone]
 * @param {number} [options.fileId] the piece open at the start
 * @param {(action: string) => boolean} [options.can] the interaction policy
 */
function setup({ standalone = false, fileId = 10, can = () => true } = {}) {
	const state = { fileId }
	const setFileId = vi.fn((id) => {
		state.fileId = id
	})
	const setlist = useSetlist({ fileId: () => state.fileId, setFileId, standalone: () => standalone, originFileId: () => 10, can })
	return { setlist, setFileId }
}

/** A request the test settles itself. */
function pending() {
	const handle = {}
	axiosGet.mockReturnValueOnce(new Promise((resolve, reject) => {
		handle.answer = (data) => resolve({ data })
		handle.fail = reject
	}))
	return handle
}

describe('useSetlist', () => {
	beforeEach(() => {
		axiosGet.mockReset()
	})

	it('opens at the first playable piece and skips missing ones', async () => {
		axiosGet.mockResolvedValueOnce({ data: LIST })
		const { setlist, setFileId } = setup()
		expect(await setlist.open(5)).toBe(true)
		expect(setlist.index.value).toBe(1)
		expect(setFileId).toHaveBeenCalledWith(11)
		setlist.next()
		expect(setFileId).toHaveBeenLastCalledWith(12)
		setlist.previous()
		expect(setFileId).toHaveBeenLastCalledWith(11)
	})

	it('pages only where the policy allows it, and lets the leader move all the same', async () => {
		axiosGet.mockResolvedValueOnce({ data: LIST })
		const allowed = new Set(['nextPiece'])
		const { setlist, setFileId } = setup({ can: (action) => allowed.has(action) })
		await setlist.open(5)
		allowed.clear()
		setlist.next()
		setlist.goTo(2)
		expect(setFileId).toHaveBeenLastCalledWith(11)
		setlist.showEntry(2)
		expect(setFileId).toHaveBeenLastCalledWith(12)
	})

	it('toggles the editor under `settings` and closes it once saved', () => {
		const allowed = new Set()
		const { setlist } = setup({ can: (action) => allowed.has(action) })
		setlist.toggleEditor('new')
		expect(setlist.editorMode.value).toBe(null)
		allowed.add('settings')
		setlist.toggleEditor('new')
		expect(setlist.editorMode.value).toBe('new')
		setlist.toggleEditor('edit')
		expect(setlist.editorMode.value).toBe('edit')
		setlist.applySaved(LIST)
		expect(setlist.editorMode.value).toBe(null)
	})

	it('shows the server\'s reason when the list cannot be loaded, else its own text', async () => {
		const { setlist } = setup()
		axiosGet.mockRejectedValueOnce({ response: { status: 403, data: { error: 'No access to this setlist.' } } })
		expect(await setlist.open(5)).toBe(false)
		expect(setlist.error.value).toBe('No access to this setlist.')

		axiosGet.mockRejectedValueOnce(new Error('Network Error'))
		expect(await setlist.open(5)).toBe(false)
		expect(setlist.error.value).toBe('The setlist could not be loaded.')
		expect(setlist.active.value).toBe(false)
	})

	it('drops a list that arrives after close()', async () => {
		const { setlist, setFileId } = setup()
		const request = pending()
		const opened = setlist.open(5)
		setlist.close()
		request.answer(LIST)
		expect(await opened).toBe(false)
		expect(setlist.active.value).toBe(false)
		expect(setFileId).not.toHaveBeenCalled()
	})

	it('keeps quiet about a failure of a list that is no longer wanted', async () => {
		const { setlist } = setup()
		const first = pending()
		const opening = setlist.open(5)
		axiosGet.mockResolvedValueOnce({ data: LIST })
		await setlist.open(6)
		first.fail({ response: { data: { error: 'gone' } } })
		await opening
		expect(setlist.error.value).toBe('')
		expect(setlist.active.value).toBe(true)
	})

	it('stays at the open piece after saving, wherever it moved', async () => {
		axiosGet.mockResolvedValueOnce({ data: LIST })
		const { setlist, setFileId } = setup()
		await setlist.open(5)
		setFileId.mockClear()
		setlist.applySaved({ ...LIST, entries: [LIST.entries[2], LIST.entries[1]] })
		expect(setlist.index.value).toBe(1)
		expect(setFileId).not.toHaveBeenCalled()
	})

	it('offers nothing on the standalone page for a piece reached by paging', async () => {
		const { setlist } = setup({ standalone: true, fileId: 11 })
		await setlist.loadOffers()
		expect(axiosGet).not.toHaveBeenCalled()
		expect(setlist.offers.value).toEqual([])
	})

	it('treats failed offers as none, without an error over the score', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		axiosGet.mockRejectedValueOnce(new Error('Network Error'))
		const { setlist } = setup()
		await setlist.loadOffers()
		expect(setlist.offers.value).toEqual([])
		expect(setlist.canCreate.value).toBe(false)
		expect(setlist.error.value).toBe('')
		spy.mockRestore()
	})
})
