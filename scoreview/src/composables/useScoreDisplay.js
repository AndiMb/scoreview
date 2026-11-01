import { computed } from 'vue'
import { translate } from '../l10n.js'
import { unavailableReason } from '../lib/capabilities.js'
import { countLabels } from '../lib/countLabels.js'
import { noteNameStaves as stavesForNames } from '../lib/noteNameSystem.js'
import { MIN_SPREAD_WIDTH_PX, spreadMode as spreadModeOf } from '../lib/spreadLayout.js'

/**
 * What the picture on screen can show, and what it shows now: the layout,
 * two pages side by side, note names and beat counts - each with the reason
 * in words when a choice cannot be honoured (N3), so that nobody looks for
 * a switch that never acts. The viewer and its bar (ViewerBar.vue) read the
 * same answers here.
 *
 * Built on the capabilities of the artefacts (E15, lib/capabilities.js) and
 * the user's preferences; the rules themselves live in lib/.
 *
 * @param {object} deps
 * @param {() => object} deps.capabilities capabilitiesOf() of the picture
 * @param {() => ?object} deps.pictureMeta the meta of the picture on screen
 * @param {object} deps.preferences useViewerPreferences()
 * @param {() => Array} deps.meters the meter per measure (useScoreFacts)
 * @param {() => ?number} deps.myPartIndex my part among the picture's parts
 * @param {() => boolean} deps.staffMappingOk whether staves map to parts
 * @param {() => number} deps.pagesWidthPx the width of the page area
 * @return {object}
 */
export function useScoreDisplay({ capabilities, pictureMeta, preferences, meters, myPartIndex, staffMappingOk, pagesWidthPx }) {
	const t = (text, vars) => translate('scoreview', text, vars)

	/**
	 * @param {'lyrics'|'noteNames'|'counts'} feature
	 * @return {string} why the feature is not there, or empty
	 */
	function unavailable(feature) {
		const reason = unavailableReason(capabilities(), feature, pictureMeta())
		switch (reason) {
			case null:
				return ''
			case 'no-lyrics':
				return t('This score has no lyrics.')
			case 'too-large':
				return t('This score has too much text for the lyrics view.')
			default:
				return t('These pages were set without the data this view needs. A reconversion on this server cannot add it.')
		}
	}

	/** Warum es keine Liedtext-Ansicht gibt - oder leer. */
	const lyricsUnavailable = computed(() => unavailable('lyrics'))
	/** Warum es keine Tonnamen gibt - oder leer. */
	const noteNamesUnavailable = computed(() => unavailable('noteNames'))
	/** Why there are no beat numbers - or empty. */
	const countsUnavailable = computed(() => unavailable('counts'))

	/** Die Darstellung, die gezeigt wird: die gewaehlte, wenn sie geht. */
	const activeLayout = computed(() => {
		const layout = preferences.layout.value
		return layout === 'lyrics' && lyricsUnavailable.value !== '' ? 'pages' : layout
	})

	/** Two pages side by side now: 'off' | 'left' | 'right' (lib/spreadLayout.js). */
	const spreadMode = computed(() => spreadModeOf(preferences.doublePage.value, activeLayout.value, pagesWidthPx()))

	/** Why the chosen spread does not show right now, or empty. */
	const spreadUnavailable = computed(() => {
		if (preferences.doublePage.value === 'off' || spreadMode.value !== 'off') {
			return ''
		}
		if (activeLayout.value !== 'pages') {
			return t('Only in the page view.')
		}
		return t('Needs a page area at least {px} px wide - this one is narrower.', { px: MIN_SPREAD_WIDTH_PX })
	})

	/** Das System, das die Seiten zeichnen, oder null (aus/nicht moeglich). */
	const noteNameSystem = computed(() => {
		const names = preferences.noteNames.value
		return names !== 'off' && noteNamesUnavailable.value === '' ? names : null
	})

	/** Nur die Zeile der eigenen Stimme - wo sich Zeilen Stimmen zuordnen lassen. */
	const noteNameStaves = computed(() => stavesForNames(preferences.noteNamesMine.value, myPartIndex(), staffMappingOk()))

	/**
	 * The count of every chord (lib/countLabels.js), built once per score
	 * and setting, or null while the numbers are off.
	 */
	const countOfElid = computed(() => {
		if (preferences.beatCounts.value === 'off' || countsUnavailable.value !== '') {
			return null
		}
		return countLabels({ meters: meters(), spellings: pictureMeta()?.noteSpellings })
	})

	/** Only my staff - where staves map to parts, as for the note names. */
	const countStaves = computed(() => stavesForNames(preferences.beatCounts.value === 'mine', myPartIndex(), staffMappingOk()))

	return {
		lyricsUnavailable,
		noteNamesUnavailable,
		countsUnavailable,
		activeLayout,
		spreadMode,
		spreadUnavailable,
		noteNameSystem,
		noteNameStaves,
		countOfElid,
		countStaves,
	}
}
