// Leitet aus dem MuseScore-SVG ab, wo die Notenzeilen liegen - reine,
// DOM-freie Geometrie, damit sie ohne Browser testbar bleibt.
//
// Warum das nötig ist: Das exportierte SVG hat keine Struktur, an der sich
// eine Stimme festmachen ließe - keine Gruppen, keine ids, an den Noten nicht
// einmal eine Klasse (nachgemessen: auf einer Notenseite tragen nur
// `Text`-Elemente eine). Die EINZIGE verwertbare Auszeichnung sind die
// Notenlinien selbst:
//
//     <polyline class="StaffLines" points="1489.73,2148.84 9491.34,2148.84" />
//
// Aus ihnen lassen sich System- und Zeilengrenzen zurückrechnen, und damit
// alles, was „meine Stimme" heißt: sie hervorheben, die anderen zurücknehmen,
// und den Wiedergabecursor auf die Zeilen aufteilen, statt einen Balken über
// das ganze System zu ziehen.

/**
 * @typedef {{top:number,bottom:number,left:number,right:number}} Band
 * @typedef {{top:number,bottom:number,left:number,right:number,staves:Band[]}} System
 */

/**
 * Verhältnis von Lücke zu Linienabstand, ab dem eine neue Notenzeile beginnt.
 *
 * Innerhalb einer Zeile sind die fünf Linien gleich weit auseinander; der
 * Abstand zur nächsten Zeile ist ein Vielfaches davon (gemessen an SATB-Sätzen
 * und Klavierauszügen: Faktor 2,5 bis 10). 1,8 trennt beides sicher und
 * verträgt zugleich die kleinen Rundungsunterschiede innerhalb einer Zeile.
 */
const NEUE_ZEILE_AB = 1.8

/** Toleranz, ab der zwei Linien als „gleich lang" gelten (SVG-Einheiten). */
const GLEICHE_BREITE = 1

/**
 * Zieht die Notenlinien aus dem SVG-Text.
 *
 * Bewusst über einen Ausdruck statt über DOMParser: Die Funktion läuft auch
 * dort, wo es kein DOM gibt (Tests, künftig serverseitig), und sie liest nur
 * die Punkte einer Polyline - dafür einen vollständigen SVG-Parse zu bezahlen,
 * wäre pro Seite unnötig.
 *
 * @param {string} svgText
 * @return {Array<{y:number,left:number,right:number}>}
 */
export function extractStaffLines(svgText) {
	const linien = []
	const muster = /<polyline\b[^>]*\bclass="StaffLines"[^>]*\bpoints="([^"]+)"/g
	let treffer
	while ((treffer = muster.exec(svgText)) !== null) {
		const punkte = treffer[1].trim().split(/\s+/)
		if (punkte.length < 2) {
			continue
		}
		const [x1, y1] = punkte[0].split(',').map(Number)
		const [x2] = punkte[punkte.length - 1].split(',').map(Number)
		if (![x1, y1, x2].every(Number.isFinite)) {
			continue
		}
		linien.push({ y: y1, left: Math.min(x1, x2), right: Math.max(x1, x2) })
	}
	return linien
}

/**
 * Die Notenzeilen einer Seite, von oben nach unten.
 *
 * Der Rückgabewert steht in SVG-Einheiten der Seite, also in demselben Raum
 * wie `timing.json`/`measures.json` (siehe docs/architecture.md M4).
 *
 * @param {string} svgText
 * @return {Band[]}
 */
export function findStaffBands(svgText) {
	const linien = extractStaffLines(svgText)
	if (linien.length === 0) {
		return []
	}

	// Erst nach waagerechter Ausdehnung bündeln: Das erste System einer
	// Partitur ist wegen der Stimmennamen eingerückt, seine Linien sind also
	// kürzer als die der folgenden. Ohne diese Trennung würde der
	// Linienabstand über verschieden breite Systeme hinweg gemittelt.
	const nachBreite = new Map()
	for (const linie of linien) {
		const schluessel = `${Math.round(linie.left / GLEICHE_BREITE)}:${Math.round(linie.right / GLEICHE_BREITE)}`
		if (!nachBreite.has(schluessel)) {
			nachBreite.set(schluessel, [])
		}
		nachBreite.get(schluessel).push(linie)
	}

	const zeilen = []
	for (const gruppe of nachBreite.values()) {
		gruppe.sort((a, b) => a.y - b.y)
		zeilen.push(...gruppeInZeilen(gruppe))
	}
	return zeilen.sort((a, b) => a.top - b.top)
}

/**
 * Ordnet die Notenzeilen einer Seite ihren Systemen zu.
 *
 * **Die Systemgrenzen kommen aus `measures.json`, nicht aus der Geometrie der
 * Notenlinien** - und das ist der Kern dieser Funktion. Ein Taktrechteck von
 * MuseScore umfasst immer das ganze System; damit steht die Aufteilung fest,
 * statt geraten zu werden. Der naheliegende Weg über die Lücken zwischen den
 * Zeilen trägt nämlich nicht: In einem Chorsatz mit Liedtext zwischen den
 * Zeilen ist der Abstand ZWISCHEN zwei Systemen nur rund 1,4-mal so groß wie
 * der innerhalb eines Systems (nachgemessen) - keine Schwelle trennt das
 * zuverlässig, und eine falsche Trennung verschöbe die Stimmenzuordnung.
 *
 * @param {Band[]} bands aus findStaffBands()
 * @param {Array<{y:number,h:number}>} systemRects Taktrechtecke dieser Seite
 * @return {System[]}
 */
