import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue'
import { readInitialState } from '../initialState.js'
import { COUNT_MODES } from '../lib/countLabels.js'
import { GUEST_KEYS, readGuest, writeGuest } from '../lib/guestStore.js'
import {
	highlightCssVars,
	normalizeHighlightColor,
	normalizeHighlightMode,
} from '../lib/highlightStyle.js'
import { isDarkBackground, normalizeNoteTheme, noteThemeCssVars, resolveNoteTheme, themeIsDarkFromIds } from '../lib/noteTheme.js'
import { normalizeReferencePitch } from '../lib/referencePitch.js'
import { SPREAD_PREFS } from '../lib/spreadLayout.js'

/**
 * Wie lange nach der letzten Aenderung gewartet wird, bevor gespeichert
 * wird. Der Farbwaehler feuert waehrend des Ziehens laufend - ohne diese
 * Pause waere jede Bewegung ein POST.
 */
const SAVE_DELAY_MS = 600

/**
 * The settings as last changed in this page, or null. The initial state is
 * read once with the Files page; a second score opened in the same page
 * would otherwise start from that old copy and lose, say, a pin set on the
 * first one - until the page is reloaded.
 *
 * @type {?object}
 */
let changedInPage = null

/** Wie Service\ViewerPreferences::NOTE_NAME_SYSTEMS - der erste ist die Vorgabe. */
export const NOTE_NAME_SYSTEMS = Object.freeze(['off', 'de', 'en', 'solfa-fixed', 'solfa-movable'])
/** Wie Service\ViewerPreferences::LAYOUTS. */
export const LAYOUTS = Object.freeze(['pages', 'band', 'lyrics'])

/**
 * Die Anzeigeeinstellungen der Nutzerin: Farbe und Form der Hervorhebung,
 * der Dunkelmodus der Noten und „Meine Stimme im Stereobild".
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
 * A visitor of a public link has no account: with `local` the settings go
 * to this browser (lib/guestStore.js) and come back from it on top of the
 * defaults the page delivers - the same settings, kept elsewhere.
 *
 * @param {object} [deps]
 * @param {() => boolean} [deps.local] keep them in the browser, not on the server
 * @return {object} die Einstellungen als Refs, dazu die fertigen
 *   CSS-Variablen fuer das Notenbild
 */
