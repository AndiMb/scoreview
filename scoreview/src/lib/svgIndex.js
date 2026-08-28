// Vom Zeitpunkt zum Notenkopf: die Karte, die timing.json mit dem Notenbild
// verbindet.
//
// Bis MuseScore die Kennungen mitschrieb, stand im SVG nur `class="Note"` -
// eine Kategorie, kein Bezug zu einer einzelnen Note
// ([M9](../../../docs/architecture.md)). Der Cursor konnte deshalb nur ein Band
// ueber die Seite legen. Traegt das SVG dagegen `seg-N` (M10), ist N genau die
// `elid` aus timing.json, und der klingende Notenkopf laesst sich selbst
// einfaerben.
//
// Gebaut wird die Karte **einmal je geladener Seite**, nicht je
// Wiedergabeschritt: Eine Seite hat 640-1370 Knoten, und bei acht Ereignissen
// je Sekunde waere ein querySelectorAll je Schritt die teuerste Schleife im
// Viewer. Danach kostet ein Schritt nur noch das Umhaengen einer Klasse an
// einer Handvoll Knoten.
//
// Ohne Kennungen bleibt die Karte leer - der Aufrufer erkennt daran, dass die
// Partitur von einer aelteren Konvertierung oder aus Stock-MuseScore stammt
// (der Sidecar-Weg), und bleibt beim Band.

/** Praefix der Segmentkennung im class-Attribut (M10). */
const SEGMENT_PREFIX = 'seg-'

/**
 * Was zum Klang eines Segments gehoert und deshalb mitgefaerbt wird.
 *
 * An zwei ausgelieferten Seiten abgezaehlt (Chorsatz mit Liedtext, plus die
 * Testpartitur): Note, Stem, Lyrics, BarLine, StaffLines, LyricsLineSegment,
 * Rest, Beam, TieSegment, Accidental, InstrumentName, Clef, LedgerLine, Hook,
 * Bracket, NoteDot, VoltaSegment, MeasureNumber, Text.
 *
 * Bewusst NICHT dabei: `Lyrics` (der Text soll lesbar bleiben, nicht
 * mitleuchten), `TieSegment` (ein Bogen gehoert zwei Segmenten an und wuerde
 * zu frueh oder zu spaet aufleuchten) und alles Ortsfeste wie Notenlinien,
 * Taktstriche und Schluessel.
 */
export const SOUNDING_CLASSES = [
	'Note',
	'Stem',
	'Beam',
	'Hook',
	'Rest',
	'Accidental',
	'NoteDot',
	'LedgerLine',
]

/**
 * Karte `elid` -> gezeichnete Knoten dieses Segments.
 *
 * @param {Element|null} root Wurzel des eingebetteten SVG.
 * @param {string[]} classes Welche Elementarten mitgefaerbt werden.
 * @return {Map<number, Element[]>} leer, wenn das SVG keine Kennungen traegt.
 */
export function buildSegmentIndex(root, classes = SOUNDING_CLASSES) {
	const index = new Map()
	if (!root || typeof root.querySelectorAll !== 'function') {
		return index
	}

	const gesucht = new Set(classes)

	for (const node of root.querySelectorAll('[class]')) {
		// `getAttribute` statt `classList`/`className`: bei SVG-Elementen ist
		// `className` ein SVGAnimatedString und kein String - eine Falle, die
		// stillschweigend zu "keine Treffer" fuehrt.
		const tokens = (node.getAttribute('class') || '').split(/\s+/)

		let elid = null
		let klingt = false
		for (const token of tokens) {
			if (token.startsWith(SEGMENT_PREFIX)) {
				const zahl = Number(token.slice(SEGMENT_PREFIX.length))
				if (Number.isInteger(zahl) && zahl >= 0) {
					elid = zahl
				}
			} else if (gesucht.has(token)) {
				klingt = true
			}
		}

		if (elid === null || !klingt) {
			continue
		}

		const bisher = index.get(elid)
		if (bisher) {
			bisher.push(node)
		} else {
			index.set(elid, [node])
		}
	}

	return index
}

/**
 * Setzt die Hervorhebung auf ein anderes Segment um.
 *
 * Nimmt bewusst die zuletzt gefaerbten Knoten entgegen, statt sie im Dokument
 * zu suchen: Das ist der Unterschied zwischen einem Abraeumen in O(1) und
 * einem weiteren Dokumentdurchlauf je Wiedergabeschritt.
 *
 * @param {Map<number, Element[]>} index aus buildSegmentIndex()
 * @param {number|null} elid das jetzt klingende Segment
 * @param {Element[]} previous die zuletzt hervorgehobenen Knoten
 * @param {string} className
 * @return {Element[]} die jetzt hervorgehobenen Knoten
 */
export function setHighlight(index, elid, previous, className) {
	for (const node of previous) {
		node.classList?.remove(className)
	}

	const treffer = (elid === null || elid === undefined) ? [] : (index.get(elid) ?? [])
	for (const node of treffer) {
		node.classList?.add(className)
	}

	return treffer
}
