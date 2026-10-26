// The reference a microphone follower compares against: what each moment of
// the score should sound like, as chroma - pure, no DOM, no AudioContext.
//
// Built from the notes (lib/midiNotes.js) with a harmonic template, not from
// rendered sound: it needs no SoundFont, works in silent mode and offline,
// and takes milliseconds. Whether a rendered reference follows better is a
// measurement (tools/follow-replay.mjs --reference), not an assumption -
// which is why this module also accepts ready-made chroma frames.
//
// Why ensembles: in rehearsal only part of the score sounds most of the time
// ("tenors alone from bar 40", the pianist plays one part, the choir sings an
// accompanied piece a cappella). Compared against the full score only, those
// passages look wrong. So each frame carries several references - tutti,
// accompaniment only, voices only, each voice alone - and the follower takes
// the one that fits best. An ensemble that is silent at a frame cannot fit
// there: otherwise "tenor alone" would match every tenor rest.

import { normalize, similarity, toCens } from './chroma.js'

/** Spacing of the reference frames (ms), the same as the live tapping. */
export const FRAME_MS = 50

/**
 * Relative weight of the harmonics 1..6. The seventh is left out: it lies a
 * third of a semitone below its pitch class and would smear the chroma.
 */
export const DEFAULT_HARMONICS = Object.freeze([1, 0.6, 0.4, 0.3, 0.2, 0.15])

/** Never more ensembles than this - each one costs a comparison per frame. */
export const MAX_ENSEMBLES = 8

/** GM programs 52-54: choir aahs, voice oohs, synth voice. */
const VOCAL_PROGRAMS = new Set([52, 53, 54])
/** MuseScore instrument ids of voices (instruments.xml). */
const VOCAL_IDS = /^(soprano|mezzo-soprano|alto|contralto|countertenor|tenor|baritone|bass|voice|.*-voice|.*-voices|choir.*|women|men|boy-soprano)$/

/**
 * Parts of a score as the follower needs them: which channels belong
 * together, and whether a part is sung.
 *
 * Sung means: the part has lyrics, a vocal GM program, or a voice instrument
 * id. Lyrics come first because MuseScore choir templates often keep the
 * "grand-piano" id with program 52 (seen in lyrics-test.mscz).
 *
 * @param {Array<{channel:number, partId:?string, name:string}>} mixerChannels from lib/mixerLayout.js
 * @param {Array<{id:string, name?:string, program?:number, instrumentId?:string, lyricCount?:number}>} metaParts meta.json parts
 * @return {Array<{id:string, label:string, channels:number[], vocal:boolean}>}
 */
export function followParts(mixerChannels, metaParts) {
	const byId = new Map((metaParts ?? []).map((part) => [String(part.id), part]))
	const result = []
	for (const channel of mixerChannels ?? []) {
		// Chord symbols are no part to follow: nobody sings or plays them.
		if (channel.harmonyOf !== undefined) {
			continue
		}
		const id = String(channel.partId ?? `ch${channel.channel}`)
		let entry = result.find((p) => p.id === id)
		if (!entry) {
			const part = byId.get(id)
			entry = {
				id,
				label: part?.name || channel.name || id,
				channels: [],
				vocal: isVocal(part),
			}
			result.push(entry)
		}
		if (!entry.channels.includes(channel.channel)) {
			entry.channels.push(channel.channel)
		}
	}
	return result
}

/**
 * @param {?object} part meta.json part
 * @return {boolean}
 */
export function isVocal(part) {
	if (!part) {
		return false
	}
	if (Number(part.lyricCount) > 0) {
		return true
	}
	if (VOCAL_PROGRAMS.has(Number(part.program))) {
		return true
	}
	return VOCAL_IDS.test(String(part.instrumentId ?? ''))
}

/**
 * Which ensembles a score gets. Tutti always; accompaniment and voices only
 * if both kinds exist; each voice alone if there are at least two. Above
 * MAX_ENSEMBLES, neighbouring voices are paired (S1/S2 → S) - a divided
 * section is rehearsed together far more often than one half alone.
 *
 * @param {Array<{id:string, label:string, channels:number[], vocal:boolean}>} parts
 * @return {Array<{id:string, label:string, channels:number[]}>}
 */
