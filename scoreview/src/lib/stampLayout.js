// Wo ein Stempel (B3) im Notenbild steht - rein, ohne DOM.
//
// Alle Werte sind SVG-Einheiten der Seite, derselbe Raum wie
// timing.json/measures.json (M4). Die Ebene, die sie zeichnet
// (ScoreStamps.vue), traegt die viewBox der Seite; damit skalieren die
// Stempel mit dem Zoom wie die Noten selbst, ohne dass hier ein
// Zoomfaktor vorkaeme.

import { findElementAtPoint } from './scoreLayout.js'

/**
 * Die Stempel, die es gibt - gespiegelt aus Annotation::STAMPS. Durchgesetzt
 * wird die Liste serverseitig; hier bestimmt sie die Palette und ihre
 * Reihenfolge (Atmen und Einsatz zuerst: die haeufigsten Bleistiftzeichen
 * einer Chorprobe).
 */
export const STAMP_CODES = Object.freeze([
	'breath',
	'caesura',
	'pp',
	'p',
	'mp',
	'mf',
	'f',
	'ff',
	'cresc',
	'dim',
	'cue',
	'attention',
	'fermata',
	'rit',
	'a_tempo',
])

/**
 * Wie weit ein Tipp neben dem Takt noch diesen Takt meint (SVG-Einheiten).
 * Zwischen zwei Systemen liegt Liedtext und Dynamik; ein Tipp dorthin ist
 * noch gemeint, einer an den Seitenrand nicht.
 */
const MAX_TAP_DISTANCE = 250

/** Abstand ueber der Notenzeile, in Linienabstaenden. */
const GAP_SPACES = 0.6

/** Hoehe eines Symbols in Linienabstaenden - fuers Stapeln. */
const SYMBOL_SPACES = 2.6

/**
 * Linienabstand, wenn keine Notenzeile erkannt wurde: MuseScores Vorgabe
 * von 1,75 mm in SVG-Einheiten (MuseScore schreibt mit 1200 DPI - eine
 * A4-Seite ist 9921 Einheiten breit). Die Takthoehe allein taugt nicht: Sie
 * umfasst das ganze System, bei fuenf Stimmen waere ein Stempel fuenfmal zu
 * gross.
 */
const DEFAULT_SPACE = (1.75 / 25.4) * 1200

/**
 * Der Anker eines Stempels aus einem Tipp ins Notenbild: Takt und
 * waagerechter Anteil im Takt.
 *
 * Bewusst OHNE Noten-elid: Ein Atemzeichen gehoert ZWISCHEN zwei Noten. Mit
 * elid sprang es beim Zeichnen auf die Note (das elid-Rechteck gewinnt,
 * solange der etag passt) und nach einem Re-Upload wieder zurueck an die
 * getippte Stelle - zwei Lagen fuer dieselbe Stelle. Takt + Anteil ist bei
 * unveraenderter Darstellung genau der Tipp und danach dieselbe Stelle im
 * Takt (B3-Abnahme).
 *
 * @param {object} measureElements measures.json `elements`
 * @param {number} page 0-indiziert
 * @param {number} x SVG-Einheiten
 * @param {number} y SVG-Einheiten
 * @return {?{measureNumber:number, fraction:number}}
 */
export function anchorFromTap(measureElements, page, x, y) {
	const elid = findElementAtPoint(measureElements ?? {}, page, x, y, MAX_TAP_DISTANCE)
	if (elid === null) {
		return null
	}
	const rect = measureElements[String(elid)]
	const fraction = rect.w > 0 ? Math.min(1, Math.max(0, (x - rect.x) / rect.w)) : 0
	return { measureNumber: elid + 1, fraction }
}

/**
 * Das System, in dem ein Takt steht: Taktrechtecke umfassen das ganze
 * System (staffBands.js).
 *
 * @param {Array<{top:number,bottom:number,staves:Array}>} systems
 * @param {{y:number,h:number}} rect
 * @return {?object}
 */
function systemOf(systems, rect) {
	// Dieselbe Ueberlappungsregel wie beim Cursor (ScorePage cursorBands).
	return (systems ?? []).find((s) => rect.y < s.bottom + 1 && rect.y + rect.h > s.top - 1) ?? null
}

/**
 * Die Lage aller Stempel einer Seite.
 *
 * - **x:** das Rechteck der Note (`elementRect`), wenn der Stempel eine elid
 *   traegt und ihr etag noch passt - das hat der Aufrufer entschieden und
 *   nur dann mitgegeben. Sonst Taktanfang + `fraction` × Taktbreite.
 * - **y:** Bei einer Stimmnotiz, deren Zeilen sich Stimmen zuordnen lassen
 *   (`mappable`, staffBands.canMapStavesToParts), ueber der Zeile jeder
 *   Zielstimme - ein Stempel fuer Tenor und Bass steht zweimal. Sonst ueber
 *   dem System.
 * - **space:** der Linienabstand dort, als Groesse des Symbols. Ohne
 *   erkannte Notenzeilen MuseScores Vorgabe (DEFAULT_SPACE).
 *
 * Stempel an derselben Stelle werden nach oben gestapelt statt
 * uebereinandergedruckt - Atemzeichen und "p" am selben Takt sind in einer
 * Probe der Normalfall.
 *
 * @param {Array<{id:number, stamp:string, fraction:number, measureRect:object, elementRect:?object, targetIndices:number[]}>} stamps
 * @param {Array} systems staffBands.groupBandsIntoSystems fuer diese Seite
 * @param {boolean} mappable ob Zeilen Stimmen zugeordnet werden duerfen
 * @return {Array<{id:number, stamp:string, x:number, y:number, space:number}>}
 */
export function layoutStamps(stamps, systems, mappable) {
	const placed = []
	for (const stamp of stamps ?? []) {
		const measure = stamp.measureRect
		if (!measure) {
			continue
		}
		const fraction = Number.isFinite(stamp.fraction) ? Math.min(1, Math.max(0, stamp.fraction)) : 0
		const x = stamp.elementRect ? stamp.elementRect.x : measure.x + fraction * measure.w
		const system = systemOf(systems, measure)
		const staves = system?.staves ?? []
		const space = staves.length > 0
			? (staves[0].bottom - staves[0].top) / 4
			: Math.min(measure.h / 4, DEFAULT_SPACE)

		const targets = mappable && system
			? (stamp.targetIndices ?? []).map((i) => staves[i]).filter(Boolean)
			: []
		const tops = targets.length > 0
			? targets.map((band) => band.top)
			: [system ? system.top : measure.y]

		for (const top of tops) {
			let y = top - GAP_SPACES * space
			// Stapeln: belegt ist, was waagerecht naeher als zwei
			// Linienabstaende und in derselben Hoehe liegt.
			while (placed.some((p) => Math.abs(p.x - x) < 2 * space && Math.abs(p.y - y) < SYMBOL_SPACES * space * 0.9)) {
				y -= SYMBOL_SPACES * space
			}
			// Die Eingaberechtecke bleiben draussen - gezeichnet wird nur die Lage.
			placed.push({ id: stamp.id, stamp: stamp.stamp, dimmed: stamp.dimmed, voices: stamp.voices, content: stamp.content, x, y, space })
		}
	}
	return placed
}
