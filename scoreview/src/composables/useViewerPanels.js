import { computed, ref } from 'vue'

/**
 * The cards over the score, by the id of the bar tool that opens them
 * (lib/barGroups.js PINNABLE, kind 'panel').
 */
export const PANELS = Object.freeze(['mixer', 'partChoice', 'annotations', 'rehearsal', 'recording', 'tuner', 'practiceLog', 'sing'])

/**
 * Which cards over the score are open - one place the viewer reads, instead
 * of a boolean per card spread over setup refs, data() and composables. The
 * bar's tools, the card list, performance mode and reset() all go through
 * these ids, so a new card is added here once and nowhere else by hand.
 *
 * A composable that owns the flag of its card (useAnnotations closes its
 * card on reset) hands it in through `adopt`; that ref then is the state,
 * not a copy of it.
 *
 * Open and shown differ where a card needs something to show: the mixer
 * needs sound and channels, the part choice needs parts. Opened without,
 * it stays open and appears when that comes (`shownIf`).
 *
 * @param {object} [deps]
 * @param {Record<string, import('vue').Ref<boolean>>} [deps.adopt] flags
 *   owned elsewhere, by panel id
 * @param {Record<string, () => boolean>} [deps.shownIf] what a card needs
 *   besides being open, by panel id
 * @return {object}
 */
export function useViewerPanels({ adopt = {}, shownIf = {} } = {}) {
	const flags = Object.fromEntries(PANELS.map((id) => [id, adopt[id] ?? ref(false)]))

	/** The ids of the open cards, in PANELS order. */
	const open = computed(() => PANELS.filter((id) => flags[id].value))

	/**
	 * @param {string} id
	 * @return {boolean}
	 */
	function isOpen(id) {
		return flags[id]?.value === true
	}

	/**
	 * @param {string} id
	 * @return {boolean} open and with something to show
	 */
	function shown(id) {
		return isOpen(id) && (shownIf[id]?.() ?? true)
	}

	/** Whether any card is on screen - for the container around them. */
	const anyShown = computed(() => open.value.some(shown))

	/**
	 * @param {string} id
	 * @param {boolean} on
	 */
	function set(id, on) {
		if (flags[id]) {
			flags[id].value = on
		}
	}

	/** @param {string} id */
	function toggle(id) {
		set(id, !isOpen(id))
	}

	/** @param {string} id */
	function close(id) {
		set(id, false)
	}

	/** @param {string[]} [ids] the cards to close; all by default */
	function closeAll(ids = PANELS) {
		for (const id of ids) {
			close(id)
		}
	}

	return { open, anyShown, isOpen, shown, set, toggle, close, closeAll }
}
