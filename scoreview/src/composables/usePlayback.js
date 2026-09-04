import axios from '@nextcloud/axios'
import { translate } from '@nextcloud/l10n'
import { computed, ref, shallowRef } from 'vue'
import { createDropoutCounter, createFrameRateMeter } from '../lib/audioHealth.js'
import { resolveMixerChannels } from '../lib/mixerLayout.js'
import {
	createLatencySmoother,
	createTimeSmoother,
	MAX_MANUAL_OFFSET_MS,
	MIN_MANUAL_OFFSET_MS,
	resolveLatencyMs,
	toDisplayTimeMs,
} from '../lib/playbackTime.js'
import { createPlayer } from '../lib/player.js'
import { createSilentClock } from '../lib/silentClock.js'

const t = (text, vars) => translate('scoreview', text, vars)

// Der Wert von Hand fuer den Bild/Ton-Abgleich - GERAETEWEISE gespeichert,
// bewusst anders als Farbe und Form der Hervorhebung (useViewerPreferences.js,
// die liegen serverseitig am Nutzerkonto). Deren Begruendung ("am Rechner
// vorbereitet, am Tablet gelesen") kehrt sich hier um: Der richtige Wert ist
// am Desktop 0 und am Telefon mit Bluetooth-Kopfhoerern 250. Am Konto
// gespeichert waere er auf dem jeweils anderen Geraet garantiert falsch.
const AUDIO_OFFSET_STORAGE_KEY = 'scoreview:audio-offset-ms'

// Näherung für die Transport-Gesamtdauer im stummen Platzhalter-Modus -
// letztes Timing-Event plus Puffer für den Ausklang der letzten Note. Mit
// echtem Player kommt die Dauer stattdessen von player.durationMs.
const DURATION_PADDING_MS = 2000

// Grenzen des Tempofaktors auf playbackRate (nur in diesem Bereich
// gemessen, dass die Zeitachse tempounabhängig bleibt) - die BPM-Eingabe
// rechnet innerhalb dieser Grenzen.
const MIN_TEMPO_FACTOR = 0.5
const MAX_TEMPO_FACTOR = 1.5

/**
 * Die Zeitquelle und alles, was unmittelbar an ihr hängt: SoundFont holen,
 * Player oder stummen Platzhalter aufsetzen, Transport, Tempo, Mixerkanäle
 * und das Wachhalten des Bildschirms.
 *
 * Siebtes und letztes Composable aus der Zerlegung von `ScoreViewer.vue` -
 * und das größte, weil diese
 * Dinge tatsächlich eine Einheit sind: `hasRealPlayer` entscheidet über den
 * Mixer, der Tempofaktor über die Metronom-Terminierung, und der Wechsel
 * zwischen echtem Player und Platzhalter muss all das gleichzeitig umstellen.
 *
 * `clock` erfüllt in beiden Fällen dieselbe kleine Schnittstelle
 * (`getCurrentTimeMs`/`play`/`pause`/`seek`/`isPlaying`/`addEventListener`),
 * siehe `lib/player.js` und `lib/silentClock.js`. Der Rest der App muss den
 * Unterschied nur für die Zusatzfunktionen kennen.
 *
 * @param {object} deps
 * @param {import('vue').ShallowRef} deps.clock geteilter Ref auf die Zeitquelle
 * @param {import('vue').ShallowRef} deps.durationMs geteilter Ref
 * @param {number} deps.defaultTempoBpm MuseScores Vorgabe für Partituren ohne
 *   Tempoangabe (M8: `metadata.tempo` kann 0 sein)
 */
