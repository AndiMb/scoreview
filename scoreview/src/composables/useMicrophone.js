import { generateFilePath } from '@nextcloud/router'
import { computed, ref, watch } from 'vue'
import { withAppVersion } from '../lib/assetVersion.js'
import { classifyMicError, mayUseCapturePath, MIC_CONSTRAINTS } from '../lib/micAccess.js'
import { inputLatencyMs } from '../lib/recordingAlign.js'

// Eigener Webpack-Einstieg, unveraendert neben den anderen Bundles
// (webpack.config.js) - ein AudioWorklet laedt sich per addModule(url), unter
// fester Adresse; die App-Version haelt einen alten Stand aus dem Cache fern.
const CAPTURE_WORKLET_URL = withAppVersion(generateFilePath('scoreview', 'js', 'scoreview-capture-worklet.js'), SCOREVIEW_APP_VERSION)

/** Fehlername, wenn die Strecke abgebaut wurde, waehrend das Worklet lud. */
const TORN_DOWN = 'ScoreViewTornDown'

/**
 * Die gemeinsame Mikrofonstrecke (docs/architecture.md, Abschnitt Mikrofon) - **die einzige
 * Stelle mit `getUserMedia`** in der App.
 *
 * - **An- und Abmelden je Nutzer** (`recorder`, `intonation`, `follower`):
 *   Solange niemand angemeldet ist, ist das Mikrofon aus, und zwar ganz - die
 *   Spuren werden gestoppt, die Anzeige des Browsers erlischt (pro
 *   Nutzung ausdruecklich einzuschalten).
 * - **Eine Handlung schaltet alles aus**: `turnOff()` sagt jedem
 *   Nutzer Bescheid und baut die Strecke ab. Der rote Punkt in der Leiste
 *   (MicIndicator.vue) ruft genau das.
 * - **Der Aufnahmeweg ist nur fuer Aufnahme und Intonation** (S7): Wer sich
 *   als `follower` anmeldet, bekommt die Quelle fuer eigene Analyser, aber
 *   keine Bloecke. Das Mitverfolgen kann also strukturell nichts speichern.
 * - **Im Wiedergabe-AudioContext**, damit Zeitstempel, Latenz und Sequencer
 *   dieselbe Uhr haben (lib/recordingAlign.js). Nur ohne Ton (stummer
 *   Platzhalter) entsteht ein eigener.
 *
 * Ob das Mikrofon geht, zeigt allein der Fehler von getUserMedia
 * (lib/micAccess.js) - nie der User-Agent.
 *
 * @param {object} deps
 * @param {() => ?AudioContext} deps.audioContext der der Wiedergabe, falls es einen gibt
 * @return {object}
 */
