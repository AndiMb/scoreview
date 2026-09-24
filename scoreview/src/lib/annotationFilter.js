// Wer eine Stimmnotiz (B2) zu sehen bekommt - rein, ohne DOM und ohne Server.
//
// Der Server liefert Stimmnotizen an alle mit Dateizugriff aus
// (AnnotationMapper::findVisibleForUser); welche Stimme jemand singt, ist
// eine Anzeigewahl, keine Berechtigung. Hier faellt die Entscheidung, und
// zwar in drei Stufen statt zwei: Wer noch keine Stimme gewaehlt hat, sieht
// alle Stimmnotizen zurueckgenommen - es geht nichts verloren, und
// die Darstellung laedt ein, eine Stimme zu waehlen.

/** Normal anzeigen. */
export const SHOW = 'show'
/** Zurueckgenommen anzeigen, mit dem Namen der Stimme. */
export const DIM = 'dim'
/** Nicht anzeigen - eine Notiz fuer eine andere Stimme. */
export const HIDE = 'hide'

/**
 * @typedef {{id:string, name:string}} TargetPart gespeichertes Ziel
 * @typedef {{id:(string|number), name:string}} ScorePart aus meta.parts
 */

/**
 * Normalform eines Stimmnamens fuer den Vergleich: Ein Leerzeichen am Ende
 * oder "tenor" statt "Tenor" macht keine andere Stimme.
 *
 * @param {?string} name
 * @return {string}
 */
function nameKey(name) {
	return String(name ?? '').trim().toLocaleLowerCase()
}

/**
 * Die Stimme der Partitur, die ein gespeichertes Ziel meint - oder null.
 *
 * Grundsatz ist "erst die ID, dann der Name": Ob MuseScores
 * Stimmen-ID einen Re-Upload uebersteht, ist nicht belegt, der Name kann
 * sich ebenso aendern ("Tenor" wird "Tenor 1"). Eine Verfeinerung: Traegt die
 * Stimme mit der gespeicherten ID inzwischen einen ANDEREN Namen und gibt es
 * eine Stimme mit genau dem gespeicherten Namen, gilt der Name. Das ist der
 * Fall umsortierter Stimmen - fortlaufend vergebene IDs wandern dann mit dem
 * Platz, nicht mit der Stimme, und die Tenornotiz landete sonst beim Bass.
 *
 * @param {TargetPart} target
 * @param {ScorePart[]} parts
 * @return {?ScorePart}
 */
export function resolveTarget(target, parts) {
	const list = parts ?? []
	const byId = list.find((p) => String(p.id) === String(target?.id)) ?? null
	const wanted = nameKey(target?.name)
	if (byId !== null && (wanted === '' || nameKey(byId.name) === wanted)) {
		return byId
	}
	const byName = wanted === '' ? null : (list.find((p) => nameKey(p.name) === wanted) ?? null)
	return byName ?? byId
}

/**
 * Die Stimmen der Partitur, an die eine Notiz gerichtet ist - ohne die, die
 * es nicht mehr gibt.
 *
 * @param {object} note
 * @param {ScorePart[]} parts
 * @return {ScorePart[]}
 */
export function resolveTargets(note, parts) {
	const found = []
	for (const target of note?.targetParts ?? []) {
		const part = resolveTarget(target, parts)
		if (part !== null && !found.includes(part)) {
			found.push(part)
		}
	}
	return found
}

/**
 * Die Namen der Zielstimmen zum Anzeigen: der aktuelle Name, wo die Stimme
 * gefunden wurde, sonst der gespeicherte.
 *
 * @param {object} note
 * @param {ScorePart[]} parts
 * @return {string[]}
 */
export function targetNames(note, parts) {
	return (note?.targetParts ?? [])
		.map((target) => resolveTarget(target, parts)?.name || target?.name || '')
		.filter((name, i, all) => name !== '' && all.indexOf(name) === i)
}

/**
 * Wie eine Notiz fuer diese Person erscheint.
 *
 * - Keine Stimmnotiz: immer sichtbar - privat und geteilt regelt der Server.
 * - Leitungen sehen alles.
 * - Keine der Zielstimmen gibt es mehr (umbenannt und umsortiert, entfernt):
 *   sichtbar "ohne Stimme". Unsichtbar fuer alle waere ein stiller
 *   Verlust.
 * - Keine eigene Stimme gewaehlt: zurueckgenommen.
 * - Sonst: sichtbar, wenn die eigene Stimme ein Ziel ist, sonst verborgen.
 *   Die eigene Stimme wird dabei wie ein Ziel ueber ID und Name gesucht -
 *   gemerkt ist sie als ID (useMyPart), und die zeigt nach einem Re-Upload
 *   im Zweifel auf dieselbe Stimme wie die Ziele.
 *
 * @param {object} note Notiz aus der API (visibility, targetParts)
 * @param {?(string|number)} myPartId "Meine Stimme", null = keine
 * @param {ScorePart[]} parts meta.parts
 * @param {boolean} [isLeader]
 * @return {'show'|'dim'|'hide'}
 */
export function classify(note, myPartId, parts, isLeader = false) {
	if (note?.visibility !== 'parts' || isLeader) {
		return SHOW
	}
	const targets = resolveTargets(note, parts)
	if (targets.length === 0) {
		return SHOW
	}
	if (myPartId === null || myPartId === undefined) {
		return DIM
	}
	const mine = (parts ?? []).find((p) => String(p.id) === String(myPartId)) ?? null
	if (mine === null) {
		// Die gemerkte Stimme gibt es nicht mehr - das ist "keine Stimme".
		return DIM
	}
	return targets.includes(mine) ? SHOW : HIDE
}

/**
 * Ob eine Notiz ihre Ziele noch findet - fuer den Hinweis "ohne Stimme".
 *
 * @param {object} note
 * @param {ScorePart[]} parts
 * @return {boolean}
 */
export function isWithoutVoice(note, parts) {
	return note?.visibility === 'parts' && resolveTargets(note, parts).length === 0
}
