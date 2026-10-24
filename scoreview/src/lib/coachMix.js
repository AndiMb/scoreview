// Coach (H4): die eigene Stimme als Klavier, laut und rechts, die uebrigen
// leise und links - die Mischung, mit der Carus music das Ueben bewirbt.
// Rein, ohne Player: useMyPartSound.js gibt das Ergebnis an den Player,
// und der Export (exportPlan.js) rechnet mit derselben Funktion, damit der
// Track so klingt wie der Viewer.
//
// Bewusst nur eine Zusammenstellung vorhandener Bausteine: Fokus-Lautstaerke
// (mixState.js) und Panorama (panLayout.js). Coach ist kein vierter
// Mischzustand, sondern ein Preset darueber.

import { clampLevel, DEFAULT_OTHERS_LEVEL, focusVolumes } from './mixState.js'
import { PAN_MINE, PAN_OTHERS } from './panLayout.js'

export { clampLevel, DEFAULT_OTHERS_LEVEL }

/** GM-Programm 0, Acoustic Grand Piano - das Klavier aus der Chorprobe. */
export const COACH_PROGRAM = 0

/**
 * @param {object} input
 * @param {number[]} input.channels alle Kanaele des Mixers
 * @param {?number[]} input.myChannels Kanaele der eigenen Stimme
 * @param {number} [input.othersLevel] 0..127, Lautstaerke der uebrigen
 * @param {Map<number, number>} [input.programs] die Programme ohne Coach -
 *   die uebrigen Stimmen behalten ihr Instrument
 * @param {Map<number, number>} [input.baseVolumes] channel -> CC7 of the
 *   score; the levels are relative to it (mixState.js)
 * @return {?{volumes: Map<number, number>, pans: Map<number, number>, programs: Map<number, number>}}
 *   null ohne eigene Stimme: Coach ohne „meine Stimme" haette nichts
 *   hervorzuheben, und alles leise waere nur leiser.
 */
export function coachMix({ channels, myChannels, othersLevel = DEFAULT_OTHERS_LEVEL, programs = new Map(), baseVolumes = new Map() }) {
	if (!myChannels || myChannels.length === 0) {
		return null
	}
	const mine = new Set(myChannels)
	const volumes = focusVolumes({ channels, myChannels, othersLevel, baseVolumes })
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
