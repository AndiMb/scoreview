import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { ref } from 'vue'
import { clampLevel, DEFAULT_OTHERS_LEVEL } from '../lib/coachMix.js'

/** Die Vorgaben der Uebe-Einstellungen, wie Service\ViewerPreferences. */
export const PRACTICE_DEFAULTS = Object.freeze({ transpose: 0, coach: false, othersLevel: DEFAULT_OTHERS_LEVEL })

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
 * Mit derselben Antwort kommen die Uebe-Einstellungen der Partitur
 * (Transposition, Coach, Pegel der anderen Stimmen, H4/H6) - je Datei aus
 * demselben Grund. Geschrieben werden sie ueber eine eigene Route
 * (`practice`), damit ein fehlendes `partId` nie die Stimme loescht.
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
	const practice = ref({ ...PRACTICE_DEFAULTS })

	// Jede Ladung bekommt eine Nummer. Eine Antwort, die nach einem
	// Dateiwechsel oder einer eigenen Wahl eintrifft, ist veraltet und darf
	// nichts mehr ueberschreiben - sonst sprunge die Stimme eine halbe Sekunde
	// nach dem Klick auf den alten Wert zurueck.
	let generation = 0

	const url = () => generateUrl('/apps/scoreview/api/scores/{fileId}/my-part', { fileId: fileId() })

	async function load() {
		const mine = ++generation
		myPartId.value = null
		practice.value = { ...PRACTICE_DEFAULTS }
		try {
			const res = await axios.get(url())
			if (mine === generation) {
				myPartId.value = res.data?.partId ?? null
				practice.value = normalizePractice(res.data?.practice)
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

	/**
	 * Uebe-Einstellungen aendern - nur die mitgegebenen Felder.
	 *
	 * @param {{transpose?: number, coach?: boolean, othersLevel?: number}} changes
	 */
	async function setPractice(changes) {
		generation++
		practice.value = normalizePractice({ ...practice.value, ...changes })
		try {
			await axios.put(generateUrl('/apps/scoreview/api/scores/{fileId}/practice', { fileId: fileId() }), changes)
		} catch (err) {
			// Wie bei der Stimme: Es wirkt im offenen Viewer, nur ungemerkt.
			// eslint-disable-next-line no-console
			console.error('ScoreView: Uebe-Einstellungen konnten nicht gespeichert werden.', err)
		}
	}

	return { myPartId, practice, load, set, setPractice }
}

/**
 * @param {?object} data
 * @return {{transpose: number, coach: boolean, othersLevel: number}}
 */
export function normalizePractice(data) {
	const t = Math.trunc(Number(data?.transpose) || 0)
	return {
		transpose: Math.max(-12, Math.min(12, t)),
		coach: data?.coach === true,
		othersLevel: data?.othersLevel === undefined ? DEFAULT_OTHERS_LEVEL : clampLevel(data.othersLevel),
	}
}
