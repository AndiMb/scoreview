// Real recordings for the measuring rig: a converted score (the artifacts
// of converter/convert.mjs or a cache directory of the app), an audio file
// and, if already annotated, its marks.json - turned into the same shape
// tools/follow/replay.mjs builds for a synthetic case.
//
// Recordings of real rehearsals never go into the repository (voices of
// third parties); they stay under spike/ or outside. This file only reads.
//
// marks.json - an array in recording order:
//
//   {"measure": 12, "atMs": 41250}             downbeat of bar 12 heard at 41.25 s
//   {"measure": 12, "pass": 2, "atMs": 90100}  the second time through bar 12 (repeats)
//   {"type": "stop", "atMs": 52000}            singing ends here (speech, pause, end)
//   {"type": "jump", "atMs": 60000}            no stop, but the next bar does not follow on
//   {"type": "partial", "atMs": 61000, "note": "tenors alone"}   remark only
//
// Between two bar marks of the same run the score time is interpolated;
// after a run's last bar mark it runs on at the run's last tempo up to the
// stop, never beyond the next bar. Any `type` other than "partial" or "note"
// ends a run - so a jump needs no pause to be told from a fast tempo. Bar
// numbers are counted as the viewer counts them (measures.json, elid + 1);
// the bar after the last one stands for the end of the piece. Without
// `pass`, a bar inside a run is the first occurrence after the previous
// mark, a bar that starts a run the first occurrence of all.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { followParts } from '../../src/lib/followRef.js'
import { parseMidiNotes } from '../../src/lib/midiNotes.js'
import { resolveMixerChannels } from '../../src/lib/mixerLayout.js'
import { groupSystems } from '../../src/lib/pagingPlan.js'
import { decodeWav } from '../../src/lib/wavCodec.js'

/** Spacing of the truth table: finer than a tap, coarse enough for an hour. */
const TRUTH_STEP_MS = 20

/**
 * Bar starts of the played-through score, one per occurrence (repeats are
 * unrolled, M7), in score time order.
 *
 * @param {{events: Array<{elid:number, timeMs:number}>}} measuresTimeline measures.json
 * @return {Array<{measure:number, pass:number, timeMs:number}>}
 */
export function barOccurrences(measuresTimeline) {
	const seen = new Map()
	return [...(measuresTimeline?.events ?? [])]
		.sort((a, b) => a.timeMs - b.timeMs)
		.map((e) => {
			const measure = e.elid + 1
			const pass = (seen.get(measure) ?? 0) + 1
			seen.set(measure, pass)
			return { measure, pass, timeMs: e.timeMs }
		})
}

/**
 * Rows of the score as the turn policy sees them: one per system and pass,
 * in score time. Systems come from the bar rectangles the same way the
 * viewer's paging finds them (lib/pagingPlan.js).
 *
 * @param {{events: Array<{elid:number, timeMs:number}>, elements: Object<string, {page:number, y:number, h:number}>}} measuresTimeline
 * @param {number} durationMs
 * @return {Array<{fromMs:number, toMs:number, page:number, system:number}>}
 */
export function systemSlices(measuresTimeline, durationMs) {
	const elements = measuresTimeline?.elements ?? {}
	const byPage = new Map()
	for (const el of Object.values(elements)) {
		if (!byPage.has(el.page)) {
			byPage.set(el.page, [])
		}
		byPage.get(el.page).push(el)
	}
	const systemsByPage = new Map([...byPage].map(([page, rects]) => [page, groupSystems(rects)]))
	const systemOf = (elid) => {
		const el = elements[String(elid)]
		if (!el) {
			return null
		}
		const index = (systemsByPage.get(el.page) ?? []).findIndex((s) => el.y < s.bottom && el.y + el.h > s.top)
		return { page: el.page, system: index }
	}
	const slices = []
	for (const e of [...(measuresTimeline?.events ?? [])].sort((a, b) => a.timeMs - b.timeMs)) {
		const where = systemOf(e.elid)
		if (!where) {
			continue
		}
		const last = slices[slices.length - 1]
		if (last && last.page === where.page && last.system === where.system) {
			continue
		}
		if (last) {
			last.toMs = e.timeMs
		}
		slices.push({ fromMs: e.timeMs, toMs: durationMs, ...where })
	}
	return slices
}

