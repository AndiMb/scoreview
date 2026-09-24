// Blaettern in einer Setliste (E11) - rein, ohne DOM und ohne Server.
//
// Ein Eintrag ist spielbar, wenn der Server ihn fuer DIESE Nutzerin
// aufloesen konnte (`status === 'ok'`, siehe SetlistService). Alles andere -
// fehlend, verschoben, ohne Freigabe, kein .mscz - wird beim Weiterblaettern
// uebersprungen, bleibt aber in der Liste stehen und zaehlt mit: „Stueck 3/12"
// meint die dritte Zeile der Datei, nicht das dritte spielbare Stueck. So
// stimmt die Zahl mit dem Blatt ueberein, das die anderen in der Hand haben.

/**
 * @param {{status?: string, fileId?: ?number}} entry
 * @return {boolean}
 */
export function isPlayable(entry) {
	return !!entry && entry.status === 'ok' && entry.fileId !== null && entry.fileId !== undefined
}

/**
 * Der naechste spielbare Eintrag nach `index` in Richtung `step`, oder null.
 * Kein Umlauf am Ende: Nach dem letzten Stueck ist das Konzert aus, und ein
 * Sprung zurueck zum ersten waere am Notenstaender eine boese Ueberraschung.
 *
 * @param {Array<object>} entries
 * @param {number} index aktueller Eintrag; -1 = vor dem ersten
 * @param {1|-1} step
 * @return {?number}
 */
export function stepIndex(entries, index, step) {
	const list = Array.isArray(entries) ? entries : []
	for (let i = index + step; i >= 0 && i < list.length; i += step) {
		if (isPlayable(list[i])) {
			return i
		}
	}
	return null
}

/**
 * @param {Array<object>} entries
 * @param {number} index
 * @return {?number}
 */
export function nextIndex(entries, index) {
	return stepIndex(entries, index, 1)
}

/**
 * @param {Array<object>} entries
 * @param {number} index
 * @return {?number}
 */
export function previousIndex(entries, index) {
	return stepIndex(entries, index, -1)
}

/**
 * Der erste spielbare Eintrag - Weg 1 oeffnet dort.
 *
 * @param {Array<object>} entries
 * @return {?number}
 */
export function firstPlayableIndex(entries) {
	return nextIndex(entries, -1)
}

/**
 * Wo in der Liste die gerade offene Partitur steht (Weg 2). Steht sie
 * mehrfach darin, gewinnt die bevorzugte Stelle, sonst die erste.
 *
 * @param {Array<object>} entries
 * @param {number|string} fileId
 * @param {?number} [preferred] z.B. die vom Server gemeldete Stelle
 * @return {?number}
 */
export function indexOfFile(entries, fileId, preferred = null) {
	const list = Array.isArray(entries) ? entries : []
	const matches = (i) => isPlayable(list[i]) && String(list[i].fileId) === String(fileId)
	if (preferred !== null && preferred >= 0 && preferred < list.length && matches(preferred)) {
		return preferred
	}
	const found = list.findIndex((_, i) => matches(i))
	return found === -1 ? null : found
}

/**
 * Was die Leiste anzeigt: Stelle (1-basiert), Gesamtzahl und ob es in jede
 * Richtung weitergeht.
 *
 * @param {Array<object>} entries
 * @param {?number} index
 * @return {{number: number, total: number, hasNext: boolean, hasPrevious: boolean}}
 */
export function positionOf(entries, index) {
	const list = Array.isArray(entries) ? entries : []
	const at = index === null || index === undefined ? -1 : index
	return {
		number: at + 1,
		total: list.length,
		hasNext: nextIndex(list, at) !== null,
		hasPrevious: at >= 0 && previousIndex(list, at) !== null,
	}
}
