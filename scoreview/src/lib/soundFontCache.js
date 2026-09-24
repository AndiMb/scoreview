// Der SoundFont im Speicher der Seite - rein, ohne fetch und ohne
// AudioContext, damit sich Teilen, Abbrechen und Fehler testen lassen.
//
// Warum ueberhaupt: Beim Stueckwechsel einer Setliste baut der Viewer seinen
// AudioContext neu auf (usePlayback.reset). Der SoundFont ist aber derselbe,
// rund 40 MB - ein Neuladen je Stueck kostete im Konzert Sekunden und auf dem
// Telefon Datenvolumen. Der Eintrag lebt so lange wie die Seite; in Files ist
// das bis zum naechsten Neuladen. 40 MB Arbeitsspeicher sind dafuer der Preis,
// und genau dieselben Bytes laegen waehrend der Wiedergabe ohnehin einmal im
// Worklet.
//
// Drei Eigenschaften, jede mit Grund:
//
// 1. **Eine Kopie je Abnehmer.** Der Synthesizer UEBERTRAEGT den Puffer an
//    sein Worklet (spessasynth_lib `addSoundBank` mit Transferliste) - danach
//    ist er hier leer. Herausgegeben wird deshalb immer `slice(0)`.
// 2. **Ein laufender Abruf wird geteilt.** Wer waehrend des ersten Ladens das
//    Stueck wechselt, wartet auf denselben Abruf, statt einen zweiten zu
//    starten; der Fortschritt geht an alle, die warten.
// 3. **Fehler und Abbruch werden nicht gemerkt.** Sonst bliebe ein einmal
//    gescheiterter Abruf fuer die ganze Sitzung gescheitert.
//
// Gehalten wird genau EINE Adresse: Es gibt einen SoundFont je Instanz, und
// wechselt die Adresse (Admin hat ihn getauscht), ist der alte nichts mehr wert.

/**
 * @return {{
 *   get: (key: string, start: (report: (percent: number) => void) => {promise: Promise<ArrayBuffer>, abort: () => void}, onProgress?: (percent: number) => void) => Promise<ArrayBuffer>,
 *   abort: (key: string) => void,
 *   has: (key: string) => boolean,
 *   clear: () => void,
 * }}
 */
export function createSoundFontCache() {
	let entry = null

	function drop(own) {
		if (entry === own) {
			entry = null
		}
	}

	/**
	 * @param {string} key die Adresse des SoundFonts
	 * @param {(report: (percent: number) => void) => {promise: Promise<ArrayBuffer>, abort: () => void}} start
	 *   startet den Abruf; bekommt eine Meldefunktion fuer den Fortschritt
	 * @param {(percent: number) => void} [onProgress] Fortschritt 0..100 fuer diesen Abnehmer
	 * @return {Promise<ArrayBuffer>} eine eigene Kopie
	 */
	function get(key, start, onProgress = () => {}) {
		if (!entry || entry.key !== key) {
			entry?.abort()
			const own = { key, listeners: new Set(), percent: 0, done: false }
			const started = start((percent) => {
				own.percent = percent
				own.listeners.forEach((listener) => listener(percent))
			})
			own.promise = started.promise
			own.abort = started.abort
			entry = own
			own.promise.then(() => {
				own.done = true
				own.listeners.clear()
			}, () => drop(own))
		}
		const own = entry
		if (!own.done) {
			onProgress(own.percent)
			own.listeners.add(onProgress)
		}
		return own.promise.then((bytes) => bytes.slice(0), (err) => {
			own.listeners.delete(onProgress)
			throw err
		})
	}

	/**
	 * Bricht einen laufenden Abruf ab - „ohne Ton weiter". Ein fertiger
	 * Eintrag bleibt: Dort gibt es nichts mehr zu sparen.
	 *
	 * @param {string} key
	 */
	function abort(key) {
		if (entry && entry.key === key && !entry.done) {
			const own = entry
			entry = null
			own.abort()
		}
	}

	return {
		get,
		abort,
		has: (key) => !!entry && entry.key === key && entry.done,
		clear: () => {
			entry = null
		},
	}
}
