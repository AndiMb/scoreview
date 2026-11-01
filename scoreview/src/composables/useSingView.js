import { computed, ref } from 'vue'
import { translate } from '../l10n.js'
import { buildLyrics } from '../lib/lyricsLayout.js'
import { syllableIndex, syllablesIn } from '../lib/singLane.js'
import { readStored, writeStored } from '../lib/storage.js'

// The view of the singing lane (E24) is a matter of the device - a stage on a
// phone, a band on a tablet - so it stays in this browser.
const VIEW_KEY = 'scoreview.singView'

/**
 * What the singing lane (E24) shows besides the judged notes: its view, my
 * syllables for the stage, and the names of level and stretch on its card.
 * The judging itself is useSingScore.js.
 *
 * @param {object} deps
 * @param {() => ?object} deps.pictureMeta the meta of the picture on screen
 * @param {() => ?number[]} deps.myStaves my staff where staves map to parts
 * @param {() => ?object} deps.timeline
 * @param {() => {active: boolean, from: number, to: number}} deps.loop
 * @param {() => Array<{from: number, to: number, name: string}>} deps.savedLoops
 * @param {() => string} deps.level the level of judging (useSingScore)
 * @return {object}
 */
export function useSingView({ pictureMeta, myStaves, timeline, loop, savedLoops, level }) {
	const t = (text, vars) => translate('scoreview', text, vars)

	/** 'band' under the score or 'stage' over it. */
	const view = ref(readStored(VIEW_KEY) === 'stage' ? 'stage' : 'band')

	/** @param {string} next 'band' or 'stage' */
	function setView(next) {
		view.value = next === 'stage' ? 'stage' : 'band'
		writeStored(VIEW_KEY, view.value)
	}

	/** The lyrics of my part, for the stage. */
	const lyricsBlocks = computed(() => {
		const syllables = pictureMeta()?.lyricSyllables
		if (!syllables || syllables.length === 0) {
			return []
		}
		return buildLyrics({ syllables, staves: myStaves() }).blocks
	})

	// Every sung syllable once per score and part; the lane then asks for a
	// stretch of it every frame (syllablesFor).
	const index = computed(() => {
		const events = timeline()?.events
		if (!events || lyricsBlocks.value.length === 0) {
			return null
		}
		return syllableIndex(lyricsBlocks.value, events, timeline().times)
	})

	/**
	 * The syllables of my part in a stretch of the score, for the stage.
	 *
	 * @param {number} fromMs
	 * @param {number} toMs
	 * @return {Array<{scoreMs: number, text: string}>}
	 */
	function syllablesFor(fromMs, toMs) {
		return index.value === null ? [] : syllablesIn(index.value, fromMs, toMs)
	}

	/** What the run covers: the whole piece, or the loop by name or measures. */
	const unitLabel = computed(() => {
		const range = loop()
		if (!range.active) {
			return t('Whole piece')
		}
		const from = Number(range.from)
		const to = Number(range.to)
		const named = savedLoops().find((l) => l.from === from && l.to === to && l.name)
		const measures = from === to ? t('Measure {measure}', { measure: from }) : t('Measures {from}–{to}', { from, to })
		return named ? `${named.name} (${measures})` : measures
	})

	const levelLabel = computed(() => ({ easy: t('Beginner'), choir: t('Choir'), strict: t('Strict') }[level()] ?? ''))

	return { view, setView, lyricsBlocks, syllablesFor, unitLabel, levelLabel }
}