/**
 * Everything the follower and the metrics need from a converted score.
 *
 * @param {string} dir holds score.mid, meta.json and measures.json
 * @return {{notes: object[], parts: object[], measures: object, bars: object[], measureStartsMs: number[], markersMs: number[], systemStartsMs: number[], slices: object[], durationMs: number}}
 */
export function loadScore(dir) {
	const read = (name) => readFileSync(path.join(dir, name))
	const midi = parseMidiNotes(read('score.mid'))
	const meta = JSON.parse(read('meta.json'))
	const measures = JSON.parse(read('measures.json'))
	// The player reads the channels per MIDI track (player.js
	// getTrackChannels); tracks without notes do not reach the mixer either.
	const byTrack = new Map()
	for (const n of midi.notes) {
		if (!byTrack.has(n.track)) {
			byTrack.set(n.track, new Set())
		}
		byTrack.get(n.track).add(n.channel)
	}
	const trackChannels = [...byTrack.keys()].sort((a, b) => a - b).map((t) => [...byTrack.get(t)].sort((a, b) => a - b))
	const mixer = resolveMixerChannels(meta.tracks, meta.parts, trackChannels)
	const parts = followParts(mixer, meta.parts)
	const bars = barOccurrences(measures)
	const durationMs = Math.max(midi.durationMs, bars.at(-1)?.timeMs ?? 0)
	const slices = systemSlices(measures, durationMs)
	return {
		notes: midi.notes,
		parts,
		measures,
		bars,
		measureStartsMs: bars.map((b) => b.timeMs),
		markersMs: midi.markers.map((m) => m.timeMs),
		systemStartsMs: slices.map((s) => s.fromMs),
		slices,
		durationMs,
	}
}

/**
 * Mono samples of an audio file. 16-bit WAV is read directly; anything else
 * (24-bit WAV, MP3, M4A from a phone recorder) goes through ffmpeg, which
 * must then be on the PATH.
 *
 * @param {string} file
 * @param {object} [options]
 * @param {number} [options.sampleRate] resample to this rate (ffmpeg only)
 * @return {{samples: Float32Array, sampleRate: number}}
 */
export function loadAudio(file, { sampleRate = 22050 } = {}) {
	if (/\.wav$/i.test(file)) {
		try {
			const bytes = readFileSync(file)
			return decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
		} catch {
			// Not 16-bit PCM - ffmpeg below.
		}
	}
	const run = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-'], {
		maxBuffer: 1024 * 1024 * 1024,
	})
	if (run.error || run.status !== 0) {
		throw new Error(`Cannot read ${file}: ${run.error?.message ?? run.stderr.toString().trim()} (ffmpeg needed for anything but 16-bit WAV)`)
	}
	const out = run.stdout
	const samples = new Float32Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength))
	return { samples, sampleRate }
}

/**
 * Score time of every bar mark, with runs split where the marks say so.
 *
 * @param {object[]} marks marks.json
 * @param {Array<{measure:number, pass:number, timeMs:number}>} bars from barOccurrences()
 * @param {number} durationMs end of the piece (the bar after the last)
 * @return {{runs: Array<{points: Array<{atMs:number, scoreMs:number}>, endMs: ?number}>, warnings: string[]}}
 */