export function planEnsembles(parts) {
	const all = parts.flatMap((p) => p.channels)
	const vocal = parts.filter((p) => p.vocal)
	const instrumental = parts.filter((p) => !p.vocal)
	const ensembles = [{ id: 'tutti', label: 'tutti', channels: all }]
	if (vocal.length > 0 && instrumental.length > 0) {
		ensembles.push({ id: 'accompaniment', label: 'accompaniment', channels: instrumental.flatMap((p) => p.channels) })
		ensembles.push({ id: 'voices', label: 'voices', channels: vocal.flatMap((p) => p.channels) })
	}
	if (vocal.length >= 2) {
		let singles = vocal.map((p) => ({ id: `part:${p.id}`, label: p.label, channels: [...p.channels] }))
		while (ensembles.length + singles.length > MAX_ENSEMBLES && singles.length > 1) {
			const paired = []
			for (let i = 0; i < singles.length; i += 2) {
				const a = singles[i]
				const b = singles[i + 1]
				paired.push(b
					? { id: `${a.id}+${b.id}`, label: `${a.label}+${b.label}`, channels: [...a.channels, ...b.channels] }
					: a)
			}
			singles = paired
		}
		ensembles.push(...singles.slice(0, MAX_ENSEMBLES - ensembles.length))
	}
	return ensembles
}

/**
 * Chroma frames of a set of notes, by a harmonic template.
 *
 * @param {Array<{onMs:number, offMs:number, pitch:number, channel:number}>} notes
 * @param {Set<number>} channels which notes to take
 * @param {number} frames number of frames
 * @param {number} frameMs
 * @param {readonly number[]} harmonics
 * @return {{chroma: Float32Array, silent: Uint8Array}} chroma is frames*12, each frame L2-normalised
 */
export function notesToChroma(notes, channels, frames, frameMs, harmonics = DEFAULT_HARMONICS) {
	const chroma = new Float32Array(frames * 12)
	const classes = harmonics.map((_, h) => Math.round(12 * Math.log2(h + 1)))
	for (const note of notes) {
		if (!channels.has(note.channel)) {
			continue
		}
		const first = Math.max(0, Math.floor(note.onMs / frameMs))
		const last = Math.min(frames - 1, Math.floor((note.offMs - 1e-6) / frameMs))
		for (let f = first; f <= last; f++) {
			// Partial frames count by their share, so a short note at the
			// edge of a frame does not weigh as much as a held one.
			const start = Math.max(note.onMs, f * frameMs)
			const end = Math.min(note.offMs, (f + 1) * frameMs)
			const share = Math.max(0, end - start) / frameMs
			for (let h = 0; h < harmonics.length; h++) {
				const pc = (((note.pitch + classes[h]) % 12) + 12) % 12
				chroma[f * 12 + pc] += share * harmonics[h]
			}
		}
	}
	const silent = new Uint8Array(frames)
	for (let f = 0; f < frames; f++) {
		const frame = chroma.subarray(f * 12, f * 12 + 12)
		if (!normalize(frame)) {
			silent[f] = 1
		}
	}
	return { chroma, silent }
}

/**
 * @typedef {object} FollowReference
 * @property {number} frameMs spacing of the reference frames
 * @property {number} frames number of reference frames
 * @property {number} durationMs length of the score
 * @property {Array<{id:string, label:string, chroma:Float32Array, silent:Uint8Array}>} ensembles chroma (frames*12) and silence per ensemble
 * @property {number} censMs spacing of the CENS frames
 * @property {Array<Float32Array[]>} cens per ensemble, one 12-vector per CENS frame
 * @property {Float32Array} ambiguity per CENS frame: best similarity elsewhere in the piece (0..1)
 * @property {Float32Array} entryPrior per CENS frame: how plausible a fresh start is here (0..1)
 */

/**
 * Build the reference of a score.
 *
 * @param {Array<{onMs:number, offMs:number, pitch:number, channel:number}>} notes
 * @param {Array<{id:string, label:string, channels:number[], vocal:boolean}>} parts from followParts()
 * @param {object} [options]
 * @param {number} [options.durationMs] defaults to the end of the last note
 * @param {number} [options.frameMs]
 * @param {readonly number[]} [options.harmonics]
 * @param {number} [options.censMs]
 * @param {number} [options.censSmoothMs]
 * @param {number} [options.ambiguityWindowMs] length compared for ambiguity
 * @param {number} [options.ambiguityNeighbourMs] what counts as "elsewhere"
 * @param {number[]} [options.markersMs] rehearsal marks
 * @param {number[]} [options.measureStartsMs]
 * @param {number[]} [options.systemStartsMs]
 * @return {FollowReference}
 */
