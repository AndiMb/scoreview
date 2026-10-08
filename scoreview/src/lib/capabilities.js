// Was die Artefakte einer Partitur hergeben - und damit, welche
// Darstellungen der Viewer anbieten kann (E15). Entschieden wird am INHALT,
// nie am Konvertierungsweg: Liedtext-Ansicht und Tonnamen brauchen Daten,
// die heute nur die Engine des lokalen Wegs schreibt (`lyricSyllables`,
// `noteSpellings`, Kennungen nach M10). Kaeme ein dritter Weg mit denselben
// Daten dazu, wuerde er ohne eine Zeile hier mitgenutzt.

/**
 * @typedef {object} Capabilities
 * @property {boolean} segIds das SVG traegt `seg-N st-N vc-N` (M10)
 * @property {boolean} lyrics Silbenliste mit mindestens einer Silbe
 * @property {boolean} spellings Tonhoehe und Schreibweise je Notenkopf
 * @property {boolean} keyModes mindestens eine Tonart mit Modus (Dur/Moll)
 */

/**
 * @param {{meta?: ?object, svgHasSegIds?: boolean}} input
 * @return {Capabilities}
 */
export function capabilitiesOf({ meta, svgHasSegIds } = {}) {
	const m = meta ?? {}
	return {
		segIds: svgHasSegIds === true,
		lyrics: Array.isArray(m.lyricSyllables) && m.lyricSyllables.length > 0,
		spellings: Array.isArray(m.noteSpellings) && m.noteSpellings.length > 0,
		keyModes: Array.isArray(m.keySigs) && m.keySigs.some((k) => typeof k?.mode === 'string' && k.mode !== ''),
	}
}

/**
 * Was jede Darstellung braucht. Das Systemband schneidet nur Systeme aus dem
 * Seitenbild aus und kommt deshalb mit jedem SVG aus.
 */
const NEEDS = Object.freeze({
	lyrics: ['lyrics', 'segIds'],
	noteNames: ['spellings', 'segIds'],
	band: [],
	pages: [],
})

/**
 * Warum eine Darstellung nicht geht - oder null, wenn sie geht.
 *
 * - `no-lyrics`: Die Partitur hat keinen Liedtext. Das sagt `hasLyrics`, das
 *   beide Wege schreiben (M2); ohne dieses Feld gilt die fehlende Silbenliste
 *   allein nicht als Beleg, dass es keinen Text gibt.
 * - `too-large`: Liedtext da, Liste fehlt - die Engine laesst sie ueber ihrer
 *   Obergrenze weg (Entwurf §2.1). Erkennbar daran, dass die Seiten sonst
 *   alle Kennungen tragen.
 * - `no-data`: Die Seiten wurden ohne die noetigen Daten gesetzt.
 *
 * @param {Capabilities} cap
 * @param {'lyrics'|'noteNames'|'band'|'pages'} feature
 * @param {?object} meta
 * @return {null|'no-lyrics'|'too-large'|'no-data'}
 */
export function unavailableReason(cap, feature, meta) {
	const needs = NEEDS[feature]
	if (needs === undefined) {
		return 'no-data'
	}
	if (needs.every((key) => cap[key] === true)) {
		return null
	}
	if (feature === 'lyrics' && !hasLyrics(meta)) {
		return 'no-lyrics'
	}
	if (feature === 'lyrics' && cap.segIds && cap.spellings && !cap.lyrics) {
		return 'too-large'
	}
	return 'no-data'
}

/**
 * MuseScore schreibt `hasLyrics` als Zeichenkette ("true"/"false"), die
 * Engine wie Stock-MuseScore (M2) - beides wird hier angenommen.
 *
 * @param {?object} meta
 * @return {boolean}
 */
function hasLyrics(meta) {
	const v = meta?.hasLyrics
	return v === true || v === 'true'
}
