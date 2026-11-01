// Der Viewer pollte den Statusendpunkt ohne Obergrenze: Läuft der Cron einer
// Instanz nicht, kommt `ConvertScoreJob` nie bis `createPending()`, der
// Statusendpunkt antwortet für immer `pending` (siehe
// ConversionController::pendingOrClient) - und der Kreisel drehte sich, so
// lange die Seite offen blieb. Genau dieser Fall steht in
// docs/troubleshooting.md als „Der Viewer dreht sich endlos".
//
// Geprüft wird deshalb beides: dass nach der Frist Schluss ist, und dass der
// Hinweis davor erscheint, ohne das Warten abzubrechen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const axiosGet = vi.fn()
const axiosPost = vi.fn()
const showWarning = vi.fn()

vi.mock('@nextcloud/axios', () => ({ default: { get: axiosGet, post: axiosPost } }))
vi.mock('@nextcloud/dialogs', () => ({ showWarning }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (url) => url }))
vi.mock('@nextcloud/l10n', () => ({ translate: (app, text) => text }))
// Der Rückfall im Browser ist hier nicht die Frage - er soll nur nicht
// mitlaufen. `progress: null` heißt „serverseitig konvertiert".
const clientRun = vi.fn()
const clientRunVariant = vi.fn()
vi.mock('./useClientConversion.js', () => ({
	useClientConversion: () => ({ run: clientRun, runVariant: clientRunVariant, release: vi.fn(), progress: { value: null } }),
}))

const { useConversionStatus } = await import('./useConversionStatus.js')
const { STATUS_POLL_MAX_MS } = await import('../lib/conversionPoll.js')

/**
 * Die Frist aus dem Modul, plus zwei Poll-Takte: Die Frist wird erst vom
 * ERSTEN Abruf dahinter bemerkt - genau auf ihr laeuft das Warten noch. By
 * then the delay has grown to its ceiling (lib/conversionPoll.js).
 */
const NACH_DER_FRIST_MS = 1_860_000 + 2 * STATUS_POLL_MAX_MS
const LANGE_WARTEZEIT_MS = 120_000

describe('useConversionStatus', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		axiosGet.mockReset()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	/** Antwortet dauerhaft „wird noch konvertiert" - die Instanz ohne Cron. */
	function bleibtPending() {
		axiosGet.mockResolvedValue({ data: { status: 'pending' } })
	}

	it('gibt nach der Frist auf, statt weiter zu pollen', async () => {
		bleibtPending()
		const status = useConversionStatus({ fileId: () => 42, onReady: vi.fn() })

		await status.poll()
		expect(status.state.value).toBe('converting')

		await vi.advanceTimersByTimeAsync(NACH_DER_FRIST_MS)

		expect(status.state.value).toBe('error')
		// Derselbe Code wie serverseitig - für die Nutzerin ist es derselbe
		// Befund, und er trägt deshalb auch denselben Satz.
		expect(status.errorCode.value).toBe('stale')

		// Und danach ist wirklich Schluss: kein weiterer Abruf.
		const abrufe = axiosGet.mock.calls.length
		await vi.advanceTimersByTimeAsync(60_000)
		expect(axiosGet.mock.calls.length).toBe(abrufe)
	})

	it('meldet eine ungewöhnlich lange Wartezeit, ohne das Warten abzubrechen', async () => {
		bleibtPending()
		const status = useConversionStatus({ fileId: () => 42, onReady: vi.fn() })

		await status.poll()
		expect(status.langeWartezeit.value).toBe(false)

		await vi.advanceTimersByTimeAsync(LANGE_WARTEZEIT_MS + STATUS_POLL_MAX_MS)

		expect(status.langeWartezeit.value).toBe(true)
		// Der Kreisel dreht weiter - der Hinweis ist eine Auskunft, kein Urteil.
		expect(status.state.value).toBe('converting')
	})

	it('keeps the score after a rate-limited reconversion instead of showing an error', async () => {
		axiosGet.mockResolvedValue({ data: { status: 'ready', files: {} } })
		axiosPost.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 429'), { response: { status: 429 } }))
		const onReady = vi.fn()
		const status = useConversionStatus({ fileId: () => 42, onReady })
		await status.poll()
		onReady.mockClear()

		await status.reconvert()

		expect(showWarning).toHaveBeenCalledTimes(1)
		expect(status.state.value).not.toBe('error')
		// Nothing was discarded on the server: the poll brings the result back.
		expect(onReady).toHaveBeenCalledTimes(1)
	})

	it('meldet keine lange Wartezeit, wenn die Konvertierung zügig fertig wird', async () => {
		axiosGet.mockResolvedValue({ data: { status: 'ready', files: {} } })
		const status = useConversionStatus({ fileId: () => 42, onReady: vi.fn() })

		await status.poll()

		expect(status.state.value).toBe('ready')
		expect(status.langeWartezeit.value).toBe(false)
	})

	it('faengt nach reset() von vorn an zu zaehlen', async () => {
		bleibtPending()
		const status = useConversionStatus({ fileId: () => 42, onReady: vi.fn() })

		await status.poll()
		await vi.advanceTimersByTimeAsync(LANGE_WARTEZEIT_MS + STATUS_POLL_MAX_MS)
		expect(status.langeWartezeit.value).toBe(true)

		// Ohne das Zuruecksetzen des Startzeitpunkts truege die naechste
		// Partitur im selben Tab die Wartezeit der vorherigen mit - sie waere
		// sofort „ungewoehnlich lang".
		status.reset()
		expect(status.langeWartezeit.value).toBe(false)

		await status.poll()
		expect(status.langeWartezeit.value).toBe(false)
		expect(status.state.value).toBe('converting')
	})

	// Setliste „weiter" oder Schließen, während der Status-GET noch läuft:
	// clearTimeout erreicht die laufende Anfrage nicht. Ohne Generation lud
	// die späte Antwort über `onReady` die gerade offene Partitur ein zweites
	// Mal und plante bei `pending` einen zweiten Poll-Strang ein.
	it('verwirft eine Antwort, die nach reset() eintrifft', async () => {
		let antworte
		axiosGet.mockReturnValueOnce(new Promise((resolve) => {
			antworte = resolve
		}))
		const onReady = vi.fn()
		const status = useConversionStatus({ fileId: () => 42, onReady })

		const laufend = status.poll()
		status.reset()
		antworte({ data: { status: 'ready', files: {} } })
		await laufend

		expect(onReady).not.toHaveBeenCalled()
		expect(status.state.value).toBe('loading')
	})

	it('plant nach stop() keinen weiteren Abruf ein', async () => {
		let antworte
		axiosGet.mockReturnValueOnce(new Promise((resolve) => {
			antworte = resolve
		}))
		const status = useConversionStatus({ fileId: () => 42, onReady: vi.fn() })

		const laufend = status.poll()
		status.stop()
		antworte({ data: { status: 'pending' } })
		await laufend
		await vi.advanceTimersByTimeAsync(10_000)

		expect(axiosGet).toHaveBeenCalledTimes(1)
	})
	it('polls less often the longer the conversion takes', async () => {
		bleibtPending()
		const status = useConversionStatus({ fileId: () => 42, onReady: vi.fn() })

		await status.poll()
		await vi.advanceTimersByTimeAsync(60_000)
		// At 0, 2, 4, 6, 10, 18, 33 and 48 s - where a fixed 2 s rate made 31.
		expect(axiosGet.mock.calls.length).toBe(8)
		status.stop()
	})

	it('pauses on a hidden page and polls at once when it is visible again', async () => {
		bleibtPending()
		let hidden = false
		// The tests run without a DOM: a minimal document is enough.
		const doc = new EventTarget()
		Object.defineProperty(doc, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible') })
		globalThis.document = doc
		const status = useConversionStatus({ fileId: () => 42, onReady: vi.fn() })

		await status.poll()
		hidden = true
		await vi.advanceTimersByTimeAsync(2000)
		const abrufe = axiosGet.mock.calls.length
		await vi.advanceTimersByTimeAsync(120_000)
		expect(axiosGet.mock.calls.length).toBe(abrufe)

		hidden = false
		doc.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		expect(axiosGet.mock.calls.length).toBe(abrufe + 1)
		status.stop()
		delete globalThis.document
	})
})

