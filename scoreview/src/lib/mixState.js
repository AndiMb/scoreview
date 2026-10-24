// The mixer's state and what it makes the synthesizer play - pure, without
// Vue or a player (useMix.js holds it, ScoreMixer.vue shows it).
//
// **100 % is the score's mix.** A level is a factor on the volume the part
// starts with in score.mid (midiNotes.js, channelVolumes) - the balance set in
// MuseScore's own mixer. Measured: MuseScore writes CC7 = 100 there for every
// part, not 127. With absolute values, an untouched part played at 100 while
// one whose slider had been moved once played at 127, all sliders showing
// "full" (issue #17). Louder than the score is deliberately not offered: above
// 100 there are only 2 dB left, and "100 % = as written" would no longer hold.
//
// The state is replaced, never changed in place: Vue then sees every change
// through one shallowRef, and a test can compare before and after.

import { DEFAULT_CHANNEL_VOLUME } from './midiNotes.js'
import { resolveMixerGroups } from './mixerLayout.js'

/**
 * @typedef {{level:number, muted:boolean, solo:boolean, program:number}} ChannelMix
 *   level 0..1 relative to the score
 * @typedef {{channels: Object<number, ChannelMix>, focusKey: ?string}} MixState
 *   focusKey: the mixer row of "my part", or null
 * @typedef {{key:string, channels:number[]}} Focus
 */

/** Default of the "other parts" slider (H4), 0..127. */
export const DEFAULT_OTHERS_LEVEL = 40

/**
 * @param {unknown} level
 * @return {number} 0..127, rounded; anything invalid gives the default
 */
export function clampLevel(level) {
	const n = Number(level)
	if (!Number.isFinite(n)) {
		return DEFAULT_OTHERS_LEVEL
	}
	return Math.min(127, Math.max(0, Math.round(n)))
}

/**
 * Everything at the score's mix, nothing muted.
 *
 * @param {Array<{channel:number, program?:number}>} channels see mixerLayout.js
 * @return {MixState}
 */
export function createMixState(channels) {
	return {
		channels: Object.fromEntries(channels.map((ch) => [ch.channel, { level: 1, muted: false, solo: false, program: ch.program ?? 0 }])),
		focusKey: null,
	}
}

/**
 * The level of the parts that are not "mine", from the "other parts" slider
 * (H4, 0..127). Relative like every level: with the default 40 the others keep
 * a third of their volume, about -10 dB, as they always did against 127.
 *
 * @param {number} othersLevel
 * @return {number} 0..1
 */
export function othersFactor(othersLevel) {
	return clampLevel(othersLevel) / 127
}

/**
 * "My part" as a mixer row: the group whose part id matches. Compared as
 * text - the server sends text, meta.json numbers.
 *
 * @param {Array} channels see mixerLayout.js
 * @param {?string|number} partId
 * @return {?Focus} null without a part, or for a part no row plays
 */
export function focusForPart(channels, partId) {
	if (partId === null || partId === undefined) {
		return null
	}
	const group = resolveMixerGroups(channels).find((g) => g.partId !== null && g.partId !== undefined && String(g.partId) === String(partId))
	return group ? { key: group.key, channels: group.channels } : null
}

/**
 * Focus on a row, or none: the focused channels at the score's mix, all
 * others at the "other parts" level. Without focus all levels go back to the
 * score's mix. Mute and solo stay - the focus is an own intervention on the
 * levels, which is why a quiet part can still be muted on top.
 *
 * @param {MixState} state
 * @param {?Focus} focus
 * @param {number} othersLevel 0..127
 * @return {MixState}
 */
export function withFocus(state, focus, othersLevel) {
	const mine = new Set(focus?.channels ?? [])
	const quiet = othersFactor(othersLevel)
	const channels = {}
	for (const [channel, mix] of Object.entries(state.channels)) {
		const level = focus === null || mine.has(Number(channel)) ? 1 : quiet
		channels[channel] = { ...mix, level }
	}
	return { channels, focusKey: focus?.key ?? null }
}

/**
 * One field of some channels - the mixer changes a row, i.e. all channels of
 * a group (divisi) alike.
 *
 * @param {MixState} state
 * @param {number[]} channels
 * @param {Partial<ChannelMix>} change
 * @return {MixState}
 */
export function withChannels(state, channels, change) {
	const next = { ...state.channels }
	for (const channel of channels) {
		if (next[channel]) {
			next[channel] = { ...next[channel], ...change }
		}
	}
	return { ...state, channels: next }
}

/**
 * @param {number} base CC7 of the score, 0..127
 * @param {number} level 0..1
 * @return {number} 0..127
 */
export function scaledVolume(base, level) {
	return Math.min(127, Math.max(0, Math.round(base * level)))
}

/**
 * What the synthesizer gets per channel. As soon as one channel is solo, only
 * solo channels that are not muted are heard; without solo each channel's own
 * mute decides.
 *
 * @param {MixState} state
 * @param {Map<number, number>} baseVolumes channel -> CC7 of the score
 * @param {Set<number>} [silenced] channels held silent from outside (wait mode)
 * @return {Map<number, number>} channel -> CC7, 0..127
 */
export function effectiveVolumes(state, baseVolumes, silenced = new Set()) {
	const entries = Object.entries(state.channels)
	const anySolo = entries.some(([, mix]) => mix.solo)
	const result = new Map()
	for (const [key, mix] of entries) {
		const channel = Number(key)
		const audible = !silenced.has(channel) && (anySolo ? (mix.solo && !mix.muted) : !mix.muted)
		result.set(channel, audible ? scaledVolume(baseVolumes.get(channel) ?? DEFAULT_CHANNEL_VOLUME, mix.level) : 0)
	}
	return result
}

/**
 * "My part" loud, the others quiet, as volumes - for the coach and the export
 * of a track per part (exportPlan.js), which have no mixer state of their own.
 *
 * @param {object} input
 * @param {number[]} input.channels
 * @param {number[]} input.myChannels
 * @param {number} input.othersLevel 0..127
 * @param {Map<number, number>} [input.baseVolumes] channel -> CC7 of the score
 * @return {Map<number, number>}
 */
export function focusVolumes({ channels, myChannels, othersLevel, baseVolumes = new Map() }) {
	const state = withFocus(createMixState(channels.map((channel) => ({ channel }))), { key: '', channels: myChannels }, othersLevel)
	return effectiveVolumes(state, baseVolumes)
}
