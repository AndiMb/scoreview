// Die Zeilen des Setlisten-Editors (E11) - rein, ohne DOM und ohne Server.
//
// Der Editor schickt dem Server keine Pfade, die er selbst zusammensetzt,
// sondern Verweise: `origin` fuer einen Eintrag, der schon in der Datei
// stand, `fileId` fuer eine neu gewaehlte Partitur. Beides hat einen Grund:
//
// - `origin` laesst den Server den Eintrag Zeichen fuer Zeichen so
//   zurueckschreiben, wie er von Hand geschrieben war - ein roher Pfad bleibt
//   roh, ein eigener Titel bleibt, Unterpunkte wandern mit. Auch ein
//   fehlender Eintrag bleibt so erhalten: Er fehlt ja nur fuer DIESE
//   Nutzerin, fuer andere kann er gelten.
// - `fileId` statt Pfad, weil nur der Server den Pfad RELATIV zur Liste aus
//   Sicht der Nutzerin kennt; der Browser saehe die Partitur womoeglich unter
//   einem anderen Namen (Freigabe in einem Unterordner).

let nextKey = 1

/**
 * Die Zeilen aus einer gelesenen Liste (GET /api/setlists/{id}).
 *
 * @param {?{entries?: Array<object>}} setlist
 * @return {Array<{key: number, label: string, path: string, status: string, origin?: number}>}
 */
export function rowsFromSetlist(setlist) {
	return (setlist?.entries ?? []).map((entry, index) => ({
		key: nextKey++,
		label: entry.label,
		path: entry.path,
		status: entry.status,
		origin: index,
	}))
}

/**
 * Eine Partitur hinzufuegen - aus der Auswahl im Ordner (score-candidates)
 * oder aus Nextclouds Dateiauswahl. Titel ist der Dateiname ohne Endung,
 * wie ihn der Server auch schreibt.
 *
 * @param {Array<object>} rows
 * @param {{fileId: number, name?: string, basename?: string, path?: string}} score
 * @return {Array<object>} neue Zeilen (die alten bleiben unveraendert)
 */
export function addScore(rows, score) {
	const name = score.name ?? score.basename ?? ''
	return [
		...rows,
		{
			key: nextKey++,
			label: name.replace(/\.mscz$/i, ''),
			path: score.path ?? name,
			status: 'ok',
			fileId: Number(score.fileId),
		},
	]
}

/**
 * @param {Array<object>} rows
 * @param {number} from
 * @param {number} to Zielstelle nach dem Herausnehmen
 * @return {Array<object>}
 */
export function moveRow(rows, from, to) {
	if (from === to || from < 0 || from >= rows.length) {
		return rows
	}
	const result = rows.slice()
	const [row] = result.splice(from, 1)
	result.splice(Math.max(0, Math.min(to, result.length)), 0, row)
	return result
}

/**
 * @param {Array<object>} rows
 * @param {number} index
 * @return {Array<object>}
 */
export function removeRow(rows, index) {
	return rows.filter((_, i) => i !== index)
}

/**
 * Die Eintraege fuer PUT/POST (SetlistService::save/create).
 *
 * @param {Array<object>} rows
 * @return {Array<{origin: number}|{fileId: number, label: string}>}
 */
export function payloadFor(rows) {
	return rows.map((row) => (row.origin !== undefined
		? { origin: row.origin }
		: { fileId: row.fileId, label: row.label }))
}
