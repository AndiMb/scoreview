// Echte SVG-Bereinigung vor dem Einbetten ins DOM (v-html in ScorePage.vue).
//
// Ersetzt die frühere regexbasierte `sanitizeSvg()` aus scoreLayout.js. Der
// Wechsel ist NICHT kosmetisch, sondern das Ergebnis einer Messung: die alte
// Regex-Fassung liess 9 von 15 geprüften Umgehungsmustern durch, darunter
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

// Glyph-Referenzen der scoreview-engine (Browser-Backend): Text steht als
// <path id="gN"> in <defs> und wird per <use xlink:href="#gN"> referenziert
// (halbiert die SVG-Groesse gegenueber wiederholten Pfaden). href bleibt fuer
// alle anderen Elemente und fuer alles, was kein reines "#wort"-Fragment ist,
// verboten - insbesondere externe URLs und javascript: (genau die Muster, an
// denen die alte Regex-Fassung scheiterte).
const LOCAL_FRAGMENT = /^#[A-Za-z0-9_.:-]+$/

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
	if ((data.attrName === 'href' || data.attrName === 'xlink:href')
		&& node.tagName?.toLowerCase() === 'use'
		&& LOCAL_FRAGMENT.test(data.attrValue)) {
		data.forceKeepAttr = true
	}
})

// Was ein von MuseScore erzeugtes Notenbild tatsächlich braucht - alles
// andere fliegt raus. Ermittelt aus den real ausgelieferten SVGs der
// Testpartituren (siehe M9/M10: adressiert wird ueber `class` - dort stehen
// auch die Segment-, Zeilen- und Stimmenkennungen, auf denen die
// Hervorhebung des klingenden Notenkopfs aufsetzt; Elemente sind
// path/polyline/rect/text/g/image samt Gruppierung), plus die üblichen
// Struktur-/Defs-Elemente, damit ein anderes MuseScore-Layout nicht
// versehentlich zerlegt wird.
//
// Die Zeilenumbrueche in beiden Listen sind bewusst gruppiert (Struktur /
// Formen / Text / Verlaeufe bzw. Geometrie / Fuellung / Strich / Schrift) und
// deshalb hier von `exp-list-style` ausgenommen: bei einer Allowlist IST die
// Liste der sicherheitsrelevante Inhalt, und die Gruppierung sagt, warum ein
// Eintrag drinsteht. Ein Eintrag pro Zeile macht daraus 74 Zeilen ohne diese
// Aussage.
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
 * nur als lokale `#fragment`-Referenz auf `<use>` erlaubt (der Hook oben -
 * kein `javascript:`, kein Nachladen von einer fremden Adresse über `<use>`
 * oder `<image>`), `<foreignObject>` ist nicht erlaubt (dort lebt sonst
 * beliebiges HTML), und `<style>` ist nicht erlaubt (sonst könnte `url(...)`
 * externe Ressourcen ziehen und damit den Aufruf einer fremden Adresse
 * verraten). Ein MuseScore-Notenbild braucht nichts davon - alle Grafik
 * steckt in `path`/`polyline`/`text` bzw. `defs`/`use`.
 *
 * @param {string} svgText
 * @return {string}
 */
export function sanitizeSvg(svgText) {
	return DOMPurify.sanitize(svgText, {
		// KEIN USE_PROFILES mehr: sind Profile gesetzt, gewinnen deren
		// eingebaute Listen und ALLOWED_TAGS/ALLOWED_ATTR waren wirkungslos
		// (nachgemessen: <use> flog trotz Allowlist raus, href blieb trotz
		// fehlender Freigabe drin - deshalb stand href frueher im
		// FORBID_ATTR). Die expliziten Listen oben sind die Allowlist, wie
		// es der Kommentar ueber ihnen immer behauptet hat.
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		// Nie erlauben, auch wenn eine Allowlist sie sonst durchliesse.
		// href/xlink:href stehen NICHT hier: der Hook oben laesst genau die
		// lokale <use>-Fragmentform durch, alles andere faellt schon durch
		// die fehlende Freigabe in ALLOWED_ATTR.
		FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'style', 'set', 'animate', 'animateTransform', 'animateMotion', 'handler'],
		FORBID_ATTR: ['attributeName', 'to', 'from', 'values', 'begin'],
		// Datenattribute bringen hier keinen Nutzen, koennen aber Payloads tragen.
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: false,
	})
}
