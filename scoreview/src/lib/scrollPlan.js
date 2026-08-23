// Reine Rechnung für das Autoscroll-Nachführen der Wiedergabe (Phase 16,
// PLAN.md "Probentauglichkeit I: Mitlesen"). Kennt keine DOM-Objekte, nur
// Zahlen (Dokument-/Viewport-Koordinaten in px) - genau wie scoreLayout.js
// ohne DOM testbar (siehe CLAUDE.md). ScoreViewer.vue liefert die Zahlen aus
// getBoundingClientRect()/scrollTop und wendet ein zurückgegebenes Ziel per
// scrollTo() an; diese Datei entscheidet nur OB und WOHIN.

/**
 * Hält den Cursor in einem ruhigen "Sichtband" der Viewporthöhe (per Default
 * die mittleren 30%), statt ihn bis an den Rand laufen zu lassen und dann
 * hart nachzuspringen. Liefert `null`, wenn der Cursor bereits im Band liegt
 * (kein Scroll nötig) - so löst ein unveränderter Notenkopf über mehrere
 * Aufrufe hinweg (siehe useScoreSync.js) keine wiederholte Scroll-Animation
 * aus.
 *
 * @param {object} params
 * @param {number} params.cursorTop Position der Cursor-Oberkante in
 *   Dokumentkoordinaten des Scroll-Containers (scrollTop-Basis, nicht
 *   Viewport-relativ)
 * @param {number} params.cursorHeight Höhe des Cursor-Rechtecks in px
 * @param {number} params.scrollTop aktuelles scrollTop des Containers
 * @param {number} params.viewportHeight sichtbare Höhe des Containers (px)
 * @param {number} [params.bandStart] Bandanfang als Anteil der Viewporthöhe (0-1)
 * @param {number} [params.bandEnd] Bandende als Anteil der Viewporthöhe (0-1)
 * @returns {number|null} neues scrollTop, oder null wenn keine Änderung nötig
 */
export function planAutoScroll({
	cursorTop,
	cursorHeight,
	scrollTop,
	viewportHeight,
	bandStart = 0.35,
	bandEnd = 0.65,
}) {
	const bandTopAbs = scrollTop + viewportHeight * bandStart
	const bandBottomAbs = scrollTop + viewportHeight * bandEnd
	const cursorBottom = cursorTop + cursorHeight

	// Ueberlappt der Cursor das Band bereits irgendwo, ist nichts zu tun -
	// unabhaengig davon, ob BEIDE Kanten (Ober-/Unterkante) im Band liegen.
	// Das ist bewusst so und kein Sonderfall: bei einer Partitur mit mehreren
	// Systemen/Stimmen (SATB etc.) liefert der Sidecar pro Note ein
	// Cursor-Rechteck, das die GESAMTE Zeile/das gesamte System abdeckt (M4/
	// M9-Nachbarschaft) - dessen Hoehe kann die Bandhoehe locker uebersteigen.
	// Ein Cursor, der groesser als das Band ist, kann NIE gleichzeitig mit
	// Ober- UND Unterkante im Band liegen; ein Fix "verlangte" frueher
	// abwechselnd mal die eine, mal die andere Kante ins Band zu ziehen - bei
	// UNVERAENDERTER Notenposition (mehrere Noten im selben System teilen
	// sich dieselbe y/h, siehe PLAN.md) fuehrte das zu endlosem Hoch-Runter-
	// Springen bei jedem Notenwechsel, real beobachtet bei SATB-Partituren
	// (gefunden per Nutzer-Feedback, nicht in den zwei kleineren Testpartituren
	// reproduzierbar, weil deren Notenzeilen-Cursor schmaler als das Band ist).
	if (cursorBottom >= bandTopAbs && cursorTop <= bandBottomAbs) {
		return null
	}
	if (cursorBottom < bandTopAbs) {
		return cursorTop - viewportHeight * bandStart
	}
	return cursorBottom - viewportHeight * bandEnd
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
 * @returns {boolean}
 */
export function shouldSuppressAutoScroll(lastManualScrollAt, now, resumeDelayMs = 2500) {
	return lastManualScrollAt !== null && (now - lastManualScrollAt) < resumeDelayMs
}
