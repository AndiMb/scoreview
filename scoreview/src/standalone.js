// Der Einstiegspunkt der eigenstaendigen Seite - ausgeliefert unter
// /apps/files/directEditing/{token}, nicht unter einer eigenen Route (siehe
// DirectEditing\ScoreDirectEditor).
//
// Die Seite kommt ohne Sitzungscookie an: Nextclouds OC\DirectEditing\Manager
// nimmt den Token-Scope gleich nach open() wieder zurueck. Gemessen auf
// Nextcloud 31 und 34 antworten ihre Folgeanfragen deshalb mit 401 - ohne den
// Ausweis unten zeigte der Viewer hier gar nichts an.

import axios from '@nextcloud/axios'
import { loadState } from '@nextcloud/initial-state'
import { generateUrl } from '@nextcloud/router'
import { createApp } from 'vue'
import StandaloneFrame from './components/StandaloneFrame.vue'
import { ausweisFuer, begleiterErneuerbar, setlisteDerAnfrage } from './lib/directToken.js'
import { createBridge } from './lib/mobileBridge.js'

import './publicPath.js'

const zustand = (() => {
	try {
		return loadState('scoreview', 'standalone')
	} catch {
		return {}
	}
})()

/**
 * Begleit-Token fuer weitere Dateien einer Setliste (S1): fileId ->
 * Token. NUR im Speicher dieser Seite - nicht in localStorage oder
 * sessionStorage, wo sie das Schliessen der Seite ueberlebten und fuer jedes
 * Skript derselben Herkunft greifbar blieben. Mit der Seite sind sie weg;
 * ihre Wurzel, das Direct-Editing-Token, ist es dann ebenso.
 */
const begleiter = new Map()
/** Laufende Ausgaben je Liste - zwei gleichzeitige Anfragen holen nur einmal. */
const ausgaben = new Map()
/** Die zuletzt freigeschaltete Liste - dorthin geht es, wenn Begleiter ablaufen. */
let letzteListe = null

/**
 * Holt die Begleit-Token einer Setliste - eines je Stueck, das die Nutzerin
 * sehen darf, und eines fuer die Liste selbst. Ausgegeben wird nur gegen das
 * Direct-Editing-Token dieser Seite und nur fuer eine Liste, die ihre
 * Partitur enthaelt (Controller\SetlistController::tokens).
 *
 * @param {string} liste fileId der Setliste
 * @return {Promise<void>}
 */
function begleiterHolen(liste) {
	if (!ausgaben.has(liste)) {
		const url = generateUrl('/apps/scoreview/api/scores/{fileId}/setlists/{setlistId}/tokens', {
			fileId: zustand.fileId,
			setlistId: liste,
		})
		ausgaben.set(liste, axios.post(url).then((antwort) => {
			for (const { fileId, token } of antwort.data?.tokens ?? []) {
				begleiter.set(String(fileId), token)
			}
			letzteListe = liste
		}).finally(() => ausgaben.delete(liste)))
	}
	return ausgaben.get(liste)
}

/**
 * Der Ausweis haengt an ZWEI Wegen, weil der Viewer zwei benutzt:
 *
 *   axios  fuer alles, was der Viewer selbst holt (Status, Artefakte, SVG,
 *          Notizen, Setliste) - im Browser ueber XHR, der Interceptor greift
 *          trotzdem.
 *   fetch  fuer das SoundFont (bewusst so, siehe usePlayback.js) und fuer
 *          alles, was die Engine im Rueckfall selbst nachlaedt (die
 *          wasm-Dateien holt Emscripten mit fetch, an uns vorbei).
 *
 * Beide entscheiden mit derselben reinen Pruefung aus lib/directToken.js, und
 * zwar an der ADRESSE der Anfrage: an ihrer Herkunft - ein fremder
 * SoundFont-Host bekommt keinen Token zu sehen - und an der fileId im Pfad,
 * die bestimmt, welcher Begleiter mitgeht. Nicht daran, welcher
 * Konvertierungsweg gelaufen ist, und nicht daran, welches Stueck der
 * Viewer gerade zeigt: Er fragt wie immer nach seiner Datei.
 *
 * Beides steht hier und nicht im Viewer: Der Viewer ist auf allen drei
 * Einstiegen derselbe und soll nicht danach verzweigen, wie seine Seite
 * ausgeliefert wurde.
 *
 * @param {string} token Der Token aus dem Initial State
 */
