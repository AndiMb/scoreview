// Reine Rechnung für das Autoscroll-Nachführen der Wiedergabe beim Mitlesen.
// Kennt keine DOM-Objekte, nur Zahlen (Dokument-/Viewport-
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
 * Ein festes Sichtband (mittlere 30 % der Viewporthöhe, "nichts zu tun",
 * sobald der Cursor es irgendwo überlappt) wäre keine Lösung: ein Cursor,
 * der höher als das Band ist, kann nie mit beiden Kanten darin liegen - das
 * Band-Nachziehen führte bei SATB-Partituren zu endlosem Hoch-Runter-
 * Springen. Und selbst ohne dieses Problem taugte es nicht über den
 * Zoombereich hinweg: je stärker der Zoom, desto höher das System, und
 * "überlappt das Band" hieße dann "die Hälfte der Zeile steht unter der
 * Kante".
 *
 * Stattdessen richtet sich das Nachführen am tatsächlich verfügbaren Platz
 * entlang:
 *
 * - Passt das System in den Viewport, wird es VOLLSTÄNDIG sichtbar
 *   gehalten. Nachgeführt wird nur, wenn es das nicht ist - und dann so, dass
 *   `lead` des freien Platzes darüber und der Rest darunter liegt
 *   (Vorausschau auf das, was als Nächstes kommt). Der Rand schrumpft dabei
 *   auf das, was übrig ist: Ein System, das nur MIT Rand nicht hineinpasst,
 *   gehört trotzdem ganz ins Bild, nicht nach der Regel darunter
 *   angeschnitten (Zoom auf etwa Systemhöhe - dort fehlte sonst die
 *   Basszeile, während oben Platz frei blieb).
 * - Ist es höher als der Viewport (starker Zoom, Orchesterpartitur), wird die
 *   Oberkante angelegt: von oben lesen ist die einzige sinnvolle Lesart, wenn
 *   ohnehin nicht alles gleichzeitig sichtbar sein kann.
 *
 * Beide Zweige sind stabil, und zwar nachrechenbar, nicht nur empirisch:
 * nach einem ausgeführten Nachführen erfüllt die neue Position die jeweilige
 * "ist in Ordnung"-Bedingung, der nächste Aufruf liefert also `null` statt
 * eines zweiten Sprungs. Genau daran scheitert die Bandvariante von oben.
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

	if (cursorHeight <= viewportHeight) {
		const fitMargin = Math.min(safeMargin, (viewportHeight - cursorHeight) / 2)
		const freeSpace = viewportHeight - cursorHeight - 2 * fitMargin
		const fullyVisible = cursorTop >= scrollTop + fitMargin
			&& cursorBottom <= scrollTop + viewportHeight - fitMargin
		if (fullyVisible) {
			return null
		}
		return cursorTop - (fitMargin + freeSpace * lead)
	}

	// Höher als der Viewport: "in Ordnung" ist nur die angelegte Oberkante.
	// Eine großzügigere Toleranz (früher: irgendwo im oberen Viertel) brachte
	// nichts - die Hülle umfasst das ganze System, ihre Oberkante bleibt
	// innerhalb einer Zeile also ohnehin stehen - und schadete genau beim
	// Systemwechsel: Das neue System blieb mit leerem Raum darüber und
	// abgeschnittenen Unterstimmen stehen.
	if (cursorTop >= scrollTop - 1 && cursorTop <= scrollTop + safeMargin + 1) {
		return null
	}
	return cursorTop - safeMargin
}

/**
 * Waagerechtes Gegenstück: seit die Seite über die Containerbreite
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
 * manuell gescrollt wurde ("bei manuellem Scrollen aussetzen und nach
 * kurzer Zeit wieder übernehmen"). Reine Zeitvergleichs-Funktion, damit
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

/**
 * Ob ein `scrollend` ein Eingriff der Nutzerin war. Der Browser meldet es
 * auch am Ende des eigenen, weichen Nachfuehrens - gezaehlt als Eingriff,
 * hielt jedes Nachfuehren sich selbst fuer die Pausendauer an (gemessen bei
 * starkem Zoom: Der Cursor lief waagerecht aus dem Bild, und beim
 * Systemwechsel blieb die Ansicht rechts stehen, bis die Pause ablief). Ein
 * Eingriff ist es nur, wenn seit dem eigenen Scrollen eine Geste begann -
 * dann ist das Ende ihr Traegheitsscrollen.
 *
 * @param {object} params
 * @param {number|null} params.ownScrollAt Beginn des eigenen Scrollens (ms),
 *   null, wenn keins unterwegs ist
 * @param {number|null} params.lastGestureAt Beginn der letzten Geste (ms)
 * @return {boolean}
 */
export function isManualScrollEnd({ ownScrollAt, lastGestureAt }) {
	if (ownScrollAt === null) {
		return true
	}
	return lastGestureAt !== null && lastGestureAt >= ownScrollAt
}

// Own navigations that land somewhere else in the piece. Switched off,
// autoscroll stops following the playback - but someone who types a measure
// or taps a rehearsal mark wants to see where they landed, and a jump that
// does not move the view looks like one that did not happen. A loop or a
// transposition moves nothing, and a tapped note is on screen by definition -
// forcing the scroll there would only nudge a half-visible system under the
// finger (issue #12).
const REVEALING_NAVIGATIONS = new Set(['measure', 'mark', 'seek', 'annotationJump'])

/**
 * Whether an own navigation (useFollowSession#noteNavigation kinds) should
 * bring the cursor into view even with autoscroll switched off.
 *
 * @param {string} kind
 * @return {boolean}
 */
export function revealsCursor(kind) {
	return REVEALING_NAVIGATIONS.has(kind)
}

/**
 * Whether a span is at least partly on screen - along one axis, in the same
 * coordinates as the viewport. Partly is enough: the button back to the
 * playing position is for a cursor that is gone, not for one at the edge.
 *
 * @param {object} params
 * @param {number} params.start start of the span (px)
 * @param {number} params.size its length (px)
 * @param {number} params.viewStart start of the visible area (px)
 * @param {number} params.viewSize its length (px)
 * @return {boolean}
 */
export function spanInView({ start, size, viewStart, viewSize }) {
	return start < viewStart + viewSize && start + Math.max(size, 0) > viewStart
}

/**
 * Where the cursor stands in the scroll container's content, from the page's
 * box in that content and the cursor's share of the page. Both are known
 * without asking the browser: the page boxes are measured once and kept until
 * something moves (useAutoScroll.js), the share comes from the page's viewBox
 * (ScorePage.vue#getCursorBox). Asking per note change instead - a
 * getBoundingClientRect() right after the highlight classes changed - forced
 * a style and layout pass each time: a quarter of all script time during
 * playback, measured on a phone profile.
 *
 * @param {{top:number,left:number,width:number,height:number}} page the page box in content px
 * @param {{top:number,left:number,width:number,height:number}} share the cursor as fractions of the page
 * @return {{top:number,left:number,width:number,height:number}} the cursor in content px
 */
export function cursorInContent(page, share) {
	return {
		top: page.top + share.top * page.height,
		left: page.left + share.left * page.width,
		width: share.width * page.width,
		height: share.height * page.height,
	}
}
