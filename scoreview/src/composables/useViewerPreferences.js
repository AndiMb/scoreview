import axios from '@nextcloud/axios'
import { loadState } from '@nextcloud/initial-state'
import { generateUrl } from '@nextcloud/router'
import { computed, ref, watch } from 'vue'
import {
	highlightCssVars,
	normalizeHighlightColor,
	normalizeHighlightMode,
} from '../lib/highlightStyle.js'

/**
 * Wie lange nach der letzten Aenderung gewartet wird, bevor gespeichert
 * wird. Der Farbwaehler feuert waehrend des Ziehens laufend - ohne diese
 * Pause waere jede Bewegung ein POST.
 */
const SAVE_DELAY_MS = 600

/**
 * Die Anzeigeeinstellungen der Nutzerin: Farbe und Form der Hervorhebung.
 *
 * Serverseitig gespeichert (Service\ViewerPreferences), nicht im
 * `localStorage`: Die App wird auf mehreren Geraeten benutzt - am Rechner
 * vorbereitet, am Tablet auf dem Notenstaender gelesen -, und eine Farbe,
 * die dort gut lesbar ist, soll nicht auf jedem Geraet neu gesucht werden.
 *
 * GELESEN wird trotzdem ohne HTTP-Anfrage: Der Anfangszustand haengt schon
 * an der Files-Seite (Listener\FilesLoadAdditionalScriptsListener), auf der
 * das Viewer-Bundle ohnehin geladen wird. Eine eigene Anfrage waere genau
 * die Verzoegerung, in der die erste Note noch in der Vorgabefarbe
 * aufleuchtet.
 *
 * @return {object} die beiden Einstellungen als Refs, dazu die fertigen
 *   CSS-Variablen fuer das Notenbild
 */
export function useViewerPreferences() {
	const anfang = leseAnfangszustand()
	const highlightColor = ref(normalizeHighlightColor(anfang.highlightColor))
	const highlightMode = ref(normalizeHighlightMode(anfang.highlightMode))

	const highlightStyle = computed(() => highlightCssVars(highlightColor.value))

	// Auf der eigenstaendigen Seite der mobilen Apps wird NICHT gespeichert.
	//
	// Der Grund liegt nicht in der Oberflaeche, sondern im Zuschnitt des
	// Tokenwegs: `preference#update` ist als einzige Route der App nicht
	// dateibezogen - sie aendert die Einstellung der Nutzerin instanzweit.
	// Der Pflichtvergleich der Middleware (Token gilt fuer GENAU diese
	// fileId) hat dort nichts zu vergleichen, und der Token allein waere zu
	// wenig; die Route bleibt deshalb bewusst draussen
	// (Middleware\DirectAccessMiddleware). Jeder Speicherversuch von dort
	// liefe in ein 401.
	//
	// Die Einstellung wirkt im geoeffneten Viewer trotzdem sofort - sie ist
	// nur nicht ueber diese Sitzung hinaus gemerkt. Das ist genau der
	// Verlust, den auch der Fehlerfall unten hinnimmt; ihn hier absichtlich
	// hinzunehmen ist ehrlicher, als am Telefon eine Anfrage loszuschicken,
	// von der feststeht, dass sie abgewiesen wird.
	let saveTimer = null
	if (!istEigenstaendigeSeite()) {
		watch([highlightColor, highlightMode], () => {
			if (saveTimer) {
				clearTimeout(saveTimer)
			}
			saveTimer = setTimeout(save, SAVE_DELAY_MS)
		})
	}

	async function save() {
		saveTimer = null
		try {
			await axios.post(generateUrl('/apps/scoreview/api/preferences'), {
				highlightColor: highlightColor.value,
				highlightMode: highlightMode.value,
			})
		} catch (err) {
			// Bewusst nur ins Log: Die Einstellung wirkt im geoeffneten Viewer
			// bereits, sie ist nur nicht ueber die Sitzung hinaus gemerkt. Ein
			// Fehlerbanner ueber der Partitur waere fuer diesen Verlust zu
			// laut - und stuende ausgerechnet dann da, wenn jemand gerade
			// singt.
			// eslint-disable-next-line no-console
			console.error('ScoreView: Anzeigeeinstellung konnte nicht gespeichert werden.', err)
		}
	}

	return { highlightColor, highlightMode, highlightStyle }
}

/**
 * Ob diese Seite die eigenstaendige der mobilen Apps ist
 * (DirectEditing\ScoreDirectEditor). Erkannt am Initial State, nicht an
 * einem Merkmal des Geraets: Dieselbe Seite laesst sich auch am Rechner
 * oeffnen, und es geht nicht um klein oder gross, sondern darum, ob es eine
 * Sitzung gibt.
 *
 * @return {boolean}
 */
function istEigenstaendigeSeite() {
	try {
		return loadState('scoreview', 'standalone')?.directEditing === true
	} catch {
		return false
	}
}

/**
 * Der Anfangszustand von der Files-Seite, mit Rueckfall auf die Vorgaben.
 *
 * `loadState()` wirft, wenn der Schluessel fehlt - und das ist kein
 * theoretischer Fall: Das Viewer-Bundle laeuft auch dort, wo der Listener
 * nichts hinterlegt hat (aeltere Instanz, Aufruf ausserhalb der
 * Files-Seite). Dann gelten die Vorgaben aus lib/highlightStyle.js.
 *
 * @return {{highlightColor?: string, highlightMode?: string}}
 */
function leseAnfangszustand() {
	try {
		return loadState('scoreview', 'viewer-preferences') ?? {}
	} catch {
		return {}
	}
}
