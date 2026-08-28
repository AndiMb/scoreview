// Wann ScoreView eine Datei selbst oeffnen muss - reine Pruefung, ohne DOM
// und ohne Nextcloud-Objekte.
//
// Der regulaere Einstieg ist Nextclouds Viewer, und der haengt am Mimetype
// MSCZ_MIME. Dessen Registrierung ist server-weit (config/mimetypemapping.json
// plus `occ maintenance:mimetype:update-db`) und laesst sich aus einer App
// heraus nicht vornehmen: auf verwaltetem Hosting fehlt beides, und selbst auf
// einer eigenen Instanz bleiben bereits hochgeladene Dateien bis zu einem
// `occ files:scan` auf `application/octet-stream` stehen.
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