export function useViewerPreferences({ local = () => false } = {}) {
	const anfang = leseAnfangszustand(local())
	const highlightColor = ref(normalizeHighlightColor(anfang.highlightColor))
	const highlightMode = ref(normalizeHighlightMode(anfang.highlightMode))
	const stereoMyPart = ref(anfang.stereoMyPart === true)
	const noteTheme = ref(normalizeNoteTheme(anfang.noteTheme))
	// Tonnamen (H3) und Darstellung (H2/H8). Unbekannte Werte - etwa aus
	// einem neueren Server - fallen auf aus bzw. Seiten zurueck.
	const noteNames = ref(oneOf(anfang.noteNames, NOTE_NAME_SYSTEMS))
	const noteNamesMine = ref(anfang.noteNamesMine !== false)
	const layout = ref(oneOf(anfang.layout, LAYOUTS))
	const bandOffered = ref(anfang.bandOffered === true)
	// On unless switched off - also for a server that does not know it yet.
	const autoScroll = ref(anfang.autoScroll !== false)
	// Beat numbers over the notes (B1): off, on my staff, on all.
	const beatCounts = ref(oneOf(anfang.beatCounts, COUNT_MODES))
	// Two pages side by side where there is room (A2). Default page 1 on the
	// left, as Service\ViewerPreferences::DEFAULT_DOUBLE_PAGE - not the first value.
	const doublePage = ref(SPREAD_PREFS.includes(anfang.doublePage) ? anfang.doublePage : 'left')
	// a' for tuner, intonation and playback (lib/referencePitch.js); 440 from
	// a server that does not know it yet.
	const referencePitch = ref(normalizeReferencePitch(anfang.referencePitch))
	// The tools pinned to the bar (E23); null = never chosen, the default
	// applies (lib/barGroups.js). The server has already normalised the list.
	const barPins = ref(Array.isArray(anfang.barPins) ? anfang.barPins : null)

	// Ob das Nextcloud-Theme gerade dunkel ist - gelesen am Grund selbst
	// (lib/noteTheme.js). Nachgelesen, wenn das Betriebssystem umschaltet:
	// Das Theme „Systemvorgabe" folgt `prefers-color-scheme`, und ein Tablet,
	// das abends in den Nachtmodus geht, soll die Noten mitnehmen.
	const themeIsDark = ref(leseThemeDunkel())
	const farbschema = window.matchMedia?.('(prefers-color-scheme: dark)')
	const onSchemeChange = () => {
		// Erst nach dem Umschalten der Nextcloud-Variablen lesen.
		requestAnimationFrame(() => {
			themeIsDark.value = leseThemeDunkel()
		})
	}
	farbschema?.addEventListener?.('change', onSchemeChange)
	if (getCurrentScope()) {
		onScopeDispose(() => farbschema?.removeEventListener?.('change', onSchemeChange))
	}

	const resolvedNoteTheme = computed(() => resolveNoteTheme(noteTheme.value, themeIsDark.value))

	// Eine Style-Angabe fuer die Wurzel des Viewers: Hervorhebung und
	// Notenfarben erben sich von dort bis ins eingesetzte SVG (siehe
	// ScoreViewer.vue). Die Themenwerte kommen zuletzt - im Dunkeln hellen sie
	// die Hervorhebung auf, damit sie auf dem dunklen Grund traegt.
	const highlightStyle = computed(() => ({
		...highlightCssVars(highlightColor.value),
		...noteThemeCssVars(resolvedNoteTheme.value, highlightColor.value, themeIsDark.value),
	}))

	// Gespeichert wird auf allen drei Einstiegen - auf der eigenstaendigen
	// Seite der mobilen Apps mit ihrem Direct-Editing-Token
	// (Controller\PreferenceController, E8). Wer am Telefon den
	// Dunkelmodus waehlt, soll ihn beim naechsten Oeffnen wiederfinden.
	let saveTimer = null
	watch([highlightColor, highlightMode, stereoMyPart, noteTheme, noteNames, noteNamesMine, layout, bandOffered, autoScroll, beatCounts, doublePage, referencePitch, barPins], () => {
		// A visitor's browser storage is read anew on every opening already.
		if (!local()) {
			changedInPage = currentValues()
		}
		if (saveTimer) {
			clearTimeout(saveTimer)
		}
		saveTimer = setTimeout(save, SAVE_DELAY_MS)
	})

	function currentValues() {
		return {
			highlightColor: highlightColor.value,
			highlightMode: highlightMode.value,
			stereoMyPart: stereoMyPart.value,
			noteTheme: noteTheme.value,
			noteNames: noteNames.value,
			noteNamesMine: noteNamesMine.value,
			layout: layout.value,
			bandOffered: bandOffered.value,
			autoScroll: autoScroll.value,
			beatCounts: beatCounts.value,
			doublePage: doublePage.value,
			referencePitch: referencePitch.value,
			barPins: barPins.value,
		}
	}

	async function save() {
		saveTimer = null
		const values = currentValues()
		if (local()) {
			writeGuest(GUEST_KEYS.prefs, values)
			return
		}
		try {
			await axios.post(generateUrl('/apps/scoreview/api/preferences'), values)
		} catch (err) {
			// Bewusst nur ins Log: Die Einstellung wirkt im geoeffneten Viewer
			// bereits, sie ist nur nicht ueber die Sitzung hinaus gemerkt. Ein
			// Fehlerbanner ueber der Partitur waere fuer diesen Verlust zu
			// laut - und stuende ausgerechnet dann da, wenn jemand gerade
			// singt.
			// eslint-disable-next-line no-console
			console.error('ScoreView: could not save the display setting.', err)
		}
	}

	return { highlightColor, highlightMode, stereoMyPart, noteTheme, resolvedNoteTheme, highlightStyle, noteNames, noteNamesMine, layout, bandOffered, autoScroll, beatCounts, doublePage, referencePitch, barPins }
}

/**
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @return {string}
 */
function oneOf(value, allowed) {
	return allowed.includes(value) ? value : allowed[0]
}

/**
 * @return {boolean} ob der Grund der Nextcloud-Oberflaeche dunkel ist
 */
function leseThemeDunkel() {
	try {
		const ausIds = themeIsDarkFromIds(
			document.body?.dataset?.themes,
			window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false,
		)
		if (ausIds !== null) {
			return ausIds
		}
		const wert = getComputedStyle(document.body).getPropertyValue('--color-main-background')
		return isDarkBackground(wert)
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
 * With `local`, what this browser kept wins over the delivered defaults.
 * Read through the same normalisation as the server's values, so a stale or
 * tampered entry falls back like an unknown value from a newer server.
 *
 * With an account, what a viewer changed in this page wins (changedInPage): the
 * initial state is the copy from when the Files page loaded, and Files opens
 * one score after the other without reloading.
 *
 * @param {boolean} local
 * @return {{highlightColor?: string, highlightMode?: string, stereoMyPart?: boolean, noteTheme?: string}}
 */
function leseAnfangszustand(local) {
	const anfang = readInitialState('viewer-preferences') ?? {}
	const kept = local ? readGuest(GUEST_KEYS.prefs) : null
	const merged = kept !== null && typeof kept === 'object' && !Array.isArray(kept) ? { ...anfang, ...kept } : anfang
	return local || changedInPage === null ? merged : { ...merged, ...changedInPage }
}
