import { computed, ref, shallowRef, watch } from 'vue'
import { resolveLoopRange } from '../lib/loopRange.js'

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
 * @param {() => void} [deps.onWrap] nach jedem Ruecksprung an den Anfang -
 *   der Speed-Trainer zaehlt daran seine Durchlaeufe. Ein Rueckruf statt
 *   einer Zaehlung in der Zeitschleife: Dort stuende sonst Trainerlogik
 *   zwischen Cursor und Metronom.
 */
export function useLoop({ measuresTimeline, durationMs, isPlaying, seek, startCountIn, clearCountIn, onWrap = () => {} }) {
	// '', nicht null: NcTextField (anders als ein natives <input>) nimmt als
	// modelValue nur string|number entgegen und wirft bei null einen
	// Laufzeitfehler ("Cannot read properties of null"). '' bleibt wie null
	// falsy für die Leerprüfung in toggle(), verhält sich also gleich.
	const fromMeasure = ref('')
	const toMeasure = ref('')
	const active = ref(false)
	// The loop that playback actually runs - numeric, null while off
	// (lib/loopRange.js). Markers, loop focus, export, singing lane and
	// "Follow me" read this, not the fields: a field being edited holds
	// '' or a half-typed number, and a reader converting it on its own
	// drifted from what playback jumps back to.
	const range = shallowRef(null)
	const startMs = computed(() => range.value?.startMs ?? null)
	const endMs = computed(() => range.value?.endMs ?? null)

	// Editing a field while the loop runs moves the loop itself, not just
	// its markers. An incomplete value (empty while retyping) keeps the
	// last valid range so playback does not lose its loop mid-edit.
	watch([fromMeasure, toMeasure], ([from, to]) => {
		if (!active.value) {
			return
		}
		const next = resolveLoopRange(measuresTimeline(), from, to, durationMs())
		if (next) {
			range.value = next
		}
	})

	/**
	 * Sichtbare Markierung des Loop-Bereichs - zwei Flaggen an
	 * Start-/Ende-Takt. Markiert bewusst nur den JEWEILIGEN TAKTANFANG, nicht
	 * die volle Taktbreite: `measures.json` liefert nur Punktkoordinaten (M4),
	 * keine Taktausdehnung.
	 */
	const markers = computed(() => {
		const measures = measuresTimeline()
		const current = range.value
		if (!active.value || !measures || !current) {
			return []
		}
		const fromRect = measures.elements[String(current.from - 1)]
		const toRect = measures.elements[String(current.to - 1)]
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
			range.value = null
			clearCountIn()
			return
		}
		const next = resolveLoopRange(measuresTimeline(), fromMeasure.value, toMeasure.value, durationMs())
		if (!next) {
			return
		}
		range.value = next
		active.value = true
		seek(next.startMs)
		// Nur einzählen, wenn noch nicht gespielt wird - sonst würde eine
		// laufende Probe unterbrochen statt unterstützt.
		if (!isPlaying()) {
			startCountIn(next.startMs)
		}
	}

	/**
	 * Den Loop von außen setzen - für „Folgt mir": Die Leitung schickt einen
	 * Bereich, und er gilt sofort, ohne dass jemand den Knopf drückt.
	 *
	 * Anders als toggle() weder Sprung noch Einzähler: Die Stelle schickt die
	 * Leitung getrennt (Position), und ein Einzähler auf jedem Gerät, das
	 * gerade nicht spielt, wäre im Probenraum ein Chor aus Klicks.
	 *
	 * @param {number} from erster Takt
	 * @param {number} to letzter Takt (wird noch ganz gespielt)
	 * @return {boolean} ob der Bereich gilt - false, wenn es die Takte nicht gibt
	 */
	function setRange(from, to) {
		const next = resolveLoopRange(measuresTimeline(), from, to, durationMs())
		if (!next) {
			return false
		}
		// Range and flag first: the field watcher then sees the same values
		// and resolves them to the same range.
		range.value = next
		active.value = true
		fromMeasure.value = next.from
		toMeasure.value = next.to
		return true
	}

	/** Den Loop aufheben, falls einer gilt - die Felder bleiben stehen. */
	function clear() {
		if (active.value) {
			toggle()
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
		const current = range.value
		if (active.value && current && currentTimeMs >= current.endMs) {
			return current.startMs
		}
		return null
	}

	/**
	 * Pro Frame aus der Zeitschleife: am Loop-Ende zurueckspringen und den
	 * Durchlauf melden.
	 *
	 * @param {number} currentTimeMs die ROHE Zeit (Begruendung in ScoreViewer.pumpTimeDisplay)
	 * @return {boolean} ob gesprungen wurde
	 */
	function wrapIfDue(currentTimeMs) {
		const target = restartTarget(currentTimeMs)
		if (target === null) {
			return false
		}
		seek(target)
		onWrap()
		return true
	}

	function reset() {
		fromMeasure.value = ''
		toMeasure.value = ''
		active.value = false
		range.value = null
	}

	return { fromMeasure, toMeasure, active, range, startMs, endMs, markers, toggle, setRange, clear, setFromCurrentMeasure, restartTarget, wrapIfDue, reset }
}
