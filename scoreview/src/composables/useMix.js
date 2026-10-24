import { computed, shallowRef, watch } from 'vue'
import { createMixState, effectiveVolumes, focusForPart, withChannels, withFocus } from '../lib/mixState.js'

/**
 * The one mix of the viewer: mixer rows, "my part" and the wait mode all
 * change this state, and only this state reaches the synthesizer.
 *
 * It lives as long as the player, not as long as the mixer panel, and the
 * levels are applied the moment a player exists. A panel with its own copy
 * would show "full" after every opening while the synthesizer kept the
 * score's CC7, or whatever was set before the panel closed (issue #17); this
 * way the panel only shows what is heard (ScoreMixer.vue).
 *
 * The coach is not a state of its own here: it needs "my part", and "my part"
 * already sets the levels. What it adds - piano, left and right - stays in
 * useMyPartSound.js.
 *
 * @param {object} deps
 * @param {() => boolean} deps.hasRealPlayer
 * @param {import('vue').Ref<Array>} deps.mixerChannels usePlayback, a new array per player
 * @param {() => Map<number, number>} deps.baseVolumes channel -> CC7 of the score
 * @param {() => ?string} deps.myPartId
 * @param {() => number} deps.othersLevel 0..127
 * @param {(volumes: Map<number, number>) => void} deps.applyChannelVolumes
 * @param {(change: {channel: number, program: number}) => void} deps.setProgram
 */
export function useMix({ hasRealPlayer, mixerChannels, baseVolumes, myPartId, othersLevel, applyChannelVolumes, setProgram }) {
	const state = shallowRef(createMixState([]))
	// A row without a part id (fallback in resolveMixerGroups) can still be
	// brought forward, it only cannot be remembered as "my part".
	const localFocus = shallowRef(null)
	// Channels held silent from outside - the wait mode keeps "my part" quiet
	// without forgetting its level.
	const silenced = shallowRef(new Set())

	function currentFocus() {
		return focusForPart(mixerChannels.value, myPartId()) ?? localFocus.value
	}

	// A new player starts with the score's mix. The new array is the signal:
	// usePlayback replaces it for every player it creates.
	watch(mixerChannels, (channels) => {
		localFocus.value = null
		state.value = withFocus(createMixState(channels), focusForPart(channels, myPartId()), othersLevel())
	}, { immediate: true })

	watch(() => [myPartId(), othersLevel()], () => {
		state.value = withFocus(state.value, currentFocus(), othersLevel())
	})

	const volumes = computed(() => effectiveVolumes(state.value, baseVolumes() ?? new Map(), silenced.value))

	// Immediately as well: every channel gets its value - and with it the lock
	// against the file's CC7 (player.js) - before the first note, not only
	// after a slider moved. After the other watchers ('post'): a new player
	// brings `hasRealPlayer` and its real channels in one tick, and applied
	// before the state was rebuilt, the approximated channels went out first
	// (measured: CC7 for channels 0-4, then for the real 0-3 and 6).
	watch([volumes, hasRealPlayer], ([next, real]) => {
		if (real) {
			applyChannelVolumes(next)
		}
	}, { immediate: true, flush: 'post' })

	/**
	 * @param {number[]} channels
	 * @param {number} level 0..1
	 */
	function setLevel(channels, level) {
		state.value = withChannels(state.value, channels, { level })
	}

	/**
	 * @param {number[]} channels a row; its first channel speaks for all
	 */
	function toggleMute(channels) {
		state.value = withChannels(state.value, channels, { muted: !state.value.channels[channels[0]]?.muted })
	}

	/**
	 * @param {number[]} channels
	 */
	function toggleSolo(channels) {
		state.value = withChannels(state.value, channels, { solo: !state.value.channels[channels[0]]?.solo })
	}

	/**
	 * The voice symbol of a mixer row: focus on it, or off again. A row with a
	 * part becomes "my part" - the levels then follow through `myPartId`, the
	 * same way as a choice in the bar or one loaded from the server. Saving
	 * that choice is the viewer's (useMyPart.js), so this only says what to
	 * save.
	 *
	 * @param {{key: string, partId: ?string, channels: number[]}} group
	 * @return {?string|undefined} the part to make "my part", null for none,
	 *   undefined to leave it as it is
	 */
	function toggleFocus(group) {
		const hasPart = myPartId() !== null
		if (state.value.focusKey === group.key) {
			localFocus.value = null
		} else if (group.partId !== null && group.partId !== undefined) {
			localFocus.value = null
			return group.partId
		} else {
			localFocus.value = { key: group.key, channels: group.channels }
		}
		if (hasPart) {
			// The watcher on myPartId applies the local focus, or none.
			return null
		}
		state.value = withFocus(state.value, localFocus.value, othersLevel())
		return undefined
	}

	/**
	 * @param {{channel: number, program: number}} change
	 */
	function changeProgram({ channel, program }) {
		state.value = withChannels(state.value, [channel], { program })
		setProgram({ channel, program })
	}

	/**
	 * @param {?number[]} channels null = none
	 */
	function silence(channels) {
		silenced.value = new Set(channels ?? [])
	}

	return { state, volumes, setLevel, toggleMute, toggleSolo, toggleFocus, changeProgram, silence }
}
