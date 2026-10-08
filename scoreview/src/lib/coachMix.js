// Coach (H4): die eigene Stimme als Klavier, laut und rechts, die uebrigen
// leise und links - die Mischung, mit der Carus music das Ueben bewirbt.
// Rein, ohne Player: useMyPartSound.js gibt das Ergebnis an den Player,
// und der Export (exportPlan.js) rechnet mit derselben Funktion, damit der
// Track so klingt wie der Viewer.
//
// Bewusst nur eine Zusammenstellung vorhandener Bausteine: Fokus-Lautstaerke
// (mixerLayout.js) und Panorama (panLayout.js). Coach ist kein vierter
// Mischzustand, sondern ein Preset darueber.

import { computeVoiceFocusVolumes } from './mixerLayout.js'
import { PAN_MINE, PAN_OTHERS } from './panLayout.js'

/** GM-Programm 0, Acoustic Grand Piano - das Klavier aus der Chorprobe. */
export const COACH_PROGRAM = 0

/** Vorgabe fuer den Regler „andere Stimmen" - der bisherige feste Wert. */
export const DEFAULT_OTHERS_LEVEL = 40

/**
 * @param {object} input
 * @param {number[]} input.channels alle Kanaele des Mixers
 * @param {?number[]} input.myChannels Kanaele der eigenen Stimme
 * @param {number} [input.othersLevel] 0..127, Lautstaerke der uebrigen
 * @param {Map<number, number>} [input.programs] die Programme ohne Coach -
 *   die uebrigen Stimmen behalten ihr Instrument
 * @return {?{volumes: Map<number, number>, pans: Map<number, number>, programs: Map<number, number>}}
 *   null ohne eigene Stimme: Coach ohne „meine Stimme" haette nichts
 *   hervorzuheben, und alles leise waere nur leiser.
 */
export function coachMix({ channels, myChannels, othersLevel = DEFAULT_OTHERS_LEVEL, programs = new Map() }) {
	if (!myChannels || myChannels.length === 0) {
		return null
	}
	const mine = new Set(myChannels)
	const volumes = computeVoiceFocusVolumes(channels, myChannels, { loud: 127, quiet: clampLevel(othersLevel) })
	const pans = new Map()
	const progs = new Map()
	for (const channel of channels) {
		pans.set(channel, mine.has(channel) ? PAN_MINE : PAN_OTHERS)
		progs.set(channel, mine.has(channel) ? COACH_PROGRAM : (programs.get(channel) ?? null))
	}
	return { volumes, pans, programs: progs }
}

/**
 * Welche Programme beim Ausschalten zurueckgesetzt werden muessen: genau die,
 * die Coach veraendert hat. So bleibt eine Instrumentenwahl, die jemand
 * WAEHREND Coach fuer eine andere Stimme im Mixer getroffen hat, erhalten.
 *
 * @param {Map<number, ?number>} before Programme vor dem Einschalten
 * @param {Map<number, ?number>} coach Programme unter Coach
 * @return {Map<number, number>} channel -> wiederherzustellendes Programm
 */
export function programsToRestore(before, coach) {
	const restore = new Map()
	for (const [channel, program] of coach) {
		const old = before.get(channel)
		if (program === COACH_PROGRAM && old !== undefined && old !== null && old !== COACH_PROGRAM) {
			restore.set(channel, old)
		}
	}
	return restore
}

/**
 * @param {unknown} level
 * @return {number} 0..127, ungueltig -> Vorgabe
 */
export function clampLevel(level) {
	const n = Number(level)
	if (!Number.isFinite(n)) {
		return DEFAULT_OTHERS_LEVEL
	}
	return Math.min(127, Math.max(0, Math.round(n)))
}
