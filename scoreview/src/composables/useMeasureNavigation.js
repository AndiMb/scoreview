import { computed, ref, watch } from 'vue'
import { formatMeasureWithMark, positionWithMark, resolveJumpTarget } from '../lib/scoreFacts.js'
import { findMeasureStartTime, resolveMeasurePosition } from '../lib/scoreLayout.js'

/**
 * Wo die Wiedergabe gerade steht, in Takten - und wie man nach Takten
 * springt: das Taktfeld der Leiste, die Studierbuchstaben, die Pfeiltasten
 * und der Sprung der Leitung („Folgt mir").
 *
 * Taktanzeige und Sprungfeld sind DASSELBE Feld (`input`): Es zeigt die
 * laufende Taktnummer und nimmt das Sprungziel entgegen. Text, weil es mit
 * Studierbuchstaben auch „47 (C+3)" zeigt und „C" annimmt.
 *
 * @param {object} deps
 * @param {() => ?object} deps.measuresTimeline `measures.json`
 * @param {() => number} deps.durationMs Fallback-Ende des letzten Takts
 * @param {() => number} deps.displayTimeMs die gehoerte Stelle (usePlayback)
 * @param {() => ?number} deps.currentElid das klingende Element (Frame-Schleife)
 * @param {() => ?string} deps.currentEtag etag der laufenden Konvertierung
 * @param {() => ?object} deps.clock die Zeitquelle (seek)
 * @param {() => Array<{measure:number, text:string}>} deps.marks Studierbuchstaben
 * @param {() => number} deps.totalMeasures 0 = unbekannt
 * @param {(action: string) => boolean} deps.can Policy (usePerformanceMode)
 * @param {(kind: string) => void} deps.onNavigate eigenes Navigieren melden -
 *   loest das Folgen einer Leitung (useFollowSession.noteNavigation)
 * @param {(ms: number) => void} deps.forceAutoScrollFor Nachfuehren erzwingen
 */
