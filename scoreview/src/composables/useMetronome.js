import { getCurrentScope, onScopeDispose, ref } from 'vue'
import { computeCountInDelaysMs, estimateBeatsInMeasure, planCountIn, resolveBeatInMeasure } from '../lib/metronome.js'
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
 * @param {() => ?AudioContext} deps.audioContext der AudioContext der
 *   Wiedergabe, solange es einen gibt - der Klick geht dann durch dieselbe
 *   Pufferkette wie die Musik (siehe lib/metronomeClick.js)
 * @param {(reason: string) => (() => void)} [deps.holdAudio] keeps that
 *   context awake during the count-in (lib/audioIdle.js)
 * @param {(measureIndex: number) => ?object} [deps.meterAt] the meter of a
 *   displayed measure (scoreFacts.metersFromArtifacts: beats, beatTicks,
 *   subdivisions), or null where there is none - then the beats are
 *   estimated from the measure's duration (lib/metronome.js)
 */
export function useMetronome({
	measuresTimeline,
	durationMs,
	baseTempoBpm,
	effectiveTempoBpm,
	tempoFactor,
	isPlaying,
	play,
	audioContext,
	holdAudio = () => Object.assign(() => {}, { ready: Promise.resolve() }),
	meterAt = () => null,
}) {
	const enabled = ref(false)
	// 'all' = jeder Schlag (Voreinstellung), 'downbeat' = nur der
	// Taktanfang, 'eighths' = dazu die Haelfte jedes Schlags leiser
	// (lib/metronome.js). A session choice: the practice settings of a score
	// (useMyPart.practice) carry transposition, coach and level, not this.
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
	// Count-in clicks already handed to the audio clock - a cancelled
	// count-in has to silence them, clearing the timers is not enough.
	let countInClicks = []
	let isCountingIn = false
	// The count-in clicks BEFORE play(): without a hold the playback context
	// may rest, and clicks scheduled on a suspended context sound late, all
	// at once, when it wakes (lib/audioIdle.js).
	let releaseCountIn = null
	let countInGeneration = 0

	function ensureClick() {
		if (!click) {
			click = createMetronomeClick(audioContext)
		}
		return click
	}

	function clearCountIn() {
		countInGeneration++
		countInTimers.forEach((id) => clearTimeout(id))
		countInTimers = []
		countInClicks.forEach((c) => c.cancel())
		countInClicks = []
		isCountingIn = false
		releaseCountIn?.()
		releaseCountIn = null
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
		const beat = resolveBeatInMeasure(measureStartMs, measureEndMs, lookaheadMs, baseTempoBpm(), beats.value, meterAt(measures.events[index].elid))
		if (!beat) {
			return
		}
		// The mode is part of the key: switched from beats to eighths mid-
		// measure, the same index means another click.
		const key = `${index}:${beats.value}:${beat.index}`
		if (key === lastBeatKey) {
			return
		}
		lastBeatKey = key
		const delaySeconds = Math.max(0, (beat.timeMs - currentTimeMs) / (tempoFactor() || 1) / 1000)
		ensureClick().click(beat.level, delaySeconds)
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
		// With a meter the count-in counts its conducted beats - two in 6/8,
		// each a dotted quarter long; without one, the estimate from the
		// measure's length in quarters.
		const meter = meterAt(measures.events[index].elid)
		const beatsInMeasure = meter?.beats > 0 ? meter.beats : estimateBeatsInMeasure(nextMs - measureStartMs, baseTempoBpm())
		const bpm = effectiveTempoBpm() > 0 ? effectiveTempoBpm() : defaultBpm
		const beatIntervalMs = (60000 / bpm) * ((meter?.beatTicks > 0 ? meter.beatTicks : 480) / 480)
		const delays = computeCountInDelaysMs(beatsInMeasure, beatIntervalMs)
		isCountingIn = true
		const clicker = ensureClick()
		const mine = ++countInGeneration
		releaseCountIn = holdAudio('count-in')
		// Schedule only once the context runs - the first click is due at once.
		releaseCountIn.ready.then(() => {
			if (mine !== countInGeneration) {
				return
			}
			scheduleCountIn(clicker, delays, beatIntervalMs, mine)
		})
	}

	function scheduleCountIn(clicker, delays, beatIntervalMs, mine) {
		const ctx = clicker.context()
		const plan = planCountIn(ctx.currentTime, delays, beatIntervalMs)
		// Beats only, whatever the mode: a count-in in eighths would be twice
		// as many clicks to count along to.
		countInClicks = plan.clickAt.map((at, i) => clicker.clickAt(i === 0 ? 0 : 1, at))
		// Die Wiedergabe startet einen Schlag NACH dem letzten Einzähler-Klick:
		// würde sie auf dem letzten Klick starten, zählte der Einzähler bei
		// vier Schlägen nur drei, und der vierte fiele mit der Eins zusammen.
		// Am Dirigat ist das der Unterschied zwischen „und eins" und einem
		// verschluckten Schlag.
		// The moment comes from the audio clock the clicks run on, not from a
		// wall-clock timer: if the clock starts late after waking, the clicks
		// move with it, and so must the start.
		atAudioTime(ctx, plan.playAt, mine, () => {
			isCountingIn = false
			countInTimers = []
			countInClicks = []
			play()
			// play() keeps the context awake from here on.
			releaseCountIn?.()
			releaseCountIn = null
		})
	}

	/**
	 * Calls `fn` once the context clock reaches `at`. Re-checks instead of
	 * trusting one timeout, since a just-woken clock may not run yet; a clock
	 * that never gets there gives up a second after the planned moment.
	 *
	 * @param {AudioContext} ctx
	 * @param {number} at context time in seconds
	 * @param {number} mine count-in generation; a newer one cancels
	 * @param {() => void} fn
	 */
	function atAudioTime(ctx, at, mine, fn) {
		const deadline = performance.now() + (at - ctx.currentTime) * 1000 + 1000
		const check = () => {
			if (mine !== countInGeneration) {
				return
			}
			const leftMs = (at - ctx.currentTime) * 1000
			if (leftMs <= 4 || performance.now() > deadline) {
				fn()
				return
			}
			countInTimers.push(setTimeout(check, leftMs))
		}
		check()
	}

	function destroy() {
		clearCountIn()
		click?.destroy?.()
		click = null
	}

	// A safety net, not the order: the viewer stops this explicitly where
	// the order matters (beforeUnmount/reset), and a forgotten line there
	// must not leave it running. Calling it twice does no harm.
	if (getCurrentScope()) {
		onScopeDispose(destroy)
	}

	function reset() {
		clearCountIn()
		enabled.value = false
		lastBeatKey = null
		lastTimeMs = 0
	}

	return { enabled, beats, tick, startCountIn, clearCountIn, destroy, reset }
}
