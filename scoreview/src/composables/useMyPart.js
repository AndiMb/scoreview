import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { ref } from 'vue'

/**
 * „Meine Stimme" je Partitur, serverseitig gemerkt
 * (Controller\MyPartController).
 *
 * Serverseitig, weil eine Wahl, die nur im Viewer lebte, bei jedem
 * Dateiwechsel verloren ginge. Anfangston, Stimmnotizen, Setliste und Intonation haengen aber
 * alle daran - und wer im Tenor singt, will das nicht vor jedem Stueck neu
 * sagen. Je Datei statt einmal fuer alle, weil dieselbe Person im naechsten
 * Stueck eine andere Stimme singen kann.
 *
 * Gelesen per GET beim Oeffnen, parallel zu den Artefakten. Gibt es die
 * gemerkte Stimme in der Partitur nicht mehr (Re-Upload), bleibt sie
 * wirkungslos - `myPartIndex` im Viewer findet sie dann einfach nicht.
 *
 * @param {object} deps
 * @param {() => (number|string)} deps.fileId aktuelle fileId
 * @return {object}
 */
export function useMyPart({ fileId }) {
	const myPartId = ref(null)

	// Jede Ladung bekommt eine Nummer. Eine Antwort, die nach einem
	// Dateiwechsel oder einer eigenen Wahl eintrifft, ist veraltet und darf
	// nichts mehr ueberschreiben - sonst sprunge die Stimme eine halbe Sekunde
	// nach dem Klick auf den alten Wert zurueck.
	let generation = 0

	const url = () => generateUrl('/apps/scoreview/api/scores/{fileId}/my-part', { fileId: fileId() })

	async function load() {
		const mine = ++generation
		myPartId.value = null
		try {
			const res = await axios.get(url())
			if (mine === generation) {
				myPartId.value = res.data?.partId ?? null
			}
		} catch (err) {
			// Ohne gemerkte Stimme geht es ohne diese Vorbelegung weiter - kein Banner
			// ueber der Partitur fuer etwas, das man mit einem Klick neu waehlt.
			// eslint-disable-next-line no-console
			console.error('ScoreView: „Meine Stimme" konnte nicht geladen werden.', err)
		}
	}

	/**
	 * @param {?string} partId Stimme aus meta.parts, null = keine
	 */
	async function set(partId) {
		generation++
		myPartId.value = partId
		try {
			await axios.put(url(), { partId })
		} catch (err) {
			// Die Wahl wirkt im geoeffneten Viewer trotzdem - sie ist nur nicht
			// ueber das Schliessen hinaus gemerkt (wie bei useViewerPreferences).
			// eslint-disable-next-line no-console
			console.error('ScoreView: „Meine Stimme" konnte nicht gespeichert werden.', err)
		}
	}

	return { myPartId, load, set }
}
