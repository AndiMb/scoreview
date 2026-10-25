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
import { measureClicks, normalizeMetronomeMode } from './metronome.js'
import { channelsOfPart } from './panLayout.js'
import { fineTuneCents } from './referencePitch.js'

/** Ausklang nach dem letzten Ton - ohne ihn bricht der Hall hart ab. */
export const TAIL_MS = 1000

/**
 * @typedef {object} ExportPlan
 * @property {Array<{channel:number, volume:number, pan:number, program:?number}>} channels Mischung je Kanal
 * @property {number} transpose Halbtoene (H6)
 * @property {number} fineTune cents against a' = 440 (lib/referencePitch.js)
 * @property {number} rate Tempofaktor (playbackRate), 1 = Original
 * @property {number} startMs Partiturzeit, ab der gerendert wird
 * @property {number} endMs Partiturzeit, bis zu der Noten zaehlen
 * @property {Array<{timeMs:number, level:0|1|2}>} clicks Metronom, Partiturzeit; level wie metronome.js (0 Eins, 1 Schlag, 2 Unterteilung)
 * @property {number} outputSeconds Laenge der Datei einschliesslich Ausklang
 */

/**
 * @param {object} input
 * @param {Map<number, number>} input.volumes channel -> 0..127, nach Mute/Solo/Fokus/Coach
 * @param {Map<number, number>} input.pans channel -> -1..1
 * @param {Map<number, ?number>} [input.programs] channel -> GM-Programm (null = wie im MIDI)
 * @param {number} [input.transpose]
 * @param {number} [input.referencePitch] a' in Hz
 * @param {number} [input.rate]
 * @param {?{fromMs:number, toMs:number}} [input.range] nur dieser Bereich (Loop)
 * @param {?{mode?:'downbeat'|'all'|'eighths', everyBeat?:boolean}} [input.metronome] null = ohne Klick; `everyBeat` ist die Form vor 1.16
 * @param {?{events:Array<{timeMs:number, elid?:number}>}} [input.measures] measures.json als Timeline
 * @param {?Array<object>} [input.meters] the meter per displayed measure (scoreFacts.metersFromArtifacts), indexed by elid; null = estimate the beats
 * @param {number} input.durationMs Ende des Stuecks
 * @param {number} [input.baseBpm] Viertel-BPM der Partitur (fuer die Schlagzahl)
 * @return {ExportPlan}
 */
export function buildExportPlan({ volumes, pans, programs = new Map(), transpose = 0, referencePitch = 440, rate = 1, range = null, metronome = null, measures = null, meters = null, durationMs, baseBpm = 120 }) {
	const channels = [...volumes.keys()].sort((a, b) => a - b).map((channel) => ({
		channel,
		volume: volumes.get(channel) ?? 100,
		pan: pans.get(channel) ?? 0,
		program: programs.get(channel) ?? null,
	}))
	const r = rate > 0 ? rate : 1
	const startMs = Math.max(0, range ? range.fromMs : 0)
	const endMs = Math.min(durationMs, range ? range.toMs : durationMs)
	const clicks = metronome ? clickTimes(measures, startMs, endMs, durationMs, baseBpm, normalizeMetronomeMode(metronome.mode ?? metronome.everyBeat), meters) : []
	return {
		channels,
		transpose: Math.trunc(transpose) || 0,
		fineTune: fineTuneCents(referencePitch),
		rate: r,
		startMs,
		endMs,
		clicks,
		outputSeconds: ((endMs - startMs) / r + TAIL_MS) / 1000,
	}
}

/**
 * Dieselben Klicks, die das Metronom im Viewer klickt (metronome.js,
 * measureClicks): je Takt dieselbe Schlagzahl und Unterteilung, gleichmaessig
 * verteilt, mit derselben Stufe je Klick.
 *
 * @param {?{events:Array<{timeMs:number}>}} measures
 * @param {number} startMs
 * @param {number} endMs
 * @param {number} durationMs
 * @param {number} baseBpm
 * @param {'downbeat'|'all'|'eighths'} mode
 * @param {?Array<object>} meters per displayed measure (elid), or null
 * @return {Array<{timeMs:number, level:0|1|2}>}
 */
function clickTimes(measures, startMs, endMs, durationMs, baseBpm, mode, meters) {
	const events = measures?.events ?? []
	const clicks = []
	for (let i = 0; i < events.length; i++) {
		const from = events[i].timeMs
		const to = i + 1 < events.length ? events[i + 1].timeMs : durationMs
		if (!(to > from) || to <= startMs || from >= endMs) {
			continue
		}
		// The same measure plays in every unrolled pass; its meter is keyed by
		// the displayed measure (elid), not by the pass.
		const meter = meters?.[events[i].elid] ?? null
		for (const click of measureClicks(from, to, baseBpm, mode, meter)) {
			if (click.timeMs >= startMs && click.timeMs < endMs) {
				clicks.push(click)
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
 * @param {Map<number, number>} [input.baseVolumes] CC7 of the score, see mixState.js
 * @param {object} input.base die uebrigen Eingaben fuer buildExportPlan
 * @return {Array<{partId:string, name:string, plan:ExportPlan}>}
 */
export function plansForAllParts({ mixerChannels, parts, othersLevel, programs = new Map(), baseVolumes = new Map(), base }) {
	const all = mixerChannels.map((ch) => ch.channel)
	const result = []
	for (const part of parts) {
		const mine = channelsOfPart(mixerChannels, part.partId)
		const mix = coachMix({ channels: all, myChannels: mine, othersLevel, programs, baseVolumes })
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
