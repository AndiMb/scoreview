import { computed, ref } from 'vue'
import { findMeasureStartTime } from '../lib/scoreLayout.js'

/**
 * Der Loop von Takt A bis Takt B - Kernfunktion für die Probenarbeit, samt
 * der Bereichsmarkierung im Notenbild.
 *
 * Sechstes Composable aus der Zerlegung von `ScoreViewer.vue`.
 *
 * Das eigentliche Zurückspringen passiert bewusst **nicht** hier, sondern in
 * der Zeitschleife des Players (`shouldRestart()` wird dort pro Frame
 * gefragt): Looping ist keine Eigenschaft der Zeitquelle - stummer Platzhalter
 * und echter Player erfüllen dieselbe kleine `seek()`-Schnittstelle, und
 * beide sollen loopen können, ohne es selbst zu wissen.
 *
 * @param {object} deps
 * @param {() => object|null} deps.measuresTimeline `measures.json`
 * @param {() => number} deps.durationMs Ende des Stücks (Loop-Ende am Schluss)
 * @param {() => boolean} deps.isPlaying
 * @param {(timeMs: number) => void} deps.seek
 * @param {(targetMs: number) => void} deps.startCountIn Einzähler vor dem Start
 * @param {() => void} deps.clearCountIn
 */
export function useLoop({ measuresTimeline, durationMs, isPlaying, seek, startCountIn, clearCountIn }) {
	// '', nicht null: NcTextField (anders als ein natives <input>) nimmt als
	// modelValue nur string|number entgegen und wirft bei null einen
	// Laufzeitfehler ("Cannot read properties of null"). '' bleibt wie null
	// falsy für die Leerprüfung in toggle(), verhält sich also gleich.
	const fromMeasure = ref('')
	const toMeasure = ref('')
	const active = ref(false)
	const startMs = ref(null)
	const endMs = ref(null)

	/**
	 * Sichtbare Markierung des Loop-Bereichs - zwei Flaggen an
	 * Start-/Ende-Takt. Markiert bewusst nur den JEWEILIGEN TAKTANFANG, nicht
	 * die volle Taktbreite: `measures.json` liefert nur Punktkoordinaten (M4),
	 * keine Taktausdehnung.
	 */
	const markers = computed(() => {
		const measures = measuresTimeline()
		if (!active.value || !measures) {
			return []
		}
		const fromRect = measures.elements[String(Number(fromMeasure.value) - 1)]
		const toRect = measures.elements[String(Number(toMeasure.value) - 1)]
		const list = []
		if (fromRect) {
			list.push({ id: 'loop-start', kind: 'start', ...fromRect })
		}
		if (toRect) {
			list.push({ id: 'loop-end', kind: 'end', ...toRect })
		}
		return list
	})

	function toggle() {
		if (active.value) {
			active.value = false
			startMs.value = null
			endMs.value = null
			clearCountIn()
			return
		}
		const measures = measuresTimeline()
		if (!measures || !fromMeasure.value || !toMeasure.value) {
			return
		}
		const start = findMeasureStartTime(measures, Number(fromMeasure.value))
		// Loop-Ende = Beginn des Taktes NACH dem angegebenen "bis"-Takt, damit
		// dieser Takt noch vollständig durchgespielt wird, bevor
		// zurückgesprungen wird; am Stückende gilt stattdessen durationMs.
		const end = findMeasureStartTime(measures, Number(toMeasure.value) + 1) ?? durationMs()
		if (start === null) {
			return
		}
		startMs.value = start
		endMs.value = end
		active.value = true
		seek(start)
		// Nur einzählen, wenn noch nicht gespielt wird - sonst würde eine
		// laufende Probe unterbrochen statt unterstützt.
		if (!isPlaying()) {
			startCountIn(start)
		}
	}

	/**
	 * „Loop ab aktuellem Takt" („der häufigste Fall in der Probe: man ist
	 * schon an der Stelle") - füllt nur das Feld, aktiviert den Loop
	 * nicht automatisch (der „bis"-Takt bleibt eine bewusste Entscheidung).
	 *
	 * @param {?number} measureNumber
	 */
	function setFromCurrentMeasure(measureNumber) {
		if (measureNumber) {
			fromMeasure.value = measureNumber
		}
	}

	/**
	 * Ob die Wiedergabe jetzt an den Loop-Anfang zurück soll. Wird von der
	 * Zeitschleife pro Frame gefragt.
	 *
	 * @param {number} currentTimeMs
	 * @return {?number} Zielzeit, oder null wenn nichts zu tun ist
	 */
	function restartTarget(currentTimeMs) {
		if (active.value && endMs.value !== null && currentTimeMs >= endMs.value) {
			return startMs.value
		}
		return null
	}

	function reset() {
		fromMeasure.value = ''
		toMeasure.value = ''
		active.value = false
		startMs.value = null
		endMs.value = null
	}

	return { fromMeasure, toMeasure, active, markers, toggle, setFromCurrentMeasure, restartTarget, reset }
}