function ausweisAnhaengen(token) {
	const herkunft = window.location.origin
	const ausweis = { token, originFileId: zustand.fileId, begleiter }

	axios.interceptors.request.use(async (config) => {
		// Eine Setliste lesen oder schreiben braucht ihren Begleiter - und
		// wer sie oeffnet, will gleich darin blaettern. Also vorher holen.
		const liste = setlisteDerAnfrage(config.url, herkunft)
		if (liste !== null && !begleiter.has(liste)) {
			try {
				await begleiterHolen(liste)
			} catch {
				// Die Anfrage geht trotzdem - ihre Antwort (404/403) sagt dem
				// Viewer, dass die Liste hier nicht zu haben ist.
			}
		}
		config.headers = config.headers ?? {}
		for (const [name, wert] of Object.entries(ausweisFuer(config.url, herkunft, ausweis))) {
			config.headers[name] = wert
		}
		return config
	})

	const original = window.fetch.bind(window)
	window.fetch = (eingabe, optionen = {}) => {
		const url = typeof eingabe === 'string' ? eingabe : eingabe?.url
		const zusatz = ausweisFuer(url, herkunft, ausweis)
		if (Object.keys(zusatz).length === 0) {
			return original(eingabe, optionen)
		}
		// `Headers` statt eines einfachen Objekts: Der Aufrufer darf beides
		// uebergeben haben, und nur so bleibt mitgegeben, was schon da stand.
		const header = new Headers(optionen.headers ?? (typeof eingabe === 'object' ? eingabe?.headers : undefined))
		for (const [name, wert] of Object.entries(zusatz)) {
			header.set(name, wert)
		}
		return original(eingabe, { ...optionen, headers: header })
	}
}

/**
 * Eine eben angelegte Setliste (POST /api/setlists) freischalten: Der Viewer
 * wechselt gleich danach zu ihrem ersten Stueck, und das braucht seinen
 * Begleiter schon. Erst danach geht die Antwort an den Viewer weiter.
 */
function neueListeFreischalten() {
	axios.interceptors.response.use(async (antwort) => {
		const pfad = String(antwort.config?.url ?? '').split('?')[0]
		if (antwort.config?.method === 'post' && pfad.endsWith('/apps/scoreview/api/setlists') && antwort.data?.id) {
			try {
				await begleiterHolen(String(antwort.data.id))
			} catch {
				// Eine Liste ohne die offene Partitur bekommt hier keine
				// Begleiter; in ihr blaettern geht dann erst im Browser.
			}
		}
		return antwort
	})
}

/**
 * Ein abgelaufener Token laesst sich aus der Seite heraus nicht erneuern: Fuer
 * Manager::edit() ist er ein Einmal-Token, ein blosses location.reload() liefe
 * in die Fehlerseite der App. Nur die App kann einen frischen holen - also
 * bitten wir sie darum.
 *
 * Ein abgelaufener BEGLEITER dagegen schon (12 h, oder widerrufen): Solange
 * das Direct-Editing-Token lebt, gibt der Server neue aus - einmal je
 * Anfrage, danach zaehlt der Fehler.
 *
 * Nur bei genau diesen Codes, nicht bei jedem 401: Ein 403
 * (token_file_mismatch) waere ein Fehler in dieser Seite, kein abgelaufener
 * Ausweis, und ein Neuladen verdeckte ihn bloss.
 *
 * @param {object} bruecke Die Bruecke zur App (lib/mobileBridge.js)
 */
function beiAblaufNeuLaden(bruecke) {
	axios.interceptors.response.use(undefined, async (fehler) => {
		const status = fehler?.response?.status
		const code = fehler?.response?.data?.errorCode
		const config = fehler?.config
		if (begleiterErneuerbar(status, code) && letzteListe !== null && config && !config.scoreviewErneuert) {
			begleiter.clear()
			await begleiterHolen(letzteListe)
			return axios({ ...config, scoreviewErneuert: true })
		}
		if (status === 401 && code === 'token_expired') {
			bruecke.reload()
		}
		return Promise.reject(fehler)
	})
}

if (zustand.token) {
	ausweisAnhaengen(zustand.token)
	neueListeFreischalten()
	beiAblaufNeuLaden(createBridge(window))
}

createApp(StandaloneFrame, {
	fileid: zustand.fileId,
	name: zustand.fileName ?? '',
}).mount('#scoreview-standalone')
