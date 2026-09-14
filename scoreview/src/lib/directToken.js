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
// Konvertierungsweg gelaufen ist (A6): Der Interceptor kennt den Unterschied
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