export function groupBandsIntoSystems(bands, systemRects) {
	const grenzen = distinctSystemRanges(systemRects)
	if (grenzen.length === 0 || bands.length === 0) {
		return []
	}
	return grenzen
		.map((grenze) => {
			// Mittig zugeordnet statt über Überlappung: Eine Zeile gehört zu
			// dem System, in dessen Höhenband ihre Mitte liegt. Die
			// Taktrechtecke schließen nahtlos aneinander an, eine Zeile kann
			// also nie zu zweien gehören.
			const staves = bands.filter((band) => {
				const mitte = (band.top + band.bottom) / 2
				return mitte >= grenze.top && mitte <= grenze.bottom
			})
			return staves.length > 0 ? systemAus(staves) : null
		})
		.filter((system) => system !== null)
}

/**
 * Die verschiedenen Höhenbänder der Taktrechtecke einer Seite - je eines pro
 * System. Alle Takte eines Systems teilen sich Oberkante und Höhe.
 *
 * @param {Array<{y:number,h:number}>} systemRects
 * @return {Array<{top:number,bottom:number}>}
 */
function distinctSystemRanges(systemRects) {
	const gesehen = new Map()
	for (const rect of systemRects ?? []) {
		if (!Number.isFinite(rect?.y) || !Number.isFinite(rect?.h)) {
			continue
		}
		const schluessel = `${Math.round(rect.y)}:${Math.round(rect.h)}`
		if (!gesehen.has(schluessel)) {
			gesehen.set(schluessel, { top: rect.y, bottom: rect.y + rect.h })
		}
	}
	return [...gesehen.values()].sort((a, b) => a.top - b.top)
}

/**
 * Teilt die nach Höhe sortierten Linien einer Breitengruppe in Notenzeilen.
 *
 * @param {Array<{y:number,left:number,right:number}>} linien
 * @return {Band[]}
 */
function gruppeInZeilen(linien) {
	const abstaende = []
	for (let i = 1; i < linien.length; i++) {
		abstaende.push(linien[i].y - linien[i - 1].y)
	}
	if (abstaende.length === 0) {
		return []
	}
	// Der Median der Abstände IST der Linienabstand: Innerhalb einer Zeile
	// liegen vier von fünf Abständen, zwischen den Zeilen nur einer. Ein
	// Mittelwert würde von den großen Lücken verzogen, der Median nicht.
	const linienabstand = median(abstaende)
	if (!(linienabstand > 0)) {
		return []
	}

	const zeilen = []
	let aktuell = [linien[0]]
	for (let i = 1; i < linien.length; i++) {
		if (linien[i].y - linien[i - 1].y > linienabstand * NEUE_ZEILE_AB) {
			zeilen.push(aktuell)
			aktuell = []
		}
		aktuell.push(linien[i])
	}
	zeilen.push(aktuell)

	return zeilen
		// Eine einzelne Linie ist keine Notenzeile, sondern Beiwerk (etwa eine
		// Trennlinie). Einzeilige Schlagzeugsysteme haben eine echte
		// StaffLines-Polyline und blieben damit außen vor - das ist der
		// bewusste Preis dafür, Zufallsfunde nicht als Stimme auszugeben.
		.filter((zeile) => zeile.length >= 2)
		.map((zeile) => ({
			top: zeile[0].y,
			bottom: zeile[zeile.length - 1].y,
			left: zeile[0].left,
			right: zeile[0].right,
		}))
}

/**
 * @param {Band[]} staves
 * @return {System}
 */
function systemAus(staves) {
	return {
		top: staves[0].top,
		bottom: staves[staves.length - 1].bottom,
		left: Math.min(...staves.map((s) => s.left)),
		right: Math.max(...staves.map((s) => s.right)),
		staves,
	}
}

/** @param {number[]} werte */
function median(werte) {
	const sortiert = [...werte].sort((a, b) => a - b)
	const mitte = Math.floor(sortiert.length / 2)
	return sortiert.length % 2 === 0
		? (sortiert[mitte - 1] + sortiert[mitte]) / 2
		: sortiert[mitte]
}

/**
 * Ordnet den Notenzeilen einer Seite eine Stimme zu.
 *
 * Die Zuordnung ist eine Annahme mit Absicherung: Innerhalb eines Systems
 * stehen die Zeilen in derselben Reihenfolge wie `metadata.parts`, sofern
 * jede Stimme GENAU EINE Zeile hat. Bei einem Klavierauszug (zwei Zeilen je
 * Stimme) oder einer Partitur mit versteckten Zeilen stimmt das nicht mehr -
 * und eine falsche Zuordnung wäre schlimmer als keine: Sie markierte
 * jemandem die Zeile der Nachbarstimme.
 *
 * Deshalb wird die Zahl der Zeilen je System mit der Zahl der Stimmen
 * verglichen und im Zweifel `null` geliefert. Die Oberfläche blendet die
 * Funktion dann aus, statt etwas Falsches anzubieten.
 *
 * @param {System[]} systems
 * @param {number} partCount Anzahl der Stimmen aus meta.json
 * @return {boolean} ob eine Zuordnung Zeile->Stimme zulässig ist
 */
export function canMapStavesToParts(systems, partCount) {
	if (systems.length === 0 || partCount < 1) {
		return false
	}
	return systems.every((system) => system.staves.length === partCount)
}

/**
 * Die Notenzeilen einer Stimme auf dieser Seite - je System eine.
 *
 * @param {System[]} systems
 * @param {number} partIndex 0-indiziert, in der Reihenfolge von meta.json
 * @return {Band[]}
 */
export function stavesOfPart(systems, partIndex) {
	return systems
		.map((system) => system.staves[partIndex])
		.filter((band) => band !== undefined)
}
