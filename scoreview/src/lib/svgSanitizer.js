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

// In die Partitur eingebettete Bilder: beide Konvertierungswege legen sie als
// Daten-URI in `<image xlink:href>` ab (die scoreview-engine im
// Originalformat, MuseScores Qt-Serializer im Sidecar stets als PNG). Erlaubt
// ist ausschliesslich diese Form - Base64 in einem der vier Bildtypen, die
// ein Browser auch anzeigt. Nicht dabei: `image/svg+xml`, das wieder ein
// Dokument waere statt eines Bildes; und keine externe Adresse, sonst
// verriete eine praeparierte Partitur beim Anzeigen den Aufruf. Leerraum
// steht im Zeichenvorrat, weil ein Serializer den Base64-Block umbrechen
// darf - schmuggeln laesst sich damit nichts, der Ausdruck deckt den GANZEN
// Wert ab.
//
// Was bleibt, ist die Angriffsflaeche des Bilddecoders im Browser - dieselbe,
// die jedes `<img>` in Nextcloud hat.
const IMAGE_DATA_URI = /^data:image\/(?:png|jpeg|gif|bmp);base64,[A-Za-z0-9+/=\s]+$/

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
	if (data.attrName !== 'href' && data.attrName !== 'xlink:href') {
		return
	}
	const tag = node.tagName?.toLowerCase()
	if (tag === 'use' && LOCAL_FRAGMENT.test(data.attrValue)) {
		data.forceKeepAttr = true
	} else if (tag === 'image' && IMAGE_DATA_URI.test(data.attrValue)) {
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
 * Stellt jeder `id` und jeder Referenz darauf `prefix` voran.
 *
 * Warum das noetig ist: `<use xlink:href="#g0">` wird im DOKUMENT aufgeloest,
 * nicht innerhalb des umgebenden `<svg>` - es gewinnt das erste Element mit
 * dieser Kennung, egal auf welcher Seite es steht. Der Viewer haelt aber
 * mehrere Seiten gleichzeitig im DOM (ScorePage.vue laedt 600 px vor dem
 * Sichtbarwerden und gibt erst 2400 px dahinter wieder frei), und die
 * scoreview-engine faengt auf JEDER Seite wieder bei `g0` an. Ohne Praefix
 * zeigen die rund 1200 `<use>` der zweiten Seite deshalb auf die
 * gleichnamigen Glyphen der ersten: statt Noten stehen dort Buchstaben und
 * Ziffern, und das Bild "repariert sich" scheinbar von selbst, sobald die
 * erste Seite entladen ist. Genau dieses Fehlerbild.
 *
 * Umbenannt wird ueber die Attribute statt ueber `setAttribute()`: `xlink:href`
 * liegt in einem eigenen Namensraum, und ein Wert am `Attr`-Knoten trifft ihn
 * ohne Ruecksicht darauf. Neben `<use>` werden auch `url(#…)`-Verweise
 * mitgezogen (Verlaeufe, `clip-path`, `mask`) - die stehen zwar in keinem der
 * heute ausgelieferten SVGs, kollidieren aber genauso, sobald sie auftauchen.
 *
 * Der Sidecar-Weg vergibt ueberhaupt keine Kennungen (nachgesehen: null `id`,
 * null `<use>` je Seite) - dort laeuft die Schleife ins Leere.
 *
 * @param {DocumentFragment} fragment
 * @param {string} prefix
 */
function namespaceIds(fragment, prefix) {
	for (const el of fragment.querySelectorAll('*')) {
		for (const attr of el.attributes) {
			if (attr.name === 'id') {
				attr.value = prefix + attr.value
			} else if ((attr.name === 'href' || attr.name === 'xlink:href') && attr.value.startsWith('#')) {
				attr.value = '#' + prefix + attr.value.slice(1)
			} else if (attr.value.includes('url(#')) {
				attr.value = attr.value.replace(/url\(#([^)]*)\)/g, (_, id) => `url(#${prefix}${id})`)
			}
		}
	}
}

/**
 * Bereinigt SVG-Text für das direkte Einbetten ins DOM.
 *
 * Härter als eine reine Tag-/Attribut-Allowlist: `href`/`xlink:href` sind
 * nur als lokale `#fragment`-Referenz auf `<use>` erlaubt oder als
 * Bild-Daten-URI auf `<image>` (der Hook oben - kein `javascript:`, kein
 * Nachladen von einer fremden Adresse über `<use>` oder `<image>`),
 * `<foreignObject>` ist nicht erlaubt (dort lebt sonst
 * beliebiges HTML), und `<style>` ist nicht erlaubt (sonst könnte `url(...)`
 * externe Ressourcen ziehen und damit den Aufruf einer fremden Adresse
 * verraten). Ein MuseScore-Notenbild braucht nichts davon - alle Grafik
 * steckt in `path`/`polyline`/`text` bzw. `defs`/`use`.
 *
 * @param {string} svgText
 * @param {string} idPrefix Vorangestellt vor jede `id` und jede Referenz
 *   darauf - siehe `namespaceIds()`. Leer laesst die Kennungen unveraendert.
 * @return {string}
 */
export function sanitizeSvg(svgText, idPrefix = '') {
	// RETURN_DOM_FRAGMENT statt der Zeichenkette: `namespaceIds()` braucht das
	// geparste Ergebnis, und ein zweiter Parserlauf ueber ein halbes Megabyte
	// SVG je Seite waere dafuer verschenkt. Serialisiert wird unten von Hand -
	// zeichengleich mit dem, was DOMPurify sonst selbst zurueckgibt.
	const fragment = DOMPurify.sanitize(svgText, {
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
		RETURN_DOM_FRAGMENT: true,
	})
	if (idPrefix) {
		namespaceIds(fragment, idPrefix)
	}
	const container = document.createElement('div')
	container.appendChild(fragment)
	return container.innerHTML
}
