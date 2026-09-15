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

vi.mock('@nextcloud/axios', () => ({ default: { get: axiosGet, post: vi.fn() } }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (url) => url }))
vi.mock('@nextcloud/l10n', () => ({ translate: (app, text) => text }))
// Der Rückfall im Browser ist hier nicht die Frage - er soll nur nicht
// mitlaufen. `progress: null` heißt „serverseitig konvertiert".
vi.mock('./useClientConversion.js', () => ({
	useClientConversion: () => ({ run: vi.fn(), release: vi.fn(), progress: { value: null } }),
}))

const { useConversionStatus } = await import('./useConversionStatus.js')

/**
 * Die Frist aus dem Modul, plus drei Poll-Takte: Gepollt wird alle 2 s, die
 * Frist wird also erst vom ERSTEN Abruf dahinter bemerkt - genau auf ihr
 * laeuft das Warten noch.
 */
const NACH_DER_FRIST_MS = 1_860_000 + 3 * 2000
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

		await vi.advanceTimersByTimeAsync(LANGE_WARTEZEIT_MS + 2000)

		expect(status.langeWartezeit.value).toBe(true)
		// Der Kreisel dreht weiter - der Hinweis ist eine Auskunft, kein Urteil.
		expect(status.state.value).toBe('converting')
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
		await vi.advanceTimersByTimeAsync(LANGE_WARTEZEIT_MS + 2000)
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
})
