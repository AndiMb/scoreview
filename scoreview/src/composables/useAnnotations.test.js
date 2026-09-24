// In der Setliste wechselt die Partitur, während Notizanfragen noch laufen.
// Eine späte Antwort des vorigen Stücks darf die Liste des neuen nicht
// überschreiben - sonst stehen Notizen von A mit ihren Takten in B.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const axiosGet = vi.fn()
const axiosPost = vi.fn()

vi.mock('@nextcloud/axios', () => ({ default: { get: axiosGet, post: axiosPost, put: vi.fn(), delete: vi.fn() } }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (url) => url }))

const { useAnnotations } = await import('./useAnnotations.js')

function erzeuge() {
	return useAnnotations({
		fileId: () => 42,
		timeline: () => null,
		measuresTimeline: () => null,
		currentEtag: () => 'e',
		durationMs: () => 0,
		seek: vi.fn(),
	})
}

/** Eine Anfrage, deren Antwort der Test selbst auslöst. */
function haengend(mock) {
	let antworte
	mock.mockReturnValueOnce(new Promise((resolve) => {
		antworte = resolve
	}))
	return (data) => antworte({ data })
}

describe('useAnnotations', () => {
	beforeEach(() => {
		axiosGet.mockReset()
		axiosPost.mockReset()
	})

	it('verwirft eine Liste, die nach reset() eintrifft', async () => {
		const antworte = haengend(axiosGet)
		const notizen = erzeuge()

		const laufend = notizen.load()
		notizen.reset()
		antworte([{ id: 1, content: 'aus Stück A' }])
		await laufend

		expect(notizen.annotations.value).toEqual([])
	})

	it('hängt eine nach reset() gespeicherte Notiz nicht an das neue Stück', async () => {
		const antworte = haengend(axiosPost)
		const notizen = erzeuge()

		const laufend = notizen.create({ measureNumber: 3, fraction: 0, elid: null, anchorEtag: 'e', content: 'x', visibility: 'private' })
		notizen.reset()
		antworte({ id: 7, content: 'x' })
		await laufend

		expect(notizen.annotations.value).toEqual([])
	})

	it('übernimmt eine Antwort ohne Stückwechsel', async () => {
		axiosGet.mockResolvedValueOnce({ data: [{ id: 1, content: 'a' }] })
		const notizen = erzeuge()

		await notizen.load()

		expect(notizen.annotations.value).toHaveLength(1)
	})
})
