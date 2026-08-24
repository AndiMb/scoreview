import { ref } from 'vue'
import { computeCountInDelaysMs, estimateBeatsInMeasure, resolveBeatInMeasure } from '../lib/metronome.js'
import { createMetronomeClick } from '../lib/metronomeClick.js'
import { findStepIndex } from '../lib/timingSync.js'

// Vorlauf, mit dem der naechste Schlag gesucht und im AudioContext terminiert
// wird (Zeitachsen-ms). Muss ueber einem Bildwiederholtakt liegen (~16ms bei
// 60Hz), damit kein Schlag verpasst wird, und klein genug bleiben, dass ein
// Sprung/Tempowechsel nicht mehrere schon terminierte Klicks hinterherzieht.
const LOOKAHEAD_MS = 60

/**
 * Metronom und Einzähler.
 *
 * Fünftes Composable aus der Zerlegung von `ScoreViewer.vue`.
 *
 * Beides gehört zusammen, weil es sich denselben Klickerzeuger teilt und
 * einander ausschließt: während der Einzähler läuft, schweigt das laufende
 * Metronom (sonst klänge beides übereinander).
 *
 * Der Klick kommt bewusst NICHT aus dem Haupt-Synthesizer: `score.mid` trägt
 * nachweislich keine Metronomnoten (gemessen an zwei Partituren, siehe
 * `lib/metronome.js`), und der Klick muss auch im stummen Modus und VOR dem
 * eigentlichen Wiedergabestart funktionieren.
 *
 * @param {object} deps
 * @param {() => object|null} deps.measuresTimeline `measures.json`
 * @param {() => number} deps.durationMs Gesamtdauer (Ende des letzten Taktes)
 * @param {() => number} deps.baseTempoBpm Viertel-BPM der Partitur (M8)
 * @param {() => number} deps.effectiveTempoBpm eingestellte BPM
 * @param {() => number} deps.tempoFactor Faktor auf playbackRate
 * @param {() => boolean} deps.isPlaying
 * @param {() => void} deps.play startet die Wiedergabe nach dem Einzähler
 */
export function useMetronome({
	measuresTimeline,
	durationMs,
	baseTempoBpm,
	effectiveTempoBpm,
	tempoFactor,
	isPlaying,
	play,
}) {
	const enabled = ref(false)
	// 'all' = jeder Schlag (Voreinstellung), 'downbeat' = nur der
	// Taktanfang.
	const beats = ref('all')

	let click = null
	// "<Taktindex>:<Schlagindex>" des zuletzt terminierten Klicks - verhindert
	// Doppelklicks, weil die rAF-Schleife denselben Schlag mehrere Frames lang
	// als fällig sieht.
	let lastBeatKey = null
	// Wiedergabezeit beim letzten Tick: ein Rückwärtssprung (Seek,
	// Loop-Neustart) setzt lastBeatKey zurück, damit die Eins danach wieder
	// klickt, auch wenn es derselbe Schlag ist.
	let lastTimeMs = 0
	let countInTimers = []
	let isCountingIn = false

	function ensureClick() {
		if (!click) {
			click = createMetronomeClick()
		}
		return click
	}

	function clearCountIn() {
		countInTimers.forEach((id) => clearTimeout(id))
		countInTimers = []
		isCountingIn = false
	}

	/**
	 * Läuft in der rAF-Schleife mit, terminiert den Klick aber nicht dort:
	 * gesucht wird der Schlag, der in LOOKAHEAD_MS fällig ist, und die
	 * Restzeit geht an den AudioContext (siehe metronomeClick.js). Auf
	 * Taktebene fiel das rAF-Raster nicht auf, auf Schlagebene hörte man es.
	 *
	 * Der Vorlauf ist in Zeitachsen-ms gemessen; die Umrechnung in echte
	 * Sekunden teilt durch den Tempofaktor, weil die Zeitachse mit
	 * playbackRate läuft (die Zeitachse selbst bleibt unberührt).
	 *
	 * @param {number} currentTimeMs
	 */
	function tick(currentTimeMs) {
		// Rückwärtssprung: dasselbe Schlagraster gilt wieder von vorn.
		if (currentTimeMs < lastTimeMs) {
			lastBeatKey = null
		}
		lastTimeMs = currentTimeMs
		if (!enabled.value || !isPlaying() || isCountingIn) {
			return
		}
		const measures = measuresTimeline()
		if (!measures || measures.events.length === 0) {
			return
		}
		const lookaheadMs = currentTimeMs + LOOKAHEAD_MS
		const index = findStepIndex(measures.times, lookaheadMs)
		const measureStartMs = measures.events[index].timeMs
		const measureEndMs = index + 1 < measures.events.length
			? measures.events[index + 1].timeMs
			: durationMs()
		const beat = resolveBeatInMeasure(measureStartMs, measureEndMs, lookaheadMs, baseTempoBpm(), beats.value === 'all')
		if (!beat) {
			return
		}
		const key = `${index}:${beat.index}`
		if (key === lastBeatKey) {
			return
		}
		lastBeatKey = key
		const delaySeconds = Math.max(0, (beat.timeMs - currentTimeMs) / (tempoFactor() || 1) / 1000)
		ensureClick().click(beat.index === 0, delaySeconds)
	}

	/**
	 * Einzähler vor dem Loop-Start („mehr wert als die meiste übrige
	 * Mixer-Funktionalität"). Schätzt die Schlagzahl des Zieltaktes aus seiner
	 * Dauer und der aktuellen BPM (`measures.json` trägt keine eigene
	 * Taktart), zählt in Echtzeit herunter und startet danach die Wiedergabe
	 * selbst.
	 *
	 * @param {number} targetMs Zeitpunkt, an dem die Wiedergabe beginnen soll
	 * @param {number} defaultBpm Rückfall-BPM, falls keine eingestellt ist
	 */
	function startCountIn(targetMs, defaultBpm) {
		clearCountIn()
		const measures = measuresTimeline()
		if (!measures || measures.events.length === 0) {
			play()
			return
		}
		const index = findStepIndex(measures.times, targetMs)
		const measureStartMs = measures.events[index].timeMs
		const nextMs = index + 1 < measures.events.length
			? measures.events[index + 1].timeMs
			: durationMs()
		const beatsInMeasure = estimateBeatsInMeasure(nextMs - measureStartMs, baseTempoBpm())
		const bpm = effectiveTempoBpm() > 0 ? effectiveTempoBpm() : defaultBpm
		const beatIntervalMs = 60000 / bpm
		const delays = computeCountInDelaysMs(beatsInMeasure, beatIntervalMs)
		isCountingIn = true
		const clicker = ensureClick()
		countInTimers = delays.map((delay, i) => setTimeout(() => clicker.click(i === 0), delay))
		// Die Wiedergabe startet einen Schlag NACH dem letzten Einzähler-Klick:
		// würde sie auf dem letzten Klick starten, zählte der Einzähler bei
		// vier Schlägen nur drei, und der vierte fiele mit der Eins zusammen.
		// Am Dirigat ist das der Unterschied zwischen „und eins" und einem
		// verschluckten Schlag.
		countInTimers.push(setTimeout(() => {
			isCountingIn = false
			countInTimers = []
			play()
		}, delays[delays.length - 1] + beatIntervalMs))
	}

	function destroy() {
		clearCountIn()
		click?.destroy?.()
		click = null
	}

	function reset() {
		clearCountIn()
		enabled.value = false
		lastBeatKey = null
		lastTimeMs = 0
	}

	return { enabled, beats, tick, startCountIn, clearCountIn, destroy, reset }
}