export function resolveMarks(marks, bars, durationMs) {
	const warnings = []
	const lastBar = bars.reduce((max, b) => Math.max(max, b.measure), 0)
	const runs = []
	let run = null
	let previous = null
	for (const [index, mark] of marks.entries()) {
		if (mark.type === 'partial' || mark.type === 'note') {
			continue
		}
		if (mark.type) {
			if (run) {
				run.endMs = mark.atMs
				run = null
			}
			previous = null
			continue
		}
		const scoreMs = scoreTimeOf(mark, bars, lastBar, durationMs, previous)
		if (scoreMs === null) {
			warnings.push(`mark ${index}: bar ${mark.measure}${mark.pass ? ` (pass ${mark.pass})` : ''} is not in the score`)
			continue
		}
		if (!run) {
			const occurrences = bars.filter((b) => b.measure === mark.measure).length
			if (occurrences > 1 && !mark.pass) {
				warnings.push(`mark ${index}: bar ${mark.measure} is played ${occurrences} times - taking the first, set "pass" if that is wrong`)
			}
			run = { points: [], endMs: null }
			runs.push(run)
		} else {
			const last = run.points[run.points.length - 1]
			if (mark.atMs <= last.atMs || scoreMs <= last.scoreMs) {
				warnings.push(`mark ${index}: bar ${mark.measure} does not follow on - a "jump" or "stop" missing before it?`)
			}
		}
		run.points.push({ atMs: mark.atMs, scoreMs })
		previous = scoreMs
	}
	return { runs, warnings }
}

function scoreTimeOf(mark, bars, lastBar, durationMs, previous) {
	if (mark.measure === lastBar + 1) {
		return durationMs
	}
	const candidates = bars.filter((b) => b.measure === mark.measure)
	if (mark.pass) {
		return candidates.find((b) => b.pass === mark.pass)?.timeMs ?? null
	}
	const after = previous === null ? candidates[0] : candidates.find((b) => b.timeMs > previous)
	return (after ?? candidates[0])?.timeMs ?? null
}

/**
 * The truth table of a recording, in the shape tools/follow/synth.mjs
 * produces: score time per recording time, null while nobody sings.
 *
 * @param {object[]} marks marks.json
 * @param {object} score from loadScore()
 * @return {{truth: Array<{atMs:number, scoreMs:?number}>, warnings: string[]}}
 */
export function marksToTruth(marks, score) {
	const { runs, warnings } = resolveMarks(marks, score.bars, score.durationMs)
	const truth = []
	for (const { points, endMs } of runs) {
		const first = points[0]
		if (truth.length === 0 || truth[truth.length - 1].scoreMs !== null) {
			truth.push({ atMs: Math.max(0, first.atMs - TRUTH_STEP_MS), scoreMs: null })
		}
		for (let i = 0; i + 1 < points.length; i++) {
			const a = points[i]
			const b = points[i + 1]
			for (let t = a.atMs; t < b.atMs; t += TRUTH_STEP_MS) {
				truth.push({ atMs: t, scoreMs: a.scoreMs + ((b.scoreMs - a.scoreMs) * (t - a.atMs)) / (b.atMs - a.atMs) })
			}
		}
		const last = points[points.length - 1]
		if (endMs !== null && endMs > last.atMs) {
			// Run on at the last tempo up to the stop - but not into a bar
			// nobody marked: the next bar start caps it.
			const before = points[points.length - 2]
			const rate = before ? (last.scoreMs - before.scoreMs) / (last.atMs - before.atMs) : 1
			const next = score.bars.find((b) => b.timeMs > last.scoreMs)?.timeMs ?? score.durationMs
			for (let t = last.atMs; t < endMs; t += TRUTH_STEP_MS) {
				truth.push({ atMs: t, scoreMs: Math.min(next, last.scoreMs + rate * (t - last.atMs)) })
			}
			truth.push({ atMs: endMs, scoreMs: null })
		} else {
			truth.push({ atMs: last.atMs, scoreMs: last.scoreMs })
			truth.push({ atMs: last.atMs + TRUTH_STEP_MS, scoreMs: null })
		}
	}
	return { truth, warnings }
}

/**
 * The marks next to an audio file, if there are any: `probe.wav` →
 * `probe.marks.json`.
 *
 * @param {string} audioFile
 * @return {?string}
 */
export function marksFileFor(audioFile) {
	const candidate = audioFile.replace(/\.[^./\\]+$/, '') + '.marks.json'
	return existsSync(candidate) ? candidate : null
}
