// Der Plan fuer einen Uebe-Track (H1/H10): was der Render-Worker abspielen,
// mischen und anklicken soll. Rein - der Worker (render-worker.js) fuehrt
// nur aus, was hier steht, und der Plan entsteht aus denselben Werten, die
// der Viewer gerade an den Player gibt. Der Track klingt deshalb wie das,
// was man eben gehoert hat (Entwurf V3).
//
// Zeiten: Alles in Partiturzeit (ms ohne Tempofaktor, wie timing.json und
// measures.json). Erst der Worker rechnet mit `rate` in Ausgabezeit um - an
// genau einer Stelle, wie der Player mit playbackRate.

import { coachMix } from './coachMix.js'
import { estimateBeatsInMeasure } from './metronome.js'
import { channelsOfPart } from './panLayout.js'

/** Ausklang nach dem letzten Ton - ohne ihn bricht der Hall hart ab. */
export const TAIL_MS = 1000

/**
 * @typedef {object} ExportPlan
 * @property {Array<{channel:number, volume:number, pan:number, program:?number}>} channels Mischung je Kanal
 * @property {number} transpose Halbtoene (H6)
 * @property {number} rate Tempofaktor (playbackRate), 1 = Original
 * @property {number} startMs Partiturzeit, ab der gerendert wird
 * @property {number} endMs Partiturzeit, bis zu der Noten zaehlen
 * @property {Array<{timeMs:number, accent:boolean}>} clicks Metronom, Partiturzeit
 * @property {number} outputSeconds Laenge der Datei einschliesslich Ausklang
 */

/**
 * @param {object} input
 * @param {Map<number, number>} input.volumes channel -> 0..127, nach Mute/Solo/Fokus/Coach
 * @param {Map<number, number>} input.pans channel -> -1..1
 * @param {Map<number, ?number>} [input.programs] channel -> GM-Programm (null = wie im MIDI)
 * @param {number} [input.transpose]
 * @param {number} [input.rate]
 * @param {?{fromMs:number, toMs:number}} [input.range] nur dieser Bereich (Loop)
 * @param {?{everyBeat:boolean}} [input.metronome] null = ohne Klick
 * @param {?{events:Array<{timeMs:number}>}} [input.measures] measures.json als Timeline
 * @param {number} input.durationMs Ende des Stuecks
 * @param {number} [input.baseBpm] Viertel-BPM der Partitur (fuer die Schlagzahl)
 * @return {ExportPlan}
 */
export function buildExportPlan({ volumes, pans, programs = new Map(), transpose = 0, rate = 1, range = null, metronome = null, measures = null, durationMs, baseBpm = 120 }) {
	const channels = [...volumes.keys()].sort((a, b) => a - b).map((channel) => ({
		channel,
		volume: volumes.get(channel) ?? 100,
		pan: pans.get(channel) ?? 0,
		program: programs.get(channel) ?? null,
	}))
	const r = rate > 0 ? rate : 1
	const startMs = Math.max(0, range ? range.fromMs : 0)
	const endMs = Math.min(durationMs, range ? range.toMs : durationMs)
	const clicks = metronome ? clickTimes(measures, startMs, endMs, durationMs, baseBpm, metronome.everyBeat) : []
	return {
		channels,
		transpose: Math.trunc(transpose) || 0,
		rate: r,
		startMs,
		endMs,
		clicks,
		outputSeconds: ((endMs - startMs) / r + TAIL_MS) / 1000,
	}
}

/**
 * Dieselben Schlaege, die das Metronom im Viewer klickt (metronome.js):
 * je Takt die aus Dauer und Tempo geschaetzte Schlagzahl, gleichmaessig
 * verteilt, die Eins betont.
 *
 * @param {?{events:Array<{timeMs:number}>}} measures
 * @param {number} startMs
 * @param {number} endMs
 * @param {number} durationMs
 * @param {number} baseBpm
 * @param {boolean} everyBeat
 * @return {Array<{timeMs:number, accent:boolean}>}
 */
function clickTimes(measures, startMs, endMs, durationMs, baseBpm, everyBeat) {
	const events = measures?.events ?? []
	const clicks = []
	for (let i = 0; i < events.length; i++) {
		const from = events[i].timeMs
		const to = i + 1 < events.length ? events[i + 1].timeMs : durationMs
		if (!(to > from) || to <= startMs || from >= endMs) {
			continue
		}
		const beats = everyBeat ? estimateBeatsInMeasure(to - from, baseBpm) : 1
		const beatMs = (to - from) / beats
		for (let b = 0; b < beats; b++) {
			const t = from + b * beatMs
			if (t >= startMs && t < endMs) {
				clicks.push({ timeMs: t, accent: b === 0 })
			}
		}
	}
	return clicks
}

/**
 * Die Plaene fuer „Tracks fuer alle Stimmen" (H10): je Stimme ein Coach-Plan,
 * sonst wie der Basisplan (Tempo, Transposition, Metronom). Eine Stimme ohne
 * eigenen Kanal (sollte es nicht geben) faellt weg.
 *
 * @param {object} input
 * @param {Array<{channel:number, partId:?string, name:string}>} input.mixerChannels
 * @param {Array<{partId:string, name:string}>} input.parts Stimmen in Reihenfolge
 * @param {number} input.othersLevel
 * @param {Map<number, number>} [input.programs] Programme ohne Coach
 * @param {object} input.base die uebrigen Eingaben fuer buildExportPlan
 * @return {Array<{partId:string, name:string, plan:ExportPlan}>}
 */
export function plansForAllParts({ mixerChannels, parts, othersLevel, programs = new Map(), base }) {
	const all = mixerChannels.map((ch) => ch.channel)
	const result = []
	for (const part of parts) {
		const mine = channelsOfPart(mixerChannels, part.partId)
		const mix = coachMix({ channels: all, myChannels: mine, othersLevel, programs })
		if (mix === null) {
			continue
		}
		result.push({
			partId: part.partId,
			name: part.name,
			plan: buildExportPlan({ ...base, volumes: mix.volumes, pans: mix.pans, programs: mix.programs }),
		})
	}
	return result
}