export function useMeasureNavigation({
	measuresTimeline,
	durationMs,
	displayTimeMs,
	currentElid,
	currentEtag,
	clock,
	marks,
	totalMeasures,
	can,
	onNavigate,
	forceAutoScrollFor,
}) {
	const input = ref('1')
	// Solange das Taktfeld den Fokus hat, wird `input` nicht mehr von der
	// Wiedergabe nachgeführt: sonst überschriebe der nächste Takt die gerade
	// getippte Zahl.
	const fieldFocused = ref(false)
	// Der Aufklapper mit den Studierbuchstaben.
	const marksOpen = ref(false)

	// Musikalischer Anker der aktuellen Wiedergabeposition ("+ An aktueller
	// Stelle") - null solange measuresTimeline/durationMs noch nicht geladen
	// sind. Auf der Anzeigezeit, nicht der rohen: Die Taktnummer, die hier
	// herauskommt, steht in der Leiste und ist der Anker einer neuen Notiz -
	// beides bezieht sich auf die Stelle, die gerade klingt.
	const currentAnchor = computed(() => {
		const timeline = measuresTimeline()
		if (!timeline) {
			return null
		}
		const position = resolveMeasurePosition(timeline, displayTimeMs(), durationMs())
		if (!position) {
			return null
		}
		return { ...position, elid: currentElid(), anchorEtag: currentEtag() }
	})

	// Für das Taktfeld - null vor dem ersten berechneten Anker.
	const currentMeasureNumber = computed(() => (currentAnchor.value ? currentAnchor.value.measureNumber : null))

	// Was das Taktfeld zeigt: „47 (C+3)" mit Studierbuchstaben, sonst die Zahl.
	const display = computed(() => (currentMeasureNumber.value === null
		? null
		: formatMeasureWithMark(currentMeasureNumber.value, marks())))

	// Taktfeld der Wiedergabe nachführen, solange niemand darin tippt.
	watch(display, (text) => {
		if (text !== null && !fieldFocused.value) {
			input.value = text
		}
	})

	/**
	 * An den Anfang eines Takts - ein eigener Sprung, also nur, wo die
	 * Policy ihn erlaubt.
	 *
	 * @param {number|string} measureNumber
	 */
	function jumpToMeasure(measureNumber) {
		const timeline = measuresTimeline()
		const source = clock()
		if (!timeline || !source || !can('seek')) {
			return
		}
		const timeMs = findMeasureStartTime(timeline, Number(measureNumber))
		if (timeMs !== null) {
			source.seek(timeMs)
		}
	}

	/**
	 * Ein Sprung der Leitung („Folgt mir"). Nicht ueber jumpToMeasure():
	 * Das fragt can('seek'), und im Aufführungsmodus soll der Sprung
	 * trotzdem ankommen, solange gefolgt wird - ob er darf, entscheidet
	 * useFollowSession ueber `followJump`. Und es meldet kein eigenes
	 * Navigieren, das das Folgen loesen wuerde.
	 *
	 * @param {number} measureNumber
	 * @return {?number} die Zielzeit, oder null ohne Partitur oder Takt
	 */
	function followSeek(measureNumber) {
		const timeline = measuresTimeline()
		const source = clock()
		if (!timeline || !source) {
			return null
		}
		const timeMs = findMeasureStartTime(timeline, Number(measureNumber))
		if (timeMs === null) {
			return null
		}
		// Der Sequencer rueckt nach dem Suchlauf noch auf das naechste
		// Ereignis vor - das Fenster deckt das Nachfuehren bis dahin ab.
		forceAutoScrollFor(1500)
		source.seek(timeMs)
		return timeMs
	}

	/**
	 * Die eigene Stelle fuer die Leitung (lib/scoreFacts.js).
	 *
	 * @return {?{measure:number, mark:?string}}
	 */
	function followPosition() {
		return positionWithMark(currentMeasureNumber.value, marks())
	}

	/**
	 * Die Eingabe des Taktfelds anspringen: „47", „C" oder „C+3" - die
	 * Form der Anzeige laesst sich also unveraendert eintippen
	 * (resolveJumpTarget). Unbekanntes tut nichts, statt irgendwohin zu
	 * springen.
	 */
	function jumpToInput() {
		const target = resolveJumpTarget(input.value, marks(), totalMeasures() || null)
		if (target !== null && can('seek')) {
			onNavigate('measure')
			jumpToMeasure(target.measure)
		}
	}

	/**
	 * Einen Takt vor oder zurueck (Pfeiltasten).
	 *
	 * @param {number} delta
	 */
	function jumpRelative(delta) {
		const current = currentAnchor.value?.measureNumber
		if (!current || !can('seek')) {
			return
		}
		onNavigate('measure')
		jumpToMeasure(Math.max(1, current + delta))
	}

	/**
	 * Ein Chip ist eine Entscheidung - danach geht der Aufklapper zu.
	 * Offen gelassen gab er beim spaeteren Schliessen den Fokus an seinen
	 * Knopf zurueck, und wer inzwischen ins Taktfeld tippte, verlor dabei
	 * die Eingabe (gemessen: je nach Zeitpunkt).
	 *
	 * @param {{measure:number}} mark
	 */
	function jumpToMark(mark) {
		marksOpen.value = false
		if (can('seek')) {
			onNavigate('mark')
		}
		jumpToMeasure(mark.measure)
	}

	// Beim Hineintippen den ganzen Inhalt markieren: „47 (C+3)" will
	// niemand ergaenzen, sondern ersetzen.
	function onFieldFocus(event) {
		fieldFocused.value = true
		event?.target?.select?.()
	}

	function onFieldBlur() {
		fieldFocused.value = false
		if (display.value !== null) {
			input.value = display.value
		}
	}

	function reset() {
		input.value = '1'
		fieldFocused.value = false
	}

	return {
		input,
		marksOpen,
		currentAnchor,
		currentMeasureNumber,
		jumpToMeasure,
		followSeek,
		followPosition,
		jumpToInput,
		jumpRelative,
		jumpToMark,
		onFieldFocus,
		onFieldBlur,
		reset,
	}
}
