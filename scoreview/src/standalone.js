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
import { createApp } from 'vue'
import StandaloneFrame from './components/StandaloneFrame.vue'
import { darfTokenTragen, TOKEN_HEADER } from './lib/directToken.js'
import { createBridge } from './lib/mobileBridge.js'

const zustand = (() => {
	try {
		return loadState('scoreview', 'standalone')
	} catch {
		return {}
	}
})()

/**
 * Der Ausweis haengt an ZWEI Wegen, weil der Viewer zwei benutzt:
 *
 *   axios  fuer alles, was der Viewer selbst holt (Status, Artefakte, SVG,
 *          Notizen) - im Browser ueber XHR, der Interceptor greift trotzdem.
 *   fetch  fuer das SoundFont (bewusst so, siehe usePlayback.js) und fuer
 *          alles, was die Engine im Rueckfall selbst nachlaedt (die
 *          wasm-Dateien holt Emscripten mit fetch, an uns vorbei).
 *
 * Beide entscheiden mit derselben reinen Pruefung aus lib/directToken.js, und
 * zwar an der HERKUNFT der URL - nicht daran, welcher Konvertierungsweg
 * gelaufen ist (A6). Ein fremder SoundFont-Host bekommt den Token deshalb in
 * keinem der beiden Wege zu sehen.
 *
 * Beides steht hier und nicht im Viewer: Der Viewer ist auf allen drei
 * Einstiegen derselbe und soll nicht danach verzweigen, wie seine Seite
 * ausgeliefert wurde.
 *
 * @param {string} token Der Token aus dem Initial State
 */
function ausweisAnhaengen(token) {
	axios.interceptors.request.use((config) => {
		if (darfTokenTragen(config.url, window.location.origin)) {
			config.headers = config.headers ?? {}
			config.headers[TOKEN_HEADER] = token
		}
		return config
	})

	const original = window.fetch.bind(window)
	window.fetch = (eingabe, optionen = {}) => {
		const url = typeof eingabe === 'string' ? eingabe : eingabe?.url
		if (!darfTokenTragen(url, window.location.origin)) {
			return original(eingabe, optionen)
		}
		// `Headers` statt eines einfachen Objekts: Der Aufrufer darf beides
		// uebergeben haben, und nur so bleibt mitgegeben, was schon da stand.
		const header = new Headers(optionen.headers ?? (typeof eingabe === 'object' ? eingabe?.headers : undefined))
		header.set(TOKEN_HEADER, token)
		return original(eingabe, { ...optionen, headers: header })
	}
}

/**
 * Ein abgelaufener Token laesst sich aus der Seite heraus nicht erneuern: Fuer
 * Manager::edit() ist er ein Einmal-Token, ein blosses location.reload() liefe
 * in die Fehlerseite der App. Nur die App kann einen frischen holen - also
 * bitten wir sie darum.
 *
 * Nur bei genau diesem Code, nicht bei jedem 401: Ein 403
 * (token_file_mismatch) waere ein Fehler in dieser Seite, kein abgelaufener
 * Ausweis, und ein Neuladen verdeckte ihn bloss.
 *
 * @param {object} bruecke Die Bruecke zur App (lib/mobileBridge.js)
 */
function beiAblaufNeuLaden(bruecke) {
	axios.interceptors.response.use(undefined, (fehler) => {
		if (fehler?.response?.status === 401
			&& fehler.response?.data?.errorCode === 'token_expired') {
			bruecke.reload()
		}
		return Promise.reject(fehler)
	})
}

if (zustand.token) {
	ausweisAnhaengen(zustand.token)
	beiAblaufNeuLaden(createBridge(window))
}

createApp(StandaloneFrame, {
	fileid: zustand.fileId,
	name: zustand.fileName ?? '',
}).mount('#scoreview-standalone')
