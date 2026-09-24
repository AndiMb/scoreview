// Wann ScoreView eine Datei selbst oeffnen muss - reine Pruefung, ohne DOM
// und ohne Nextcloud-Objekte.
//
// Der regulaere Einstieg ist Nextclouds Viewer, und der haengt am Mimetype
// MSCZ_MIME. Den traegt die App zwar selbst ein
// (lib/Service/MimetypeRegistration.php), aber nicht lueckenlos: Die Erkennung
// beim Upload bleibt Nextclouds Sache, eine frisch hochgeladene Partitur steht
// deshalb bis zum naechsten Cron-Lauf auf `application/octet-stream` - und auf
// einer Instanz, wo die Registrierung scheiterte oder das Update der App noch
// nicht lief, dauerhaft.
//
// Genau dann - Endung stimmt, Mimetype nicht - macht der Viewer die Datei
// nicht auf, und nur dann springt die eigene Dateiaktion ein. Wo die
// Registrierung sitzt, aendert sich nichts: kein zweiter Menueeintrag, keine
// zwei Standardaktionen.

export const MSCZ_MIME = 'application/x-musescore'
export const MSCZ_EXTENSION = '.mscz'

/**
 * @param {object} node Ein Knoten aus @nextcloud/files (oder etwas mit
 *   denselben Feldern: `extension`, `basename`, `mime`).
 * @return {boolean}
 */
export function needsOwnFileAction(node) {
	if (!node) {
		return false
	}

	// `extension` ist der direkte Weg; `basename` ist der Rueckfall, weil die
	// Feldnamen zwischen den @nextcloud/files-Staenden schon gewandert sind
	// und ein fehlendes Feld die Aktion sonst stillschweigend abschaltet.
	const extension = typeof node.extension === 'string' ? node.extension.toLowerCase() : ''
	const basename = typeof node.basename === 'string' ? node.basename.toLowerCase() : ''
	const istMscz = extension === MSCZ_EXTENSION || basename.endsWith(MSCZ_EXTENSION)

	return istMscz && node.mime !== MSCZ_MIME
}

// ---------------------------------------------------------------------------
// Setlisten (E6, E11)
// ---------------------------------------------------------------------------
// Eine Setliste ist eine gewoehnliche Markdown-Datei mit eigener Endung - den
// Mimetype `text/markdown` teilt sie mit jeder anderen `.md`. Erkannt wird sie
// deshalb am Namen, und nur daran: Eine `Notizen.md` bleibt Sache von Text.

export const SETLIST_EXTENSION = '.setlist.md'

/**
 * @param {object} node Ein Knoten aus @nextcloud/files (`basename`, `type`)
 * @return {boolean}
 */
export function isSetlistFile(node) {
	if (!node || (node.type !== undefined && node.type !== 'file')) {
		return false
	}
	// Nur `basename`: `extension` liefert bei zwei Punkten nur `.md` - genau
	// der Teil, den die Setliste mit jeder Notiz teilt.
	const basename = typeof node.basename === 'string' ? node.basename.toLowerCase() : ''
	return basename.length > SETLIST_EXTENSION.length && basename.endsWith(SETLIST_EXTENSION)
}
