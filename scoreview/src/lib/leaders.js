// Die Leitungsliste einer Partitur (B1), wie sie vom Server kommt
// (Controller\LeaderController), in eine feste Form gebracht - und die Regel,
// ab wann eine Namenssuche ueberhaupt losgeht. Ohne DOM und ohne Netz, damit
// beides testbar ist.

/** Kuerzester Suchbegriff - dieselbe Grenze wie LeaderService::MIN_QUERY_LENGTH. */
export const MIN_QUERY_LENGTH = 2

/**
 * Die Antwort von GET/POST/DELETE auf `/leaders` in fester Form.
 *
 * Nicht-Leitungen bekommen keine Kennungen (E9); `userId` ist dann null,
 * und `canRevoke` ist falsch, egal was ankommt - die Oberflaeche soll einen
 * Abberufen-Knopf nie aus einem einzelnen Feld ableiten, das nicht zum Rest
 * passt. Der Server prueft ohnehin selbst (403).
 *
 * @param {?object} data Antwort des Servers
 * @return {{isLeader: boolean, leaders: Array<{displayName: string, isOwner: boolean, me: boolean, userId: ?string, canRevoke: boolean}>}}
 */
export function normalizeLeaders(data) {
	const isLeader = data?.isLeader === true
	const leaders = (Array.isArray(data?.leaders) ? data.leaders : []).map((l) => {
		const userId = isLeader && typeof l?.userId === 'string' ? l.userId : null
		return {
			displayName: String(l?.displayName ?? ''),
			isOwner: l?.isOwner === true,
			me: l?.me === true,
			userId,
			canRevoke: userId !== null && l?.canRevoke === true && l?.isOwner !== true,
		}
	})
	return { isLeader, leaders }
}

/**
 * Der Suchbegriff, mit dem gesucht wird - oder null, solange er zu kurz ist.
 * Die Oberflaeche fragt vorher, statt den Server fuer jeden ersten
 * Buchstaben mit einer Anfrage zu behelligen, die er leer beantworten wuerde.
 *
 * @param {?string} query Eingabe
 * @return {?string}
 */
export function candidateQuery(query) {
	const q = String(query ?? '').trim()
	return q.length >= MIN_QUERY_LENGTH ? q : null
}