export function useMicrophone({ audioContext }) {
	/** Wer das Mikrofon gerade nutzt, in Anmeldereihenfolge. */
	const consumers = ref([])
	/** Der letzte Fehler: {kind: 'blocked'|'noDevice'|'busy'|'other', name}. */
	const error = ref(null)
	const active = computed(() => consumers.value.length > 0)

	let stream = null
	let context = null
	let ownContext = null
	let source = null
	let captureNode = null
	let inputLatency = 0
	// Wer gerade die Strecke aufbaut - ein zweiter Aufruf waehrend der
	// Rueckfrage des Browsers wartet darauf, statt ein zweites Mal zu fragen.
	let starting = null
	// Dasselbe fuer das Aufnahme-Worklet: addModule() ist asynchron, und zwei
	// Nutzer (Aufnahme und Intonation), die gleichzeitig einschalten, bauten
	// sonst je einen Knoten - jeder Block kaeme doppelt bei den Hoerern an.
	let capturing = null
	const blockListeners = new Set()
	const stopHandlers = new Map()

	/**
	 * Mikrofon fuer einen Nutzer einschalten. Muss aus einer Nutzerhandlung
	 * kommen (Klick) - sonst verweigern Browser Rueckfrage und AudioContext.
	 *
	 * @param {'recorder'|'intonation'|'follower'} consumer
	 * @param {object} [options]
	 * @param {() => void} [options.onStop] gerufen, wenn die Strecke von aussen
	 *   abgeschaltet wird (roter Punkt, Stueckwechsel)
	 * @return {Promise<?{context: AudioContext, source: MediaStreamAudioSourceNode, inputLatencyMs: number, onBlocks?: (listener: (block: {samples: Float32Array, contextTimeSec: number}) => void) => (() => void)}>}
	 *   null, wenn das Mikrofon nicht verfuegbar ist - dann steht der Grund in `error`
	 */
	async function acquire(consumer, { onStop } = {}) {
		error.value = null
		try {
			if (!starting) {
				starting = ensureStream().finally(() => {
					starting = null
				})
			}
			await starting
			if (mayUseCapturePath(consumer)) {
				await ensureCapture()
			}
		} catch (err) {
			if (err?.name === TORN_DOWN) {
				// Kein Geraetefehler, sondern gewollt abgeschaltet - keine Meldung.
				return null
			}
			error.value = { kind: classifyMicError(err), name: err?.name ?? '' }
			if (consumers.value.length === 0) {
				teardown()
			}
			return null
		}
		if (!consumers.value.includes(consumer)) {
			consumers.value = [...consumers.value, consumer]
		}
		if (onStop) {
			stopHandlers.set(consumer, onStop)
		}
		const handle = { context, source, inputLatencyMs: inputLatency }
		if (mayUseCapturePath(consumer)) {
			handle.onBlocks = (listener) => {
				blockListeners.add(listener)
				return () => blockListeners.delete(listener)
			}
		}
		return handle
	}

	/**
	 * Ein Nutzer ist fertig. Der letzte schaltet das Mikrofon ab.
	 *
	 * @param {string} consumer
	 */
	function release(consumer) {
		stopHandlers.delete(consumer)
		consumers.value = consumers.value.filter((c) => c !== consumer)
		if (consumers.value.length === 0) {
			teardown()
		}
	}

	/** Alles aus, mit einer Handlung. */
	function turnOff() {
		// Kopie: Jeder Handler meldet sich selbst ab und aendert dabei die Karte.
		for (const handler of [...stopHandlers.values()]) {
			try {
				handler()
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error('ScoreView: Abschalten eines Mikrofon-Nutzers gescheitert.', err)
			}
		}
		stopHandlers.clear()
		consumers.value = []
		teardown()
	}

	async function ensureStream() {
		// Laeuft die Strecke schon, bleibt sie, wo sie ist - auch wenn
		// inzwischen der Ton geladen ist: Ein Umbau mitten in einer Aufnahme
		// risse sie entzwei. Den Wechsel des Wiedergabe-Kontexts faengt der
		// Watcher unten ab.
		if (stream && context) {
			return
		}
		if (!navigator.mediaDevices?.getUserMedia) {
			// Unsicherer Kontext oder eine WebView ohne Medien-API: dieselbe
			// Aussage wie eine Ablehnung.
			const err = new Error('getUserMedia fehlt')
			err.name = 'NotSupportedError'
			throw err
		}
		const neu = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
		stream = neu
		context = audioContext() ?? (ownContext = ownContext ?? new AudioContext())
		await context.resume()
		source = context.createMediaStreamSource(stream)
		const settings = stream.getAudioTracks()[0]?.getSettings?.() ?? {}
		inputLatency = inputLatencyMs({ trackLatencySec: settings.latency, baseLatencySec: context.baseLatency })
		// Endet die Spur von aussen (Geraet abgezogen, Erlaubnis entzogen),
		// soll die Anzeige nicht weiter „Mikrofon an" behaupten.
		for (const track of stream.getAudioTracks()) {
			track.addEventListener('ended', () => turnOff())
		}
	}

	function ensureCapture() {
		if (captureNode) {
			return Promise.resolve()
		}
		if (!capturing) {
			capturing = buildCapture().finally(() => {
				capturing = null
			})
		}
		return capturing
	}

	async function buildCapture() {
		const ctx = context
		await ctx.audioWorklet.addModule(CAPTURE_WORKLET_URL)
		// Waehrend addModule() abgebaut (letzter Nutzer weg, roter Punkt):
		// Ein Knoten an einer Strecke, die es nicht mehr gibt, liefe ins Leere.
		if (context !== ctx || !source) {
			const err = new Error('Mikrofonstrecke waehrend des Aufbaus beendet')
			err.name = TORN_DOWN
			throw err
		}
		captureNode = new AudioWorkletNode(context, 'scoreview-capture', {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [1],
		})
		captureNode.port.onmessage = (event) => {
			for (const listener of blockListeners) {
				listener(event.data)
			}
		}
		source.connect(captureNode)
		// Das Worklet schreibt nichts in seinen Ausgang - angeschlossen wird
		// er trotzdem: Ein Knoten ohne Weg zum Ausgang wird vom Browser nicht
		// zuverlaessig verarbeitet.
		captureNode.connect(context.destination)
	}

	function teardown() {
		if (captureNode) {
			captureNode.port.postMessage('stop')
			captureNode.port.onmessage = null
			captureNode.disconnect()
			captureNode = null
		}
		source?.disconnect()
		source = null
		stream?.getTracks().forEach((track) => track.stop())
		stream = null
		blockListeners.clear()
		if (ownContext) {
			ownContext.close().catch(() => {})
			ownContext = null
		}
		context = null
	}

	// Stueckwechsel oder neu geladener Ton: Der Kontext, an dem die Strecke
	// hing, ist weg. Weiterlaufen hiesse Zeitstempel einer Uhr, die niemand
	// mehr liest - lieber sichtbar aus.
	watch(() => audioContext(), (neu) => {
		if (context && context !== ownContext && neu !== context) {
			turnOff()
		}
	})

	return {
		consumers,
		active,
		error,
		acquire,
		release,
		turnOff,
		clearError: () => {
			error.value = null
		},
	}
}
