// The style sheet of the document that holds a page's notation
// (scorePageFrame.js, used by ScorePage.vue). Neither the page's scoped CSS
// nor Nextcloud's reach into it, and custom properties do not inherit across
// the document boundary either: the highlight and note colours are copied
// onto the frame's root (ScorePage.vue, `svgVars`).
//
// `.dark` sits on the container inside the frame, set from the `noteTheme`
// prop. Specificity matters below: the dark recolouring is (0,1,0) through
// :where(), so the highlight and intonation rules (0,1,1 and up) and hiding
// the white background rectangle win against it - otherwise no note would
// light up in the dark.

export const SCORE_SVG_STYLE = `
/*
 * Ohne diese Regel rendert das SVG in seiner eigenen mm-Bemaßung statt auf
 * 100% der Containerbreite - das Cursor-Overlay (Prozentwerte relativ zum
 * Container) und die sichtbare Note driften dann auseinander (gemessen:
 * SVG 793.9px statt Container-Breite 900px).
 */
svg {
	width: 100%;
	height: auto;
	display: block;
}

/*
 * MuseScore rendert als allererstes Element ein deckendes weißes
 * Hintergrundrechteck über die volle viewBox (docs/architecture.md M9) -
 * ohne diese Regel verdeckte es den dahinterliegenden Cursor.
 *
 * Zwei Selektoren, weil die beiden Konvertierungswege es unterschiedlich
 * schreiben (E3):
 * - Sidecar: <path class=""> - laut M9 im ganzen Dokument nur dieses eine.
 * - scoreview-engine: <path fill="#ffffff"> ohne class-Attribut als direktes
 *   Kind des <svg>. Beide Merkmale zusammen sind nötig: Ein Bogen ist
 *   ebenfalls ein classloses <path>, liegt aber in einer Gruppe; ein weiß
 *   gefüllter hohler Notenkopf darf nicht mit verschwinden.
 */
path[class=""],
svg > path[fill="#ffffff"] {
	fill: none;
}

/*
 * Dunkelmodus der Noten: umgefaerbt wird nur, was MuseScore schwarz bzw.
 * weiss zeichnet, bewusst KEIN filter: invert() - das machte aus einem
 * eingebetteten Foto ein Negativ. Elemente ohne eigene Fuellung erben sie
 * vom <svg>, farbige Elemente der Partitur bleiben farbig.
 */
.dark svg {
	fill: var(--scoreview-ink);
}

.dark :where([fill="#000000"]) {
	fill: var(--scoreview-ink);
}

.dark :where([stroke="#000000"]) {
	stroke: var(--scoreview-ink);
}

.dark :where([fill="#ffffff"]) {
	fill: var(--scoreview-page);
}

/*
 * Der klingende Notenkopf (M10, lib/svgIndex.js). Flaechen und Striche
 * getrennt: Notenkopf, Pause und Balken sind gefuellt, Hals und Hilfslinie
 * gestrichen - eine gemeinsame fill-Regel liesse die Haelse schwarz.
 *
 * Die Klasse haengt je nach Konvertierungsweg an einer anderen Stelle (E3):
 * - Sidecar: am gezeichneten Element selbst, <path class="Note seg-7 …">.
 * - scoreview-engine: an einer Gruppe darum,
 *   <g class="Note seg-7 …"><g transform><use fill="#000000"/></g></g> -
 *   fill an der Gruppe traegt nicht, das fill-Attribut am <use> gewinnt.
 * Die Nachfahren-Regeln faerben deshalb genau das um, was Farbe traegt;
 * fill="none"/stroke="none" bleiben ausgenommen, sonst wuerde ein Hals als
 * Flaeche ausgemalt. Kein transition - bei acht Ereignissen je Sekunde soll
 * die Farbe stehen, nicht nachlaufen.
 */
path.scoreview-sounding,
text.scoreview-sounding,
.scoreview-sounding [fill]:not([fill="none"]) {
	fill: var(--scoreview-highlight, #d32f2f);
}

polyline.scoreview-sounding,
line.scoreview-sounding,
.scoreview-sounding [stroke]:not([stroke="none"]) {
	stroke: var(--scoreview-highlight, #d32f2f);
}

/*
 * Intonation: gruen, gelb, rot, und grau fuer „nicht auswertbar". Nach der
 * Hervorhebung notiert, damit eine bewertete Note ihre Farbe behaelt, wenn
 * der Cursor darueber laeuft.
 */
path.scoreview-intonation-green,
.scoreview-intonation-green [fill]:not([fill="none"]) {
	fill: var(--scoreview-intonation-green, #2e7d32);
}

path.scoreview-intonation-yellow,
.scoreview-intonation-yellow [fill]:not([fill="none"]) {
	fill: var(--scoreview-intonation-yellow, #f9a825);
}

path.scoreview-intonation-red,
.scoreview-intonation-red [fill]:not([fill="none"]) {
	fill: var(--scoreview-intonation-red, #d32f2f);
}

path.scoreview-intonation-na,
.scoreview-intonation-na [fill]:not([fill="none"]) {
	fill: var(--scoreview-intonation-na, #9e9e9e);
}
`