export function buildFollowReference(notes, parts, options = {}) {
	const {
		frameMs = FRAME_MS,
		harmonics = DEFAULT_HARMONICS,
		censMs = 200,
		censSmoothMs = 1000,
		ambiguityWindowMs = 4000,
		ambiguityNeighbourMs = 4000,
	} = options
	const durationMs = options.durationMs ?? notes.reduce((max, n) => Math.max(max, n.offMs), 0)
	const frames = Math.max(1, Math.ceil(durationMs / frameMs))
	const ensembles = planEnsembles(parts).map((ensemble) => ({
		id: ensemble.id,
		label: ensemble.label,
		...notesToChroma(notes, new Set(ensemble.channels), frames, frameMs, harmonics),
	}))
	const cens = ensembles.map(({ chroma, silent }) => toCens(
		framesOf(chroma, silent),
		frameMs,
		{ targetMs: censMs, smoothMs: censSmoothMs },
	))
	const censFrames = cens[0].length
	return {
		frameMs,
		frames,
		durationMs,
		ensembles,
		censMs,
		cens,
		ambiguity: ambiguityOf(cens[0], Math.round(ambiguityWindowMs / censMs), Math.round(ambiguityNeighbourMs / censMs)),
		entryPrior: entryPriorOf(notes, censFrames, censMs, options),
	}
}

/**
 * Split flat chroma back into per-frame views (null where silent).
 *
 * @param {Float32Array} chroma
 * @param {Uint8Array} silent
 * @return {Array<?Float32Array>}
 */
export function framesOf(chroma, silent) {
	const result = []
	for (let f = 0; f < silent.length; f++) {
		result.push(silent[f] ? null : chroma.subarray(f * 12, f * 12 + 12))
	}
	return result
}

/**
 * For each CENS frame: how well the passage starting there matches the best
 * passage elsewhere (mean similarity over `window` frames). Near 1 means the
 * score itself cannot tell the two apart - repeated verses, a da capo - and
 * a jump there must never be taken on sound alone (F10).
 *
 * Walks the diagonals of the self-similarity matrix with a running window,
 * so memory stays linear: a 15-minute piece would need 80 MB as a matrix.
 *
 * @param {Float32Array[]} cens
 * @param {number} window
 * @param {number} neighbour minimum distance in frames
 * @return {Float32Array}
 */
export function ambiguityOf(cens, window, neighbour) {
	const n = cens.length
	const result = new Float32Array(n)
	const w = Math.max(1, Math.min(window, n))
	for (let d = Math.max(1, neighbour); d < n; d++) {
		// Diagonal j = i + d; a passage at i and one at j compare each other.
		let sum = 0
		const sims = new Float32Array(n - d)
		for (let i = 0; i + d < n; i++) {
			sims[i] = similarity(cens[i], cens[i + d])
		}
		for (let i = 0; i < sims.length; i++) {
			sum += sims[i]
			if (i >= w) {
				sum -= sims[i - w]
			}
			if (i >= w - 1) {
				const start = i - w + 1
				const mean = sum / w
				if (mean > result[start]) {
					result[start] = mean
				}
				if (mean > result[start + d]) {
					result[start + d] = mean
				}
			}
		}
	}
	return result
}

/**
 * Where a rehearsal plausibly starts again. Choirs restart at the beginning,
 * at rehearsal marks, at the start of a system ("top of page 3"), at a bar
 * after a rest - hardly ever in the middle of a sung phrase. The follower
 * uses this as a prior when it searches after a pause.
 *
 * @param {Array<{onMs:number, offMs:number}>} notes
 * @param {number} censFrames
 * @param {number} censMs
 * @param {object} options
 * @return {Float32Array}
 */
export function entryPriorOf(notes, censFrames, censMs, options = {}) {
	const prior = new Float32Array(censFrames)
	const mark = (ms, value) => {
		const i = Math.round(ms / censMs)
		if (i >= 0 && i < censFrames && value > prior[i]) {
			prior[i] = value
		}
	}
	for (const ms of options.measureStartsMs ?? []) {
		mark(ms, 0.3)
	}
	// Onsets after a gap in which nothing sounded at all.
	const sorted = [...notes].sort((a, b) => a.onMs - b.onMs)
	let soundingUntil = -Infinity
	for (const note of sorted) {
		if (note.onMs - soundingUntil >= (options.restGapMs ?? 300)) {
			mark(note.onMs, 0.6)
		}
		soundingUntil = Math.max(soundingUntil, note.offMs)
	}
	for (const ms of options.systemStartsMs ?? []) {
		mark(ms, 0.8)
	}
	for (const ms of options.markersMs ?? []) {
		mark(ms, 0.8)
	}
	mark(0, 1)
	return prior
}
