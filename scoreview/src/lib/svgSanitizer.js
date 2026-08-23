// Echte SVG-Bereinigung vor dem Einbetten ins DOM (v-html in ScorePage.vue).
//
// Ersetzt seit Phase 20 die frühere regexbasierte `sanitizeSvg()` aus
// scoreLayout.js. Der Wechsel ist NICHT kosmetisch, sondern das Ergebnis
// einer Messung: die alte Regex-Fassung liess 9 von 15 geprüften
// Umgehungsmustern durch (siehe PLAN.md Phase 20 für die Tabelle), darunter
// `onload=x()` OHNE Anführungszeichen, `javascript:`-URLs in `href`/
// `xlink:href`, `<foreignObject>` mit eingebettetem `<iframe>`, ein
// ungeschlossenes `<script>` sowie `<use href="http://…">` auf eine fremde
// Adresse. Eine Regex kann HTML/SVG nicht zuverlässig parsen - genau daran
// scheiterten diese Fälle.
//
// Warum das trotz "die Quelle ist MuseScores eigener Serializer" zählt: die
// `.mscz` selbst ist ein Nutzer-Upload, und MuseScore rendert Material aus
// der Partitur (Titel, Liedtext, Stimmennamen, freie Textfelder) in das SVG.
// Der Sanitizer ist die Schicht, die nicht darauf vertrauen muss, dass jede
// dieser Stellen sauber escaped wird.
//
// Bewusst in einer eigenen Datei statt in scoreLayout.js: dieses Modul
// braucht ein DOM (DOMPurify parst echt, statt Text zu ersetzen), während
// scoreLayout.js laut CLAUDE.md ausdrücklich ohne DOM testbar bleiben soll.

import DOMPurify from 'dompurify'

// Was ein von MuseScore erzeugtes Notenbild tatsächlich braucht - alles
// andere fliegt raus. Ermittelt aus den real ausgelieferten SVGs der
// Testpartituren (siehe M9: nur `class`, keine `id`s; Elemente sind
// path/polyline/rect/text/g/image samt Gruppierung), plus die üblichen
// Struktur-/Defs-Elemente, damit ein anderes MuseScore-Layout nicht
// versehentlich zerlegt wird.
//
// Die Zeilenumbrueche in beiden Listen sind bewusst gruppiert (Struktur /
// Formen / Text / Verlaeufe bzw. Geometrie / Fuellung / Strich / Schrift) und
// deshalb hier von `exp-list-style` ausgenommen: bei einer Allowlist IST die
// Liste der sicherheitsrelevante Inhalt, und die Gruppierung sagt, warum ein
// Eintrag drinsteht. Ein Eintrag pro Zeile macht daraus 74 Zeilen ohne diese
// Aussage - siehe PLAN.md Phase 23/Schritt 2.
/* eslint-disable @stylistic/exp-list-style */
const ALLOWED_TAGS = [
	'svg', 'g', 'defs', 'symbol', 'title', 'desc', 'metadata',
	'path', 'polyline', 'polygon', 'line', 'rect', 'circle', 'ellipse',
	'text', 'tspan', 'textPath', 'image', 'use',
	'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern',
]

const ALLOWED_ATTR = [
	'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
	'd', 'points', 'transform', 'class', 'id', 'style',
	'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
	'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-miterlimit',
	'opacity', 'font-family', 'font-size', 'font-style', 'font-weight',
	'text-anchor', 'dominant-baseline', 'letter-spacing', 'xml:space',
	'gradientUnits', 'gradientTransform', 'offset', 'stop-color', 'stop-opacity',
	'clip-path', 'clip-rule', 'mask', 'patternUnits', 'preserveAspectRatio',
	'version', 'xmlns', 'xmlns:xlink',
]
/* eslint-enable @stylistic/exp-list-style */

/**
 * Bereinigt SVG-Text für das direkte Einbetten ins DOM.
 *
 * Härter als eine reine Tag-/Attribut-Allowlist: `href`/`xlink:href` sind
 * gar nicht erlaubt (kein `javascript:`, aber auch kein Nachladen von einer
 * fremden Adresse über `<use>` oder `<image>`), `<foreignObject>` ist nicht
 * erlaubt (dort lebt sonst beliebiges HTML), und `<style>` ist nicht erlaubt
 * (sonst könnte `url(...)` externe Ressourcen ziehen und damit den Aufruf
 * einer fremden Adresse verraten). Ein MuseScore-Notenbild braucht nichts
 * davon - alle Grafik steckt in `path`/`polyline`/`text`.
 *
 * @param {string} svgText
 * @return {string}
 */
export function sanitizeSvg(svgText) {
	return DOMPurify.sanitize(svgText, {
		USE_PROFILES: { svg: true, svgFilters: false, html: false, mathMl: false },
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		// Nie erlauben, auch wenn eine Allowlist sie sonst durchliesse.
		FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'style', 'set', 'animate', 'animateTransform', 'animateMotion', 'handler'],
		FORBID_ATTR: ['href', 'xlink:href', 'attributeName', 'to', 'from', 'values', 'begin'],
		// Datenattribute bringen hier keinen Nutzen, koennen aber Payloads tragen.
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: false,
	})
}
