// Rund um den Zugriff aufs Mikrofon - rein, ohne DOM.
//
// **Erkennen statt raten** (E8): Ob das Mikrofon geht, zeigt
// allein der Fehler von `getUserMedia`, nie der User-Agent. Die WebView der
// Nextcloud-Android-App lehnt heute gemessen mit `NotAllowedError` ab; aendert
// die App das, geht es ohne Zutun. Und ein verweigertes Mikrofon im
// gewoehnlichen Browser sieht genauso aus - auch dort hilft der Weg ueber
// eine neu geoeffnete Seite (dann mit Rueckfrage).

/**
 * Keine Verarbeitung durch den Browser: Echounterdrueckung
 * zieht die Begleitung heraus, die Rauschunterdrueckung glaettet genau die
 * Obertoene, an denen die Tonhoehe haengt, und die automatische Verstaerkung
 * pumpt. Fuer eine Aufnahme zum Nachhoeren und fuer die Intonation ist das
 * rohe Signal das richtige.
 */
export const MIC_CONSTRAINTS = Object.freeze({
	audio: {
		echoCancellation: false,
		noiseSuppression: false,
		autoGainControl: false,
		channelCount: 1,
	},
	video: false,
})

/** Die Nutzer der Mikrofonstrecke. */
export const CONSUMERS = Object.freeze(['recorder', 'intonation', 'follower'])

/**
 * Welche Nutzer den Aufnahmeweg (Bloecke aus dem Worklet) bekommen. Das
 * Mitverfolgen nie: Es speichert nichts und haengt an eigenen
 * Analyser-Merkmalen (S7) - eine Aufnahme ist immer eine eigene,
 * ausdrueckliche Handlung.
 *
 * @param {string} consumer
 * @return {boolean}
 */
export function mayUseCapturePath(consumer) {
	return consumer === 'recorder' || consumer === 'intonation'
}

/**
 * Was ein Fehler von getUserMedia fuer die Oberflaeche heisst.
 *
 * - `blocked`: verweigert oder in dieser Umgebung nicht erlaubt
 *   (`NotAllowedError`, `SecurityError`, `NotSupportedError`, kein
 *   `mediaDevices` ueberhaupt) - dort hilft „Im Browser oeffnen".
 * - `noDevice`: kein Mikrofon angeschlossen (`NotFoundError`,
 *   `OverconstrainedError`).
 * - `busy`: von einer anderen Anwendung belegt (`NotReadableError`,
 *   `AbortError`).
 *
 * @param {?{name?:string}} error
 * @return {'blocked'|'noDevice'|'busy'|'other'}
 */
export function classifyMicError(error) {
	switch (error?.name) {
		case 'NotAllowedError':
		case 'SecurityError':
		case 'NotSupportedError':
		case 'TypeError':
			return 'blocked'
		case 'NotFoundError':
		case 'OverconstrainedError':
			return 'noDevice'
		case 'NotReadableError':
		case 'AbortError':
			return 'busy'
		default:
			return 'other'
	}
}

/**
 * Die Adresse der Datei in Nextclouds Weboberflaeche - der Weg „Im Browser
 * oeffnen", wo die App-WebView das Mikrofon verweigert. `/f/<fileId>` ist
 * Nextclouds eigener Kurzlink; er fuehrt nach der Anmeldung zur Datei,
 * gleich in welchem Ordner sie liegt.
 *
 * @param {string} origin z. B. `https://cloud.example.org`
 * @param {string} webroot z. B. `` oder `/nextcloud`
 * @param {number|string} fileId
 * @return {string}
 */
export function browserFileUrl(origin, webroot, fileId) {
	const root = (webroot || '').replace(/\/+$/, '')
	return `${origin}${root}/index.php/f/${encodeURIComponent(String(fileId))}`
}
