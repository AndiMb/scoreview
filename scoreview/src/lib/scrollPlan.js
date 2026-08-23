// Reine Rechnung für das Autoscroll-Nachführen der Wiedergabe (Phase 16,
// PLAN.md "Probentauglichkeit I: Mitlesen"; zoomabhängig neu gefasst in
// Phase 22). Kennt keine DOM-Objekte, nur Zahlen (Dokument-/Viewport-
// Koordinaten in px) - genau wie scoreLayout.js ohne DOM testbar (siehe
// CLAUDE.md). ScoreViewer.vue liefert die Zahlen aus getBoundingClientRect()/
// scrollTop und wendet ein zurückgegebenes Ziel per scrollTo() an; diese
// Datei entscheidet nur OB und WOHIN.

// Sicherheitsabstand zum Viewportrand in px. Klein genug, um bei starkem
// Zoom nicht wertvolle Höhe zu verschenken, groß genug, dass ein System nicht
// exakt an der Kante klebt.
const DEFAULT_MARGIN_PX = 24

/**
 * Hält das Cursor-Rechteck (bei mehrsystemigen Partituren: die ganze
 * Notenzeile, siehe unten) vollständig im Blick.
 *
 * Bis Phase 21 hielt diese Funktion den Cursor in einem festen Sichtband
 * (mittlere 30 % der Viewporthöhe) und meldete "nichts zu tun", sobald er
 * das Band irgendwo überlappte. Das war die Antwort auf ein reales Problem
 * (ein Cursor, der höher als das Band ist, kann nie mit beiden Kanten darin
 * liegen - das Band-Nachziehen führte zu endlosem Hoch-Runter-Springen bei
 * SATB-Partituren), taugt aber nicht über den Zoombereich hinweg: je stärker
 * der Zoom, desto höher das System, und "überlappt das Band" heißt dann
 * "die Hälfte der Zeile steht unter der Kante".
 *
 * Deshalb jetzt am tatsächlich verfügbaren Platz entlang:
 *
 * - Passt das System mit Rand in den Viewport, wird es VOLLSTÄNDIG sichtbar
 *   gehalten. Nachgeführt wird nur, wenn es das nicht ist - und dann so, dass
 *   `lead` des freien Platzes darüber und der Rest darunter liegt
 *   (Vorausschau auf das, was als Nächstes kommt).
 * - Passt es nicht (starker Zoom, Orchesterpartitur), wird die Oberkante
 *   angelegt: von oben lesen ist die einzige sinnvolle Lesart, wenn ohnehin
 *   nicht alles gleichzeitig sichtbar sein kann.
 *
 * Beide Zweige sind stabil, und zwar nachrechenbar, nicht nur empirisch:
 * nach einem ausgeführten Nachführen erfüllt die neue Position die jeweilige
 * "ist in Ordnung"-Bedingung, der nächste Aufruf liefert also `null` statt
 * eines zweiten Sprungs. Genau daran war die Bandfassung gescheitert.
 *
 * @param {object} params
 * @param {number} params.cursorTop Position der Cursor-Oberkante in
 *   Dokumentkoordinaten des Scroll-Containers (scrollTop-Basis, nicht
 *   Viewport-relativ)
 * @param {number} params.cursorHeight Höhe des Cursor-Rechtecks in px
 * @param {number} params.scrollTop aktuelles scrollTop des Containers
 * @param {number} params.viewportHeight sichtbare Höhe des Containers (px)
 * @param {number} [params.margin] Sicherheitsabstand zum Rand in px
 * @param {number} [params.lead] Anteil des freien Platzes, der ÜBER dem
 *   System liegen soll (0-1; kleiner = mehr Vorausschau nach unten)
 * @return {number|null} neues scrollTop, oder null wenn keine Änderung nötig
 */
