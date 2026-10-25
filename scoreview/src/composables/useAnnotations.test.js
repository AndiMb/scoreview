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

/**
 * A note is anchored against the base conversion; a display variant draws it
 * at its own segment (E19) - and falls back to the measure where the
 * variant has none.
 */
describe('useAnnotations on a display variant', () => {
	beforeEach(() => {
		axiosGet.mockReset()
	})

	it('draws a note anchored on base segment 4 at the variant segment for it', async () => {
		axiosGet.mockResolvedValueOnce({ data: [
			{ id: 1, elid: 4, anchorEtag: 'e', measureNumber: 1, fraction: 0, kind: 'note', visibility: 'private', mine: true, content: 'p' },
			{ id: 2, elid: 9, anchorEtag: 'e', measureNumber: 2, fraction: 0, kind: 'note', visibility: 'private', mine: true, content: 'q' },
		] })
		const notizen = useAnnotations({
			fileId: () => 42,
			timeline: () => ({ events: [], elements: { 1: { page: 0, x: 50, y: 0, w: 1, h: 1 } } }),
			measuresTimeline: () => ({ events: [], elements: { 0: { page: 0, x: 10, y: 0, w: 1, h: 1 }, 1: { page: 1, x: 20, y: 0, w: 1, h: 1 } } }),
			currentEtag: () => 'e',
			durationMs: () => 0,
			seek: vi.fn(),
			pictureElid: (elid) => (elid === 4 ? 1 : null),
		})
		await notizen.load()
		const byId = Object.fromEntries(notizen.markers.value.map((m) => [m.id, m]))
		expect(byId[1].x).toBe(50)
		// No variant segment for base 9: the measure's rectangle instead.
		expect(byId[2].x).toBe(20)
	})
})
