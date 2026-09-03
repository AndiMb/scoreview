import axios from '@nextcloud/axios'
import { translate } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { computed, ref } from 'vue'
import { useClientConversion } from './useClientConversion.js'

const POLL_INTERVAL_MS = 2000

const t = (text, vars) => translate('scoreview', text, vars)

/**
 * Wartet darauf, dass der Server die Partitur konvertiert hat, und übersetzt
 * einen gespeicherten Fehlercode in einen Satz.
 *
 * Zweites Composable aus der Zerlegung von `ScoreViewer.vue`.
 *
 * Der Fehlercode kommt bewusst als **Code** vom Server und wird erst hier
 * übersetzt (E4): der Text wird einmal beim Konvertieren geschrieben,
 * aber von beliebigen Nutzerinnen in beliebigen Sprachen gelesen - `IL10N`
 * ist serverseitig an die Sprache der gerade anfragenden Person gebunden und
 * wäre dafür die falsche Stelle. `errorMessage` steht daneben als
 * unverändertes technisches Detail.
 *
 * **Der Rückfall sitzt hier, hinter genau einem `if`.** Kann der Server nicht
 * konvertieren, antwortet der Statusendpunkt mit `client` statt mit Artefakten
 * (Service\ClientFallback), und dieses Composable rechnet selbst. Der Vertrag
 * ist der KÖRPER von `onReady`, nicht die HTTP-Antwort, aus der er stammt -
 * deshalb kostet der zweite Weg keine Zeile im Viewer, und die Trennung aus E3
 * bleibt: Was der Viewer tut, hängt allein an den Artefakten.
 *
 * @param {object} deps
 * @param {() => (number|string)} deps.fileId
 * @param {(body: object) => Promise<void>} deps.onReady wird genau einmal
 *   aufgerufen, sobald die Konvertierung fertig ist - bekommt die
 *   Serverantwort mit den Artefakt-URLs
 */