/**
 * Display variants (E19) come from wherever the base came from - decided in
 * the one branch of poll(), not again for each variant.
 */
describe('requestVariant', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		axiosGet.mockReset()
		clientRun.mockReset()
		clientRunVariant.mockReset()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('asks the server when the server converted the base', async () => {
		axiosGet.mockResolvedValueOnce({ data: { status: 'ready', files: {}, variants: { supported: true } } })
		const status = useConversionStatus({ fileId: () => 42, onReady: vi.fn() })
		await status.poll()
		expect(status.variantsSupported.value).toBe(true)

		axiosGet.mockResolvedValueOnce({ data: { status: 'pending' } })
		axiosGet.mockResolvedValueOnce({ data: { status: 'ready', files: { pages: ['p'] } } })
		const answer = status.requestVariant('ex0~orig~w~0')
		await vi.advanceTimersByTimeAsync(2000)
		expect(await answer).toEqual({ variant: 'ex0~orig~w~0', status: 'ready', files: { pages: ['p'] } })
		expect(axiosGet.mock.calls[1][0]).toBe('/apps/scoreview/api/scores/{fileId}/variants/{key}')
		expect(clientRunVariant).not.toHaveBeenCalled()
	})

	it('reports what the server cannot', async () => {
		axiosGet.mockResolvedValueOnce({ data: { status: 'ready', files: {}, variants: { supported: false } } })
		const status = useConversionStatus({ fileId: () => 42, onReady: vi.fn() })
		await status.poll()
		expect(status.variantsSupported.value).toBe(false)
	})

	it('converts in the browser when the browser converted the base', async () => {
		axiosGet.mockResolvedValueOnce({ data: { status: 'client', etag: 'e' } })
		clientRun.mockResolvedValue({ files: {} })
		clientRunVariant.mockResolvedValue({ status: 'ready', variant: 'full~phone~w~0', files: {} })
		const status = useConversionStatus({ fileId: () => 42, onReady: vi.fn() })
		await status.poll()
		expect(status.variantsSupported.value).toBe(true)
		expect((await status.requestVariant('full~phone~w~0')).status).toBe('ready')
		expect(axiosGet).toHaveBeenCalledTimes(1)
	})

	it('has nothing before the base is there, and forgets on reset', async () => {
		const status = useConversionStatus({ fileId: () => 42, onReady: vi.fn() })
		expect((await status.requestVariant('full~phone~w~0')).errorCode).toBe('base_not_ready')
		axiosGet.mockResolvedValueOnce({ data: { status: 'ready', files: {}, variants: { supported: true } } })
		await status.poll()
		status.reset()
		expect(status.variantsSupported.value).toBe(false)
		expect((await status.requestVariant('full~phone~w~0')).errorCode).toBe('base_not_ready')
	})
})
