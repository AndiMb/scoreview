import axios from '@nextcloud/axios'
import { translate } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { computed, ref } from 'vue'

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
	// sidecar_unreachable | sidecar_rejected | conversion_failed | timeout |
	// no_pages | too_large | unknown | '' (kein Fehler bzw. Fehler kam nicht
	// vom Server, sondern vom Abruf selbst)
	const errorCode = ref('')

	let pollTimer = null
	let autoRetried = false

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
			conversion_failed: t('The score could not be converted.'),
			timeout: t('The conversion did not finish in time.'),
			no_pages: t('The score contains no pages that could be converted.'),
			too_large: t('The score is too large to be converted.'),
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

	function stop() {
		if (pollTimer) {
			clearTimeout(pollTimer)
			pollTimer = null
		}
	}

	function reset() {
		stop()
		state.value = 'loading'
		errorMessage.value = ''
		errorCode.value = ''
		autoRetried = false
	}

	return { state, errorMessage, errorCode, errorText, poll, stop, reset }
}