export function planAutoScroll({
	cursorTop,
	cursorHeight,
	scrollTop,
	viewportHeight,
	margin = DEFAULT_MARGIN_PX,
	lead = 0.35,
}) {
	if (!(viewportHeight > 0)) {
		return null
	}
	// Bei sehr kleinem Viewport (oder sehr großem Rand) darf der Rand nicht
	// den ganzen sichtbaren Bereich auffressen.
	const safeMargin = Math.min(margin, viewportHeight * 0.1)
	const cursorBottom = cursorTop + cursorHeight
	const freeSpace = viewportHeight - cursorHeight - 2 * safeMargin

	if (freeSpace >= 0) {
		const fullyVisible = cursorTop >= scrollTop + safeMargin
			&& cursorBottom <= scrollTop + viewportHeight - safeMargin
		if (fullyVisible) {
			return null
		}
		return cursorTop - (safeMargin + freeSpace * lead)
	}

	// Höher als der Viewport: als "in Ordnung" gilt, dass die Oberkante im
	// oberen Viertel steht - sonst würde jede Note in derselben, ohnehin nicht
	// vollständig sichtbaren Zeile ein Nachführen auslösen.
	if (cursorTop >= scrollTop - 1 && cursorTop <= scrollTop + viewportHeight * 0.25) {
		return null
	}
	return cursorTop - safeMargin
}

/**
 * Waagerechtes Gegenstück (Phase 22): seit die Seite über die Containerbreite
 * hinaus gezoomt werden kann (siehe ScorePage.vue), kann die aktuelle Stelle
 * auch seitlich aus dem Bild laufen. Zentriert sie dann - anders als senkrecht
 * gibt es hier keine sinnvolle "Vorausschau"-Richtung, weil das Notenbild in
 * beide Richtungen weitergeht.
 *
 * @param {object} params
 * @param {number} params.cursorLeft Linke Cursor-Kante in Dokumentkoordinaten
 * @param {number} params.cursorWidth Breite des Cursor-Rechtecks in px
 * @param {number} params.scrollLeft aktuelles scrollLeft des Containers
 * @param {number} params.viewportWidth sichtbare Breite des Containers (px)
 * @param {number} [params.margin] Sicherheitsabstand zum Rand in px
 * @return {number|null} neues scrollLeft, oder null wenn keine Änderung nötig
 */
export function planHorizontalScroll({
	cursorLeft,
	cursorWidth,
	scrollLeft,
	viewportWidth,
	margin = DEFAULT_MARGIN_PX,
}) {
	if (!(viewportWidth > 0)) {
		return null
	}
	const safeMargin = Math.min(margin, viewportWidth * 0.1)
	const cursorRight = cursorLeft + cursorWidth
	if (cursorLeft >= scrollLeft + safeMargin && cursorRight <= scrollLeft + viewportWidth - safeMargin) {
		return null
	}
	if (cursorWidth + 2 * safeMargin > viewportWidth) {
		// Breiter als das Bild - linke Kante anlegen, alles andere wäre
		// willkürlich.
		return cursorLeft - safeMargin
	}
	return cursorLeft - (viewportWidth - cursorWidth) / 2
}

/**
 * Ob das automatische Nachführen gerade pausieren soll, weil vor Kurzem
 * manuell gescrollt wurde (PLAN.md: "bei manuellem Scrollen aussetzen und
 * nach kurzer Zeit wieder übernehmen"). Reine Zeitvergleichs-Funktion, damit
 * die eigentliche Zeitmessung (Date.now(), Scroll-Events) beim Aufrufer
 * bleibt.
 *
 * @param {number|null} lastManualScrollAt Zeitstempel (ms) des letzten
 *   erkannten manuellen Scrollens, oder null wenn noch keins registriert wurde
 * @param {number} now aktueller Zeitstempel (ms)
 * @param {number} [resumeDelayMs] Pausendauer nach einem manuellen Scroll
 * @return {boolean}
 */
export function shouldSuppressAutoScroll(lastManualScrollAt, now, resumeDelayMs = 2500) {
	return lastManualScrollAt !== null && (now - lastManualScrollAt) < resumeDelayMs
}
