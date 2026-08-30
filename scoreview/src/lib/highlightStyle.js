// Wie die klingende Stelle im Notenbild aussieht - Farbe und Form, aus einer
// Nutzereinstellung in CSS uebersetzt.
//
// Zwei Formen, weil zwei Sehgewohnheiten aufeinandertreffen: Die einen
// suchen den Notenkopf, der gerade klingt; die anderen wollen nur wissen, wo
// im Takt sie stehen, und lesen die Noten selbst. Beides gleichzeitig
// markierte dieselbe Stelle doppelt, deshalb ein Umschalter und kein
// Nebeneinander (siehe ScorePage.vue).
//
// Reine Umformung, ohne DOM und ohne Vue - deshalb hier und nicht in der
// Komponente. Was hier herausgeht, landet unveraendert in einem
// `style`-Attribut; die Farbe wird darum auch im Browser noch einmal
// geprueft, obwohl der Server das schon tut (Service\ViewerPreferences).

/** Die klingenden Notenkoepfe selbst einfaerben (M10). */
export const HIGHLIGHT_MODE_NOTES = 'notes'
/** Ein Band an der klingenden Stelle, je Notenzeile. */
export const HIGHLIGHT_MODE_BAR = 'bar'

export const DEFAULT_HIGHLIGHT_MODE = HIGHLIGHT_MODE_NOTES

/**
 * Kraeftiges Rot statt des frueheren Nextcloud-Blaus: Blau auf schwarzen
 * Notenkoepfen ist zwar da, faellt aus Notenstaender-Entfernung aber kaum
 * auf (Nutzerrueckmeldung). Muss mit `ViewerPreferences::DEFAULT_COLOR`
 * uebereinstimmen - der Server liefert die Vorgabe, dieser Wert traegt nur,
 * solange kein Anfangszustand da ist.
 */
export const DEFAULT_HIGHLIGHT_COLOR = '#d32f2f'

/**
 * Vorschlaege statt einer freien Farbe allein: Eine Farbe, die auf weissem
 * Papier neben schwarzer Druckfarbe wirklich traegt, ist im Farbwaehler
 * nicht in zwei Klicks gefunden. Die freie Wahl bleibt daneben bestehen.
 *
 * `id` statt eines Namens im Modul: Uebersetzt wird in der Komponente (E4),
 * hier stehen nur die Werte.
 */
export const HIGHLIGHT_PRESETS = [
	{ id: 'red', color: '#d32f2f' },
	{ id: 'orange', color: '#ef6c00' },
	{ id: 'magenta', color: '#c2185b' },
	{ id: 'violet', color: '#7b1fa2' },
	{ id: 'green', color: '#2e7d32' },
	{ id: 'blue', color: '#0082c9' },
]

/**
 * Deckkraft des Bandes. Es liegt HINTER dem Notenbild (siehe ScorePage.vue)
 * und darf deshalb kraeftig sein, ohne etwas zu verdecken - die frueheren
 * 0,22 waren auf einem hellen Tabletbildschirm kaum noch zu sehen.
 */
const BAND_ALPHA = 0.32

const VOLLFORM = /^#[0-9a-f]{6}$/
const KURZFORM = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/

/**
 * Genau `#rrggbb`, sonst die Vorgabe - dieselbe Regel wie serverseitig.
 *
 * @param {string|undefined|null} value
 * @return {string}
 */
export function normalizeHighlightColor(value) {
	const wert = String(value ?? '').trim().toLowerCase()
	if (VOLLFORM.test(wert)) {
		return wert
	}
	const kurz = KURZFORM.exec(wert)
	if (kurz) {
		return `#${kurz[1]}${kurz[1]}${kurz[2]}${kurz[2]}${kurz[3]}${kurz[3]}`
	}
	return DEFAULT_HIGHLIGHT_COLOR
}

/**
 * Alles ausser `bar` bedeutet `notes` - nie ein dritter, nirgends
 * behandelter Zustand.
 *
 * @param {string|undefined|null} value
 * @return {string}
 */
export function normalizeHighlightMode(value) {
	return String(value ?? '').trim() === HIGHLIGHT_MODE_BAR ? HIGHLIGHT_MODE_BAR : DEFAULT_HIGHLIGHT_MODE
}

/**
 * Die beiden CSS-Variablen, die das Notenbild einfaerben.
 *
 * Eine Nutzerwahl, zwei Werte: Die Notenkoepfe bekommen die Farbe voll (sie
 * ersetzt die schwarze Druckfarbe), das Band eine durchscheinende Fassung
 * (es liegt unter den Noten und soll sie nicht ueberfaerben). Ausgerechnet
 * statt per `color-mix()` zusammengesetzt, damit der Wert hier pruefbar ist
 * und nicht erst im Browser entsteht.
 *
 * @param {string} color eine Farbe, wie normalizeHighlightColor() sie liefert
 * @return {{'--scoreview-highlight': string, '--scoreview-highlight-band': string}}
 */
export function highlightCssVars(color) {
	const farbe = normalizeHighlightColor(color)
	const r = parseInt(farbe.slice(1, 3), 16)
	const g = parseInt(farbe.slice(3, 5), 16)
	const b = parseInt(farbe.slice(5, 7), 16)
	return {
		'--scoreview-highlight': farbe,
		'--scoreview-highlight-band': `rgba(${r}, ${g}, ${b}, ${BAND_ALPHA})`,
	}
}