export function usePlayback({ clock, durationMs, defaultTempoBpm }) {
	// Die ROHE Zeit der Audiouhr. Bezugsgroesse fuer alles, was gegen
	// dieselbe Uhr terminiert oder springt (Metronom, Loop, seek).
	const currentTimeMs = ref(0)
	// Was gerade zu HOEREN ist - um die Ausgabelatenz zurueckgerechnet und
	// geglaettet. Fuer Cursor, Autoscroll, Taktanzeige, Suchlauf. Warum
	// beides getrennt sein muss, steht im Kopfkommentar von
	// lib/playbackTime.js.
	const displayTimeMs = ref(0)
	const isPlaying = ref(false)
	const hasRealPlayer = ref(false)
	// Warum es keinen Ton gibt, im Klartext für die Nutzerin - vorher stand
	// hier pauschal "nicht konfiguriert", auch wenn in Wahrheit der
	// SoundFont-Abruf oder der Synthesizer gescheitert war. Genau das machte
	// "die App gibt keinen Ton aus" von außen undiagnostizierbar.
	const playbackError = ref('')
	// Faktor auf playbackRate (die Zeitachse bleibt davon unberührt), nur
	// Anzeige und Eingabe sind BPM.
	const tempo = ref(1)
	const baseTempoBpm = ref(defaultTempoBpm)
	const tempoGuessed = ref(false)
	const mixerChannels = shallowRef([])
	const presetList = shallowRef([])
	// SoundFont-Ladefortschritt (~40MB, "das wird auf dem Tablet zuerst
	// wehtun") statt stummem Warten - getrennt vom permanenten
	// playbackError (der bedeutet "geht nicht", hier heißt es "noch nicht").
	const soundFontLoading = ref(false)
	const soundFontLoadPercent = ref(0)

	// Der Bild/Ton-Abgleich. `latencyMs` ist der tatsaechlich angewandte
	// Gesamtwert (Automatik + Hand), `manualOffsetMs` nur der Anteil von Hand.
	const latencyMs = ref(0)
	const manualOffsetMs = ref(leseGespeichertenVersatz())
	const automaticLatencyMs = ref(0)
	// Woher die Automatik ihren Wert hat - fuer die Betriebsdiagnose, damit
	// "0 ms" von "der Browser sagt nichts" unterscheidbar bleibt.
	const audioInfo = ref(null)
	const frameRate = ref(0)
	const dropoutCount = ref(0)
	const dropoutLostMs = ref(0)

	const effectiveTempoBpm = computed(() => Math.round(baseTempoBpm.value * tempo.value))
	const minTempoBpm = computed(() => Math.round(baseTempoBpm.value * MIN_TEMPO_FACTOR))
	const maxTempoBpm = computed(() => Math.round(baseTempoBpm.value * MAX_TEMPO_FACTOR))

	const latencySmoother = createLatencySmoother()
	const timeSmoother = createTimeSmoother()
	const dropouts = createDropoutCounter()
	const frameMeter = createFrameRateMeter()

	let abortController = null
	let wakeLockSentinel = null
	// metadata.tracks/parts - für den zweiten resolveMixerChannels()-Aufruf
	// aufgehoben, sobald die echten MIDI-Kanäle bekannt sind.
	let metaTracks = null
	let metaParts = null

	/** @param {object} meta `meta.json` von MuseScore */
	function applyMetadata(meta) {
		metaTracks = meta.tracks
		metaParts = meta.parts
		// Vorläufig ohne echte Kanaldaten (der Player ist noch nicht geladen) -
		// resolveMixerChannels() fällt dann auf den Spurindex zurück.
		mixerChannels.value = resolveMixerChannels(metaTracks, metaParts)
		baseTempoBpm.value = meta.tempo || defaultTempoBpm
		tempoGuessed.value = !meta.tempo
	}

	/** @param {object} timeline aus `timing.json` - liefert die Ersatzdauer */
	function useSilentClock(timeline) {
		const lastEventMs = timeline.events.length > 0 ? timeline.events[timeline.events.length - 1].timeMs : 0
		durationMs.value = lastEventMs + DURATION_PADDING_MS
		clock.value = createSilentClock(durationMs.value)
		hasRealPlayer.value = false
	}

	/**
	 * Liest den SoundFont-Abruf gestreamt statt in einem Rutsch, um den
	 * Ladefortschritt zu kennen. `Content-Length` ist bei einer
	 * gleichbleibenden, cachebaren Datei zuverlässig gesetzt; ohne sie bleibt
	 * der Fortschritt bei 0 %, der Abruf funktioniert trotzdem unverändert.
	 *
	 * Bewusst `fetch()` statt `@nextcloud/axios`: die SoundFont-URL ist eine
	 * vom Admin frei konfigurierbare, potenziell fremde Adresse - axios hängt
	 * an jede Anfrage den CSRF-requesttoken-Header an, der dort weder
	 * gebraucht wird noch hin sollte, und erzwingt dadurch unnötig einen
	 * CORS-Preflight.
	 *
	 * @param {string} url
	 * @param {AbortSignal} signal
	 * @return {Promise<ArrayBuffer>}
	 */
	async function fetchSoundFont(url, signal) {
		const res = await fetch(url, { signal })
		if (!res.ok) {
			// Die app-eigene Route antwortet im Fehlerfall mit {"error": "…"}
			// (SoundFontController) - die Meldung ist brauchbarer als "HTTP 503".
			const detail = await res.json().then((b) => b?.error).catch(() => null)
			throw new Error(detail || `SoundFont-Abruf fehlgeschlagen: HTTP ${res.status}`)
		}
		const total = Number(res.headers.get('Content-Length')) || 0
		if (!total || !res.body?.getReader) {
			return res.arrayBuffer()
		}
		const reader = res.body.getReader()
		const chunks = []
		let received = 0
		for (;;) {
			const { done, value } = await reader.read()
			if (done) {
				break
			}
			chunks.push(value)
			received += value.length
			soundFontLoadPercent.value = Math.round((received / total) * 100)
		}
		const buffer = new Uint8Array(received)
		let offset = 0
		for (const chunk of chunks) {
			buffer.set(chunk, offset)
			offset += chunk.length
		}
		return buffer.buffer
	}

	/**
	 * @param {string} midiUrl
	 * @param {string} soundFontUrl
	 * @param {object} timeline Rückfall-Zeitachse für den stummen Modus
	 */
	async function useRealPlayer(midiUrl, soundFontUrl, timeline) {
		abortController = new AbortController()
		soundFontLoading.value = true
		soundFontLoadPercent.value = 0
		try {
			const [midiRes, soundFontBuffer] = await Promise.all([
				axios.get(midiUrl, { responseType: 'arraybuffer' }),
				fetchSoundFont(soundFontUrl, abortController.signal),
			])
			const player = await createPlayer(midiRes.data, soundFontBuffer)
			clock.value = player
			hasRealPlayer.value = true
			durationMs.value = player.durationMs
			presetList.value = player.getPresetList() ?? []
			// Jetzt mit den echten, aus dem geladenen MIDI gelesenen Kanälen neu
			// auflösen (siehe mixerLayout.js) - vorher stand dort nur die
			// Index-Näherung, weil getTrackChannels() ein geladenes MIDI braucht.
			mixerChannels.value = resolveMixerChannels(metaTracks, metaParts, player.getTrackChannels())
		} catch (err) {
			if (err.name === 'AbortError') {
				// "Noten ohne Ton"-Weg - bewusster Nutzerwunsch, kein Fehler.
				playbackError.value = t('Sound loading skipped.')
			} else {
				// SoundFont evtl. nicht erreichbar (falsche URL, CORS, Netzwerk) -
				// Notenansicht bleibt trotzdem nutzbar, nur ohne Ton.
				// eslint-disable-next-line no-console
				console.error('ScoreView: echte Wiedergabe konnte nicht initialisiert werden, falle auf stummen Modus zurück.', err)
				playbackError.value = err.message
			}
			// buildTimeline({events: []}) wäre eine leere Zeitachse: der
			// Transport hätte danach Dauer 0 und die Partitur ließe sich nicht
			// mehr durchfahren. Die echte Timeline steht hier bereits zur
			// Verfügung - sie ist auch im stummen Modus die richtige.
			useSilentClock(timeline)
		} finally {
			soundFontLoading.value = false
			abortController = null
		}
	}

	/**
	 * "Noten ohne Ton"-Weg: bricht den laufenden Abruf ab und fällt sofort auf
	 * den stummen Platzhalter zurück, statt die restlichen ~40 MB abzuwarten.
	 */
	function skipSoundFontLoad() {
		abortController?.abort()
	}

	function setNoSoundFontConfigured() {
		playbackError.value = t('No SoundFont is available (see Settings → ScoreView).')
	}

	// --- Transport ----------------------------------------------------------

	async function toggle() {
		if (!clock.value) {
			return
		}
		if (clock.value.isPlaying()) {
			const renderTimeMs = clock.value.getCurrentTimeMs()
			clock.value.pause()
			// Auf die zuletzt GEHOERTE Stelle zurueckstellen, nicht auf die
			// zuletzt gerenderte: Was beim Anhalten noch im Ausgabepuffer
			// stand, wird verworfen - es hat nie geklungen, gaelte aber als
			// gespielt. Ueber Bluetooth sind das bis zu 300 ms, bei
			// Viertel = 120 fast ein Achtel. In der Probe ist das der
			// Unterschied zwischen "noch mal von hier" und einem Neustart
			// hinter der Stelle.
			const gehoertMs = toDisplayTimeMs(renderTimeMs, latencyMs.value, tempo.value)
			if (gehoertMs < renderTimeMs) {
				clock.value.seek(gehoertMs)
			}
			timeSmoother.reset()
		} else {
			await clock.value.play()
		}
	}

	function seek(timeMs) {
		clock.value?.seek(timeMs)
		// Nach einem Sprung ist jede Vorhersage aus der alten Position
		// wertlos; ohne das Zuruecksetzen zoege der Cursor sichtbar nach.
		timeSmoother.reset()
	}

	function onSeekInput(event) {
		seek(Number(event.target.value))
	}

	/**
	 * BPM statt Prozent (M8) - rechnet die eingegebene Ziel-BPM in
	 * den internen playbackRate-Faktor um, begrenzt auf denselben
	 * Faktorbereich wie zuvor der Prozent-Regler.
	 *
	 * @param {Event} event
	 */
	function onTempoBpmInput(event) {
		const bpm = Number(event.target.value)
		const factor = baseTempoBpm.value > 0 ? bpm / baseTempoBpm.value : 1
		tempo.value = Math.min(MAX_TEMPO_FACTOR, Math.max(MIN_TEMPO_FACTOR, factor))
		clock.value?.setTempo?.(tempo.value)
	}

	function applyChannelVolumes(volumes) {
		clock.value?.applyChannelVolumes?.(volumes)
	}

	function setProgram({ channel, program }) {
		clock.value?.setProgram?.(channel, program)
	}

	/**
	 * Aktuelle Transportwerte aus der Zeitquelle ziehen - pro Frame gerufen,
	 * und zwar genau einmal (der Glaetter schreibt seinen Zustand fort).
	 *
	 * Hier entstehen die beiden Zeiten: `currentTimeMs` roh von der Audiouhr,
	 * `displayTimeMs` um die Ausgabelatenz zurueckgerechnet und geglaettet.
	 * Nebenher laufen die beiden Zaehler der Betriebsdiagnose mit - sie
	 * brauchen dieselben Werte im selben Takt und wuerden als zweite Schleife
	 * nur denselben Zustand ein zweites Mal abfragen.
	 */
	function sampleTime() {
		if (!clock.value) {
			return
		}
		const nowMs = performance.now()
		const renderTimeMs = clock.value.getCurrentTimeMs()
		currentTimeMs.value = renderTimeMs
		isPlaying.value = clock.value.isPlaying()

		updateLatency()
		// Bei angehaltener Wiedergabe klingt nichts - dann steht der Cursor
		// genau dort, wo es beim Fortsetzen weitergeht (siehe toggle()), und
		// jede Korrektur waere ein Versatz ohne Gegenstueck.
		const rohe = isPlaying.value
			? toDisplayTimeMs(renderTimeMs, latencyMs.value, tempo.value)
			: renderTimeMs
		displayTimeMs.value = isPlaying.value
			? timeSmoother.update(rohe, nowMs, tempo.value)
			: rohe
		if (!isPlaying.value) {
			timeSmoother.reset()
		}

		// Bewusst mit der ROHEN Zeit: Die geglaettete versteckt genau das
		// Stocken, das hier gesucht wird.
		dropouts.update(renderTimeMs, nowMs, isPlaying.value, tempo.value)
		frameMeter.update(nowMs)
		frameRate.value = frameMeter.fps()
		dropoutCount.value = dropouts.count()
		dropoutLostMs.value = dropouts.lostMs()
	}

	/**
	 * Die anzuwendende Ausgabelatenz nachfuehren. Jeden Frame, nicht einmalig:
	 * Der Wert aendert sich, wenn mitten im Betrieb auf Bluetooth-Kopfhoerer
	 * umgeschaltet wird - und genau dann faellt der Versatz auf.
	 */
	function updateLatency() {
		const report = clock.value?.getLatencyReport?.() ?? null
		if (report) {
			audioInfo.value = report
			automaticLatencyMs.value = latencySmoother.update(resolveLatencyMs({ measuredMs: report.measuredMs, reportedMs: report.reportedMs }))
		} else {
			// Stummer Platzhalter (silentClock.js): keine Audioausgabe, also
			// auch keine Ausgabelatenz. Der Wert von Hand bleibt trotzdem
			// wirksam - dort steckt nichts Geraetespezifisches drin.
			audioInfo.value = null
			automaticLatencyMs.value = 0
		}
		latencyMs.value = automaticLatencyMs.value + manualOffsetMs.value
	}

	/**
	 * Der Bild/Ton-Abgleich von Hand. Wirkt sofort und wird geraeteweise
	 * gemerkt (siehe AUDIO_OFFSET_STORAGE_KEY).
	 *
	 * @param {number} valueMs
	 */
	function setManualOffsetMs(valueMs) {
		const begrenzt = Math.min(MAX_MANUAL_OFFSET_MS, Math.max(MIN_MANUAL_OFFSET_MS, Math.round(valueMs) || 0))
		manualOffsetMs.value = begrenzt
		try {
			window.localStorage?.setItem(AUDIO_OFFSET_STORAGE_KEY, String(begrenzt))
		} catch {
			// Privates Fenster oder gesperrter Speicher - der Wert wirkt in
			// dieser Sitzung trotzdem, er ueberlebt sie nur nicht. Das ist
			// kein Grund fuer eine Meldung ueber der Partitur.
		}
	}

	function onManualOffsetInput(event) {
		setManualOffsetMs(Number(event.target.value))
	}

	// --- Wake Lock --------------------------------------------------------
	// "Ein Display, das mitten im Satz ausgeht, macht die ganze uebrige Arbeit
	// wertlos." Die API ist nicht ueberall verfuegbar (Firefox ohne Flag,
	// manche iOS-Versionen), deshalb durchweg defensiv: ohne sie bleibt die
	// App exakt so nutzbar wie vorher, nur ohne Wachhalte-Effekt.

	async function requestWakeLock() {
		if (!navigator.wakeLock || wakeLockSentinel) {
			return
		}
		try {
			wakeLockSentinel = await navigator.wakeLock.request('screen')
			// Das Sentinel wird vom Browser selbst geloest, wenn der Tab in den
			// Hintergrund wechselt - beim Zurueckkehren waehrend laufender
			// Wiedergabe erneut anfordern, sonst bliebe der Bildschirm nach
			// einem Tab-Wechsel ungeschuetzt, obwohl isPlaying weiterhin true ist.
			wakeLockSentinel.addEventListener('release', () => {
				wakeLockSentinel = null
				if (isPlaying.value && document.visibilityState === 'visible') {
					requestWakeLock()
				}
			})
		} catch (err) {
			// z.B. Permissions-Policy verbietet Wake Lock im umgebenden iframe.
			// eslint-disable-next-line no-console
			console.error('ScoreView: Bildschirm konnte nicht wachgehalten werden.', err)
		}
	}

	function releaseWakeLock() {
		wakeLockSentinel?.release?.()
		wakeLockSentinel = null
	}

	/**
	 * Der AudioContext der Wiedergabe, solange es einen gibt - fuer den
	 * Metronomklick (lib/metronomeClick.js) und fuer die Betriebsdiagnose.
	 *
	 * @return {?AudioContext}
	 */
	function getAudioContext() {
		return clock.value?.getAudioContext?.() ?? null
	}

	/**
	 * Was auf DIESEM Geraet gemessen wurde - ablesbar im Viewer selbst.
	 *
	 * Ohne diese Anzeige ist jede Aussage ueber ein fremdes Telefon geraten:
	 * "die Spuren synchronisieren nicht sauber" kann heissen, dass die Anzeige
	 * dem Ton vorauslaeuft (dann steht hier eine Latenz, die die Automatik
	 * nicht kennt) oder dass der Ton aussetzt (dann zaehlt hier etwas). Rein
	 * beschreibend - nichts im Viewer verzweigt danach.
	 */
	const audioDiagnostics = computed(() => {
		const context = clock.value?.getAudioContext?.() ?? null
		const report = audioInfo.value
		return {
			hasAudio: context !== null,
			contextState: context?.state ?? null,
			sampleRate: context?.sampleRate ?? null,
			measuredLatencyMs: report?.measuredMs ?? null,
			reportedLatencyMs: report?.reportedMs ?? null,
			automaticLatencyMs: Math.round(automaticLatencyMs.value),
			manualOffsetMs: manualOffsetMs.value,
			appliedLatencyMs: Math.round(latencyMs.value),
			frameRate: frameRate.value,
			dropoutCount: dropoutCount.value,
			dropoutLostMs: dropoutLostMs.value,
		}
	})

	function destroy() {
		abortController?.abort()
		abortController = null
		// Gibt den AudioContext frei (siehe lib/player.js) - der silentClock
		// hat kein destroy(), daher der Guard.
		clock.value?.destroy?.()
		clock.value = null
		releaseWakeLock()
	}

	function reset() {
		currentTimeMs.value = 0
		displayTimeMs.value = 0
		durationMs.value = 0
		isPlaying.value = false
		tempo.value = 1
		// Der Wert von Hand bleibt bewusst stehen: Er gehoert zum GERAET
		// (Ausgabelatenz der Kopfhoerer), nicht zur Partitur. Zurueckgesetzt
		// wird nur, was aus der laufenden Wiedergabe stammt.
		latencyMs.value = manualOffsetMs.value
		automaticLatencyMs.value = 0
		audioInfo.value = null
		frameRate.value = 0
		dropoutCount.value = 0
		dropoutLostMs.value = 0
		latencySmoother.reset()
		timeSmoother.reset()
		dropouts.reset()
		frameMeter.reset()
		hasRealPlayer.value = false
		playbackError.value = ''
		mixerChannels.value = []
		presetList.value = []
		baseTempoBpm.value = defaultTempoBpm
		tempoGuessed.value = false
		soundFontLoading.value = false
		soundFontLoadPercent.value = 0
		metaTracks = null
		metaParts = null
	}

	return {
		currentTimeMs,
		displayTimeMs,
		latencyMs,
		manualOffsetMs,
		automaticLatencyMs,
		audioDiagnostics,
		setManualOffsetMs,
		onManualOffsetInput,
		getAudioContext,
		isPlaying,
		hasRealPlayer,
		playbackError,
		tempo,
		baseTempoBpm,
		tempoGuessed,
		effectiveTempoBpm,
		minTempoBpm,
		maxTempoBpm,
		mixerChannels,
		presetList,
		soundFontLoading,
		soundFontLoadPercent,
		applyMetadata,
		useSilentClock,
		useRealPlayer,
		skipSoundFontLoad,
		setNoSoundFontConfigured,
		toggle,
		seek,
		onSeekInput,
		onTempoBpmInput,
		applyChannelVolumes,
		setProgram,
		sampleTime,
		requestWakeLock,
		releaseWakeLock,
		destroy,
		reset,
	}
}

/**
 * Der zuletzt eingestellte Bild/Ton-Versatz dieses Geraets.
 *
 * Durchweg defensiv: `localStorage` wirft in privaten Fenstern und bei
 * gesperrtem Speicher schon beim LESEN. Ohne den Wert startet der Abgleich
 * bei 0 - die App bleibt exakt so nutzbar, nur muss er neu eingestellt
 * werden.
 *
 * @return {number} ms, 0 wenn nichts Brauchbares gespeichert ist
 */
function leseGespeichertenVersatz() {
	try {
		const roh = Number(window.localStorage?.getItem(AUDIO_OFFSET_STORAGE_KEY))
		if (!Number.isFinite(roh)) {
			return 0
		}
		return Math.min(MAX_MANUAL_OFFSET_MS, Math.max(MIN_MANUAL_OFFSET_MS, Math.round(roh)))
	} catch {
		return 0
	}
}