export function useConversionStatus({ fileId, onReady }) {
	// loading | converting | ready | error
	const state = ref('loading')
	const errorMessage = ref('')
	// sidecar_unreachable | sidecar_rejected | local_unavailable |
	// conversion_failed | timeout | no_pages | too_large |
	// client_too_large | client_engine_unavailable | unknown | ''
	// (kein Fehler bzw. Fehler kam nicht vom Server, sondern vom Abruf selbst)
	const errorCode = ref('')

	let pollTimer = null
	let autoRetried = false

	const client = useClientConversion()
	/** Gesetzt, solange die Artefakte aus dem Browser stammen - siehe reconvert(). */
	let letzteClientAntwort = null

	/**
	 * `unknown` ist sowohl expliziter Code als auch Rückfall für einen
	 * unbekannten/fehlenden Code (z.B. ältere Fehlerdatensätze ohne Code).
	 *
	 * @param {string} code
	 * @return {string}
	 */
	function codeText(code) {
		const messages = {
			sidecar_unreachable: t('The conversion service could not be reached.'),
			sidecar_rejected: t('The conversion service rejected the file.'),
			local_unavailable: t('This server is set up to convert scores itself, but cannot. The administration settings say what is missing.'),
			conversion_failed: t('The score could not be converted.'),
			timeout: t('The conversion did not finish in time.'),
			no_pages: t('The score contains no pages that could be converted.'),
			too_large: t('The score is too large to be converted.'),
			client_too_large: t('This score is too large to be set in this browser, and this server cannot convert it itself.'),
			client_engine_unavailable: t('This score could not be set in this browser, and this server cannot convert it itself. Reloading the page may help.'),
			unknown: t('An unknown error occurred during conversion.'),
		}
		return messages[code] ?? messages.unknown
	}

	// Bei einem serverseitig gespeicherten Code dessen feste Übersetzung,
	// sonst die rohe JS-Fehlermeldung des Abrufs - die ist ohnehin
	// umgebungsspezifisch und nicht sinnvoll übersetzbar.
	const errorText = computed(() => (errorCode.value
		? codeText(errorCode.value)
		: (errorMessage.value || t('Unknown error.'))))

	async function poll() {
		let body
		try {
			const res = await axios.get(generateUrl('/apps/scoreview/api/scores/{fileId}/status', { fileId: fileId() }))
			body = res.data
		} catch (err) {
			state.value = 'error'
			errorMessage.value = err.message
			errorCode.value = ''
			return
		}

		if (body.status === 'ready') {
			state.value = 'ready'
			await onReady(body)
		} else if (body.status === 'client') {
			await konvertiereImBrowser(body)
		} else if (body.status === 'error') {
			state.value = 'error'
			errorMessage.value = body.error || ''
			errorCode.value = body.errorCode || 'unknown'
			// Der Status-Endpunkt stößt bei einem gespeicherten Fehler selbst
			// schon einen erneuten Versuch an (z.B. nach einem Sidecar-
			// Konfigurationsfix). Einmalig automatisch nachschauen, ob der
			// gerade lief und erfolgreich war, statt dass die Nutzerin die
			// Datei manuell neu öffnen muss. Begrenzt auf einen Versuch, damit
			// ein dauerhaft kaputtes Setup nicht endlos weiterpollt.
			if (!autoRetried) {
				autoRetried = true
				pollTimer = setTimeout(poll, POLL_INTERVAL_MS)
			}
		} else {
			state.value = 'converting'
			pollTimer = setTimeout(poll, POLL_INTERVAL_MS)
		}
	}

	/**
	 * Der Server kann nicht - also rechnet der Browser. Kein Poll-Loop: Es
	 * gibt nichts abzufragen, das Ergebnis entsteht hier.
	 *
	 * @param {object} body die `client`-Antwort des Statusendpunkts
	 */
	async function konvertiereImBrowser(body) {
		letzteClientAntwort = body
		// Für die Nutzerin ist das derselbe Zustand wie eine Konvertierung auf
		// dem Server: Es dauert, und danach steht die Partitur da.
		state.value = 'converting'
		try {
			const fertig = await client.run(body, fileId())
			if (fertig === null) {
				// Von einem neueren Lauf überholt - der hat die Anzeige.
				return
			}
			state.value = 'ready'
			await onReady(fertig)
		} catch (err) {
			state.value = 'error'
			errorMessage.value = err?.message ?? ''
			// Die Codes aus lib/clientConversion.js stehen im selben Vokabular
			// wie die des Servers und werden hier genauso übersetzt (E4).
			errorCode.value = err?.code ?? 'unknown'
		}
	}

	/**
	 * Verwirft die gespeicherte Konvertierung serverseitig und wartet auf die
	 * neue. Der Grund, warum es diesen Weg ueberhaupt gibt: Ein einmal
	 * fertiges Ergebnis bleibt liegen, solange niemand die Datei anfasst -
	 * eine App-Fassung, die besser setzt, erreicht bestehende Partituren
	 * sonst nie.
	 *
	 * `reset()` VOR dem POST, nicht danach: der Server verwirft die
	 * Artefakte, auf die der Viewer gerade noch zeigt, sofort.
	 */
	async function reconvert() {
		const warImBrowser = letzteClientAntwort !== null
		reset()
		if (warImBrowser) {
			// Auf diesem Weg gibt es serverseitig nichts zu verwerfen - der
			// Sitzungscache ist mit reset() schon weg, und poll() lässt
			// denselben Browser noch einmal rechnen. Für die Nutzerin
			// bedeutet der Knopf trotzdem dasselbe wie sonst.
			await poll()
			return
		}
		try {
			await axios.post(generateUrl('/apps/scoreview/api/scores/{fileId}/reconvert', { fileId: fileId() }))
		} catch (err) {
			state.value = 'error'
			errorMessage.value = err.message
			errorCode.value = ''
			return
		}
		await poll()
	}

	function stop() {
		if (pollTimer) {
			clearTimeout(pollTimer)
			pollTimer = null
		}
	}

	function reset() {
		stop()
		// Die Blob-URLs der letzten Konvertierung im Browser freigeben, sonst
		// hält der Tab die Artefakte jeder je geöffneten Partitur.
		client.release()
		letzteClientAntwort = null
		state.value = 'loading'
		errorMessage.value = ''
		errorCode.value = ''
		autoRetried = false
	}

	// `clientProgress` ist null, solange nichts im Browser gerechnet wird -
	// auf einer Instanz mit funktionierendem Serverweg also immer.
	return { state, errorMessage, errorCode, errorText, clientProgress: client.progress, poll, reconvert, stop, reset }
}
