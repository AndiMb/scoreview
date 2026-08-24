import axios from '@nextcloud/axios'
import { translate } from '@nextcloud/l10n'
import { computed, ref, shallowRef } from 'vue'
import { resolveMixerChannels } from '../lib/mixerLayout.js'
import { createPlayer } from '../lib/player.js'
import { createSilentClock } from '../lib/silentClock.js'

const t = (text, vars) => translate('scoreview', text, vars)

// Näherung für die Transport-Gesamtdauer im stummen Platzhalter-Modus -
// letztes Timing-Event plus Puffer für den Ausklang der letzten Note. Mit
// echtem Player kommt die Dauer stattdessen von player.durationMs.
const DURATION_PADDING_MS = 2000

// Grenzen des Tempofaktors auf playbackRate (Phase 9 hat nur in diesem
// Bereich gemessen, dass die Zeitachse tempounabhängig bleibt) - die
// BPM-Eingabe rechnet innerhalb dieser Grenzen.
const MIN_TEMPO_FACTOR = 0.5
const MAX_TEMPO_FACTOR = 1.5

/**
 * Die Zeitquelle und alles, was unmittelbar an ihr hängt: SoundFont holen,
 * Player oder stummen Platzhalter aufsetzen, Transport, Tempo, Mixerkanäle
 * und das Wachhalten des Bildschirms.
 *
 * Siebtes und letztes Composable aus der Zerlegung von `ScoreViewer.vue`
 * (Codereview-Befund B1, Phase 23/Schritt 6) - und das größte, weil diese
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
	const currentTimeMs = ref(0)
	const isPlaying = ref(false)
	const hasRealPlayer = ref(false)
	// Warum es keinen Ton gibt, im Klartext für die Nutzerin - vorher stand
	// hier pauschal "nicht konfiguriert", auch wenn in Wahrheit der
	// SoundFont-Abruf oder der Synthesizer gescheitert war. Genau das machte
	// "die App gibt keinen Ton aus" von außen undiagnostizierbar.
	const playbackError = ref('')
	// Faktor auf playbackRate (Phase 9: die Zeitachse bleibt davon unberührt),
	// nur Anzeige und Eingabe sind BPM.
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

	const effectiveTempoBpm = computed(() => Math.round(baseTempoBpm.value * tempo.value))
	const minTempoBpm = computed(() => Math.round(baseTempoBpm.value * MIN_TEMPO_FACTOR))
	const maxTempoBpm = computed(() => Math.round(baseTempoBpm.value * MAX_TEMPO_FACTOR))

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
			clock.value.pause()
		} else {
			await clock.value.play()
		}
	}

	function seek(timeMs) {
		clock.value?.seek(timeMs)
	}

	function onSeekInput(event) {
		seek(Number(event.target.value))
	}

	/**
	 * BPM statt Prozent (Phase 17, M8) - rechnet die eingegebene Ziel-BPM in
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

	/** Aktuelle Transportwerte aus der Zeitquelle ziehen - pro Frame gerufen. */
	function sampleTime() {
		if (!clock.value) {
			return
		}
		currentTimeMs.value = clock.value.getCurrentTimeMs()
		isPlaying.value = clock.value.isPlaying()
	}

	// --- Wake Lock (Phase 19) ------------------------------------------------
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
		durationMs.value = 0
		isPlaying.value = false
		tempo.value = 1
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
