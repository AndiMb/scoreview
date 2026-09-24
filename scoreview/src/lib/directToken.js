// Wann eine Anfrage das Direct-Editing-Token mitfuehren darf - reine
// Pruefung, ohne axios und ohne DOM.
//
// Auf der eigenstaendigen Seite (DirectEditing\ScoreDirectEditor) ist der
// Token der einzige Ausweis, den der Viewer hat: Die Seite kommt ohne
// Sitzungscookie an, ihre Folgeanfragen bekommen sonst 401 (gemessen auf
// Nextcloud 31 und 34). Ein Interceptor haengt ihn deshalb an jede Anfrage -
// aber eben nicht an jede beliebige.
//
// Zwei Grenzen, beide mit Grund:
//
//   1. Nur gleiche Herkunft. Das SoundFont kann per `soundfont_url` von einem
//      fremden Host kommen; dorthin ginge der Token sonst als Beigabe mit.
//   2. Keine blob:- und data:-URLs. Der Rueckfall im Browser reicht die
//      Artefakte als Blob-URLs durch dieselben Aufrufe (siehe
//      lib/artifactUrls.js) - ein Header darauf ist bestenfalls wirkungslos.
//
// Bewusst an der HERKUNFT der URL entschieden, nicht daran, welcher
// Konvertierungsweg gelaufen ist (E3): Der Interceptor kennt den Unterschied
// gar nicht, und genau deshalb kostet ein Wechsel des Wegs hier keine Zeile.

export const TOKEN_HEADER = 'X-ScoreView-Token'

/**
 * @param {string} url Die Ziel-URL der Anfrage, absolut oder relativ.
 * @param {string} herkunft Die eigene Herkunft, also `window.location.origin`.
 * @return {boolean} ob der Token mitgehen darf
 */
export function darfTokenTragen(url, herkunft) {
	if (typeof url !== 'string' || url === '') {
		// Kein Ziel, keine Entscheidung - axios setzt die URL dann aus
		// `baseURL` zusammen, und die zeigt auf die eigene Instanz.
		return true
	}

	// Ein Schema ohne Host (blob:, data:, javascript:) hat keine Herkunft, zu
	// der sich etwas vergleichen liesse.
	if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:/i.test(url)) {
		return false
	}

	// Protokollrelative und absolute URLs gegen die eigene Herkunft messen.
	// `new URL(url, herkunft)` loest relative Pfade gegen sie auf - fuer die
	// bleibt der Vergleich damit immer wahr, was er sein soll.
	try {
		return new URL(url, herkunft).origin === new URL(herkunft).origin
	} catch {
		// Unlesbare URL: nichts anhaengen. Lieber eine Anfrage ohne Ausweis
		// als einen Ausweis an ein unbekanntes Ziel.
		return false
	}
}

// --- Begleit-Token (S1) -----------------------------------------------------
//
// Eine Setliste braucht auf der eigenstaendigen Seite mehr als die eine Datei
// des Direct-Editing-Tokens. Fuer jede weitere gibt der Server ein
// Begleit-Token aus; es gilt nur zusammen mit dem Direct-Editing-Token und nur
// fuer seine Datei. Welches mitgeht, entscheidet die ADRESSE der Anfrage:
// Jede Route der App, die eine Datei betrifft, traegt ihre fileId im Pfad
// (`/api/scores/{fileId}/…`, `/api/setlists/{fileId}`). So muss der Viewer
// nichts davon wissen - er fragt wie immer nach der Datei, die er zeigt.

export const COMPANION_HEADER = 'X-ScoreView-Companion'

const DATEI_IM_PFAD = /\/apps\/scoreview\/api\/(?:scores|setlists)\/(\d+)(?:\/|$)/
const LISTE_IM_PFAD = /\/apps\/scoreview\/api\/setlists\/(\d+)$/

/**
 * @param {string} url
 * @param {string} herkunft
 * @return {string|null} der Pfad, wenn die URL zur eigenen Instanz gehoert
 */
function eigenerPfad(url, herkunft) {
	if (typeof url !== 'string' || url === '' || !darfTokenTragen(url, herkunft)) {
		return null
	}
	try {
		return new URL(url, herkunft).pathname
	} catch {
		return null
	}
}

/**
 * Die Datei, um die es einer Anfrage geht - oder null, wenn sie keine
 * betrifft (SoundFont, Einstellungen) oder nicht an die eigene Instanz geht.
 *
 * @param {string} url
 * @param {string} herkunft `window.location.origin`
 * @return {string|null}
 */
export function dateiDerAnfrage(url, herkunft) {
	const pfad = eigenerPfad(url, herkunft)
	const treffer = pfad === null ? null : DATEI_IM_PFAD.exec(pfad)
	return treffer ? treffer[1] : null
}

/**
 * Ob eine Anfrage eine Setlisten-Datei selbst liest oder schreibt
 * (`/api/setlists/{id}`, nicht die Ausgabe unter `/api/scores/…`) - dann
 * braucht die Seite vorher die Begleit-Token dieser Liste.
 *
 * @param {string} url
 * @param {string} herkunft
 * @return {string|null} die fileId der Liste
 */
export function setlisteDerAnfrage(url, herkunft) {
	const pfad = eigenerPfad(url, herkunft)
	const treffer = pfad === null ? null : LISTE_IM_PFAD.exec(pfad)
	return treffer ? treffer[1] : null
}

/**
 * Die Header fuer eine Anfrage der eigenstaendigen Seite.
 *
 * - An eine fremde Herkunft geht gar nichts (siehe darfTokenTragen).
 * - Das Direct-Editing-Token geht an jede eigene Anfrage - die Middleware
 *   braucht es auch neben einem Begleiter, der allein nie gilt.
 * - Ein Begleiter nur an Anfragen fuer SEINE Datei, und nie fuer die Datei
 *   des Direct-Editing-Tokens selbst: Die braucht keinen, und die Ausgabe
 *   neuer Token nimmt ohnehin keinen an.
 *
 * @param {string} url
 * @param {string} herkunft
 * @param {{token: string, originFileId: (string|number), begleiter: Map<string, string>}} ausweis
 * @return {Record<string, string>}
 */
export function ausweisFuer(url, herkunft, { token, originFileId, begleiter }) {
	if (!darfTokenTragen(url, herkunft)) {
		return {}
	}
	const header = { [TOKEN_HEADER]: token }
	const datei = dateiDerAnfrage(url, herkunft)
	if (datei !== null && datei !== String(originFileId) && begleiter.has(datei)) {
		header[COMPANION_HEADER] = begleiter.get(datei)
	}
	return header
}

/**
 * Ob eine abgewiesene Anfrage an einem Begleiter scheiterte, den ein neuer
 * ersetzen kann - abgelaufen (12 h), widerrufen (Epoche) oder nicht mehr
 * passend. Ein 403 (falsche Datei, falscher Zweck) gehoert nicht dazu: Das
 * waere ein Fehler der Seite, und ein neues Token verdeckte ihn nur.
 *
 * @param {number|undefined} status
 * @param {string|undefined} code `errorCode` aus der Antwort
 * @return {boolean}
 */
export function begleiterErneuerbar(status, code) {
	return status === 401 && ['companion_expired', 'companion_revoked', 'companion_invalid'].includes(code)
}
