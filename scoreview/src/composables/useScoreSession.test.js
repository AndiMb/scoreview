// Laden, Veralten und die Frame-Schleife der offenen Partitur. Die Fehler,
// gegen die das hier steht, sind alle still: Ein Stueckwechsel mitten im
// Laden liess die Artefakte des alten Stuecks ueber dem neuen stehen, und
// eine zweite Frame-Schleife lief nach dem Schliessen ohne Griff weiter.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const axiosGet = vi.fn()
vi.mock('@nextcloud/axios', () => ({ default: { get: axiosGet } }))

// Die Zuordnung Zeit -> Rechteck ist lib/scoreSync.js und dort getestet; hier
// zaehlt nur, womit die Schleife sie fuettert.
const syncUpdate = vi.fn(() => 7)
let onCursorChange = null
vi.mock('../lib/scoreSync.js', () => ({
	createScoreSync: (timeline, callback) => {
		onCursorChange = callback
		return { update: syncUpdate }
	},
}))

const { useScoreSession } = await import('./useScoreSession.js')

const FILES = {
	timingJson: 'timing',
	measuresJson: 'measures',
	metaJson: 'meta',
	pages: ['p1', 'p2'],
	etag: 'e1',
	midi: 'mid',
}

const ARTIFACTS = {
	timing: { events: [{ elid: 0, timeMs: 0 }], elements: {} },
	measures: { events: [{ elid: 0, timeMs: 0 }, { elid: 1, timeMs: 2000 }], elements: {} },
	meta: { parts: [{ id: '1', name: 'Sopran' }], measures: 12, mscoreVersion: '4.7.4' },
}

/**
 * Alle Handgriffe als Attrappen; die Zeitquelle setzt, wie im Viewer, erst
 * das Aufsetzen der Wiedergabe.
 *
 * @param {object} session
 */
function connectHooks(session) {
	const hooks = {
		applyMetadata: vi.fn(),
		loadAnnotations: vi.fn(),
		ensureMidi: vi.fn(),
		restoreZoom: vi.fn(),
		observeViewport: vi.fn(),
		useRealPlayer: vi.fn(async () => {
			session.clock.value = { isPlaying: () => false }
		}),
		setNoSoundFontConfigured: vi.fn(),
		useSilentClock: vi.fn(() => {
			session.clock.value = { isPlaying: () => false }
		}),
		updateAutoScroll: vi.fn(),
		onError: vi.fn(),
		sampleTime: vi.fn(),
		displayTimeMs: () => 900,
		currentTimeMs: () => 1200,
		wrapLoop: vi.fn(),
		tickMetronome: vi.fn(),
		stopPolling: vi.fn(),
		destroyMetronome: vi.fn(),
		destroyPlayback: vi.fn(),
		stopZoomObserver: vi.fn(),
	}
	session.connect(hooks)
	return hooks
}

describe('useScoreSession', () => {
	let frames
	let nextHandle

	beforeEach(() => {
		axiosGet.mockReset()
		axiosGet.mockImplementation(async (url) => ({ data: ARTIFACTS[url] }))
		syncUpdate.mockClear()
		onCursorChange = null
		frames = new Map()
		nextHandle = 1
		vi.stubGlobal('requestAnimationFrame', (callback) => {
			const handle = nextHandle++
			frames.set(handle, callback)
			return handle
		})
		vi.stubGlobal('cancelAnimationFrame', (handle) => frames.delete(handle))
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	/** Einen Frame laufen lassen: alle wartenden Rueckrufe genau einmal. */
	function runFrame() {
		const due = [...frames.values()]
		frames.clear()
		due.forEach((callback) => callback())
	}

	it('uebernimmt die Artefakte und setzt die Wiedergabe darauf auf', async () => {
		const session = useScoreSession()
		const hooks = connectHooks(session)
		await session.load({ files: FILES, soundFontUrl: 'sf', renderer: { backend: 'local' }, canReconvert: true })

		expect(session.pageUrls.value).toEqual(['p1', 'p2'])
		expect(session.currentEtag.value).toBe('e1')
		expect(session.scoreParts.value).toEqual([{ id: '1', name: 'Sopran' }])
		expect(session.totalMeasures.value).toBe(12)
		expect(session.rendererBackend.value).toBe('local')
		expect(session.mscoreVersion.value).toBe('4.7.4')
		expect(session.canReconvert.value).toBe(true)
		expect(session.midiUrl.value).toBe('mid')
		expect(session.measuresTimeline.value.events).toHaveLength(2)
		expect(hooks.applyMetadata).toHaveBeenCalledWith(ARTIFACTS.meta)
		expect(hooks.useRealPlayer).toHaveBeenCalledWith('mid', 'sf', session.timeline.value)
		expect(hooks.useSilentClock).not.toHaveBeenCalled()
		expect(hooks.restoreZoom).toHaveBeenCalled()
		// Genau eine laufende Schleife.
		expect(frames.size).toBe(1)
	})

	it('zaehlt ohne Angabe von meta.json die dargestellten Takte', async () => {
		axiosGet.mockImplementation(async (url) => ({ data: url === 'meta' ? { parts: [] } : ARTIFACTS[url] }))
		const session = useScoreSession()
		connectHooks(session)
		await session.load({ files: FILES, soundFontUrl: null, renderer: null, canReconvert: false })
		expect(session.totalMeasures.value).toBe(2)
		expect(session.rendererBackend.value).toBeNull()
	})

	it('laeuft ohne SoundFont auf der stillen Uhr', async () => {
		const session = useScoreSession()
		const hooks = connectHooks(session)
		await session.load({ files: FILES, soundFontUrl: null, renderer: null, canReconvert: false })
		expect(hooks.setNoSoundFontConfigured).toHaveBeenCalled()
		expect(hooks.useSilentClock).toHaveBeenCalledWith(session.timeline.value)
		expect(hooks.useRealPlayer).not.toHaveBeenCalled()
	})

	it('verwirft ein Laden, das ein reset() ueberholt hat', async () => {
		const pending = []
		axiosGet.mockImplementation((url) => new Promise((resolve) => {
			pending.push(() => resolve({ data: ARTIFACTS[url] }))
		}))
		const session = useScoreSession()
		const hooks = connectHooks(session)
		const loading = session.load({ files: FILES, soundFontUrl: 'sf', renderer: null, canReconvert: false })
		session.reset()
		pending.forEach((release) => release())
		await loading
		expect(session.pageUrls.value).toEqual([])
		expect(hooks.applyMetadata).not.toHaveBeenCalled()
		expect(frames.size).toBe(0)
	})

	it('meldet einen Fehler beim Laden - nur, solange das Stueck noch offen ist', async () => {
		axiosGet.mockRejectedValue(new Error('boom'))
		const session = useScoreSession()
		const hooks = connectHooks(session)
		await session.load({ files: FILES, soundFontUrl: null, renderer: null, canReconvert: false })
		expect(hooks.onError).toHaveBeenCalledWith('boom')

		hooks.onError.mockClear()
		const stale = session.load({ files: FILES, soundFontUrl: null, renderer: null, canReconvert: false })
		session.reset()
		await stale
		expect(hooks.onError).not.toHaveBeenCalled()
	})

	it('fuettert Cursor mit der Anzeigezeit, Loop und Metronom mit der rohen', async () => {
		const session = useScoreSession()
		const hooks = connectHooks(session)
		await session.load({ files: FILES, soundFontUrl: 'sf', renderer: null, canReconvert: false })
		hooks.sampleTime.mockClear()
		runFrame()
		expect(hooks.sampleTime).toHaveBeenCalledTimes(1)
		expect(syncUpdate).toHaveBeenLastCalledWith(900)
		expect(session.currentElid.value).toBe(7)
		expect(hooks.wrapLoop).toHaveBeenLastCalledWith(1200)
		expect(hooks.tickMetronome).toHaveBeenLastCalledWith(1200)
	})

	it('reicht den Cursor weiter und erzwingt das Nachfuehren nur im Fenster nach einem Sprung', async () => {
		const session = useScoreSession()
		const hooks = connectHooks(session)
		await session.load({ files: FILES, soundFontUrl: 'sf', renderer: null, canReconvert: false })
		const rect = { page: 0, x: 1, y: 2, w: 3, h: 4 }
		onCursorChange(rect)
		expect(session.cursorRect.value).toEqual(rect)
		expect(hooks.updateAutoScroll).toHaveBeenLastCalledWith(rect, false)
		session.forceAutoScrollFor(60_000)
		onCursorChange(rect)
		expect(hooks.updateAutoScroll).toHaveBeenLastCalledWith(rect, true)
	})

	it('startet nie eine zweite Schleife neben der ersten', async () => {
		const session = useScoreSession()
		connectHooks(session)
		await session.load({ files: FILES, soundFontUrl: 'sf', renderer: null, canReconvert: false })
		session.pumpTimeDisplay()
		expect(frames.size).toBe(1)
	})

	it('baut beim Aufraeumen Schleife, Abfragen und Wiedergabe ab', async () => {
		const session = useScoreSession()
		const hooks = connectHooks(session)
		await session.load({ files: FILES, soundFontUrl: 'sf', renderer: null, canReconvert: false })
		session.cleanup()
		expect(frames.size).toBe(0)
		expect(hooks.stopPolling).toHaveBeenCalled()
		expect(hooks.destroyMetronome).toHaveBeenCalled()
		expect(hooks.destroyPlayback).toHaveBeenCalled()
		expect(hooks.stopZoomObserver).toHaveBeenCalled()
	})
})
