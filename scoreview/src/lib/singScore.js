// Scoring a sung run of my part, note by note, as it is sung (spec in
// spike/planung, decision E24 in docs/architecture.md) - pure, no DOM.
//
// **One truth, live and afterwards.** Every note is judged with the same
// functions that judge a recording (lib/intonation.js evaluateNote,
// lib/rhythm.js evaluateRhythm), only on the frames of that one note, once
// it is over. A separate live scorer would drift apart from the analysis of a
// recording, and "measure 7 too low" in the result would not match what the
// recording panel says about the same take.
//
// **Silence scores nothing.** A note that the pitch analysis calls "not
// evaluable" because hardly a frame was voiced was not sung - it counts 0 for
// pitch. Otherwise a run sung in silence would score 100 %. Only a note the
// frames do not cover at all (shorter than the attack, cut off) drops out.
//
// **Only what can be heard is scored.** An onset tied to the same pitch or
// an end without a rest after it has nothing of its own to hear (rhythm.js);
// it drops out and its weight goes to the parts that can be judged.

import { classify, DEFAULT_SKIP_ATTACK_MS, DEFAULT_THRESHOLDS, evaluateNote, worstClass } from './intonation.js'
import { DEFAULT_RHYTHM_THRESHOLDS, evaluateRhythm, LEVEL_HOP_MS } from './rhythm.js'

export const SING_LEVELS = Object.freeze(['easy', 'choir', 'strict'])
export const DEFAULT_SING_LEVEL = 'choir'

const RELEASE = DEFAULT_RHYTHM_THRESHOLDS.release

/**
 * Thresholds per level. "Choir" is what intonation and rhythm use anyway.
 * "Easy" is close to what karaoke games accept: green up to a quarter tone.
 * The green onset never goes below 60 ms - under it the measured offset of
 * the cursor (+42 … +52 ms) would judge the latency, not the singer
 * (rhythm.js MIN_ONSET_TOLERANCE_MS). Defaults, not yet measured on amateur
 * voices (docs/limits.md).
 */
const LEVELS = Object.freeze({
	easy: {
		pitch: { green: 50, yellow: 100 },
		onset: { green: 120, yellow: 250 },
		release: { green: RELEASE.green * 2, greenShare: RELEASE.greenShare * 2, yellow: RELEASE.yellow * 2, yellowShare: RELEASE.yellowShare * 2 },
	},
	choir: {
		pitch: DEFAULT_THRESHOLDS,
		onset: DEFAULT_RHYTHM_THRESHOLDS.onset,
		release: RELEASE,
	},
	strict: {
		pitch: { green: 15, yellow: 30 },
		onset: { green: 60, yellow: 100 },
		release: RELEASE,
	},
})

/** Share of a note's score per part, spread over the parts that can be judged. */
export const WEIGHTS = Object.freeze({ pitch: 0.6, onset: 0.25, release: 0.15 })

/** A note weighs its real duration, but at least this - a quaver must not vanish. */
export const MIN_WEIGHT_MS = 250

/**
 * How long after its end a note is judged, real ms: the end of a note is
 * searched this far beyond it (rhythm.js SEARCH_MS).
 */
export const SETTLE_MS = 250

/** A jump in the score time larger than this is a seek, not jitter. */
const CONTINUITY_MS = 400

const CLASS_VALUE = { green: 1, yellow: 0.5, red: 0 }

/** Notes starting this close before the unit still belong to it (as intonation.js). */
const UNIT_TOLERANCE_MS = 2

/**
 * @param {string} level
 * @return {{pitch:object, onset:object, release:object}}
 */
export function levelThresholds(level) {
	return LEVELS[level] ?? LEVELS[DEFAULT_SING_LEVEL]
}

/**
 * My notes in a stretch of the score, by onset.
 *
 * @param {Array<object>} notes lib/midiNotes.js
 * @param {?Iterable<number>} myChannels
 * @param {number} startMs
 * @param {number} endMs
 * @return {Array<object>}
 */
export function unitNotes(notes, myChannels, startMs, endMs) {
	if (!notes || !myChannels) {
		return []
	}
	const channels = new Set(myChannels)
	return notes
		.filter((n) => channels.has(n.channel) && n.onMs >= startMs - UNIT_TOLERANCE_MS && n.onMs < endMs)
		.sort((a, b) => a.onMs - b.onMs || b.pitch - a.pitch)
}

/** Notes starting closer together than this are one chord (as rhythm.js). */
const CHORD_MS = 5

/**
 * My notes as chords: a part in divisi sings one of them, so one is judged.
 *
 * @param {Array<object>} notes from unitNotes(), by onset
 * @return {Array<Array<object>>}
 */
export function unitChords(notes) {
	const chords = []
	for (const n of notes ?? []) {
		const last = chords[chords.length - 1]
		if (last && n.onMs - last[0].onMs < CHORD_MS) {
			last.push(n)
		} else {
			chords.push([n])
		}
	}
	return chords
}

/**
 * Judge a chord of my part by the note of it that was sung: the one that
 * scores best, as the needle takes the nearest note of a divisi
 * (intonation.js targetAt). Judged against the top note, the lower half of
 * a divided part would never score.
 *
 * @param {Array<object>} frames
 * @param {Array<object>} chord from unitChords()
 * @param {object} ctx as scoreNote()
 * @return {?object} as scoreNote()
 */
export function scoreChord(frames, chord, ctx) {
	let best = null
	for (const note of chord) {
		const r = scoreNote(frames, note, ctx)
		if (r && (best === null || r.score > best.score)) {
			best = r
		}
	}
	return best
}

/**
 * Score time from which a note can be judged.
 *
 * @param {{offMs:number}} note
 * @param {number} tempoFactor
 * @return {number}
 */
export function readyAtMs(note, tempoFactor) {
	return note.offMs + SETTLE_MS * tempoFactor
}

/**
 * The live level points around a note as the envelope rhythm.js reads.
 * The points come every LEVEL_HOP_MS real ms; in score time that is the hop
 * times the tempo.
 *
 * @param {Array<{scoreMs:number, db:number}>} points sorted by time
 * @param {number} fromMs
 * @param {number} toMs
 * @param {number} tempoFactor
 * @return {?{db: Float32Array, t0Ms: number, stepMs: number}}
 */
export function levelWindow(points, fromMs, toMs, tempoFactor) {
	const inside = (points ?? []).filter((p) => p.scoreMs >= fromMs && p.scoreMs <= toMs)
	if (inside.length < 2) {
		return null
	}
	return { db: Float32Array.from(inside, (p) => p.db), t0Ms: inside[0].scoreMs, stepMs: LEVEL_HOP_MS * tempoFactor }
}

/**
 * Judge one note.
 *
 * @param {Array<{scoreMs:number, hz:?number, clarity:number}>} frames sorted by time
 * @param {{onMs:number, offMs:number, pitch:number}} note
 * @param {object} ctx
 * @param {Array<object>} ctx.notes all notes, for the neighbouring chords
 * @param {Iterable<number>} ctx.myChannels
 * @param {number} [ctx.tempoFactor]
 * @param {string} [ctx.level]
 * @param {?object} [ctx.levelEnvelope] see levelWindow()
 * @return {?{note:object, pitch:{class:string, cents:?number}, onset:?{class:string, devMs:number}, release:?{class:string, shortMs:number}, score:number, weightMs:number, label:{kind:string, value:?number}, cls:string}}
 */
export function scoreNote(frames, note, { notes, myChannels, tempoFactor = 1, level = DEFAULT_SING_LEVEL, levelEnvelope = null }) {
	const t = levelThresholds(level)
	const pitch = heardPitch(evaluateNote(frames, note, { tempoFactor, thresholds: t.pitch }), note, tempoFactor, t.pitch)
	if (!pitch) {
		return null
	}
	const rhythm = evaluateRhythm(frames, [{ note }], notes, myChannels, {
		tempoFactor,
		level: levelEnvelope,
		thresholds: { onset: t.onset, release: t.release },
	})[0] ?? {}
	const heard = pitch.class !== 'na'
	const onset = heard && rhythm.onset && rhythm.onset.class !== 'na' ? { class: rhythm.onset.class, devMs: rhythm.onset.devMs } : null
	const release = heard && rhythm.release && rhythm.release.class !== 'na' ? { class: rhythm.release.class, shortMs: rhythm.release.shortMs } : null

	const parts = [{ kind: 'pitch', value: heard ? CLASS_VALUE[pitch.class] : 0, weight: WEIGHTS.pitch }]
	if (onset) {
		parts.push({ kind: 'onset', value: CLASS_VALUE[onset.class], weight: WEIGHTS.onset })
	}
	if (release) {
		parts.push({ kind: 'release', value: CLASS_VALUE[release.class], weight: WEIGHTS.release })
	}
	const total = parts.reduce((sum, p) => sum + p.weight, 0)
	const score = parts.reduce((sum, p) => sum + p.value * p.weight, 0) / total

	return {
		note,
		pitch: { class: pitch.class, cents: pitch.medianCents },
		onset,
		release,
		score,
		weightMs: Math.max(MIN_WEIGHT_MS, (note.offMs - note.onMs) / tempoFactor),
		label: labelOf(pitch, onset, release),
		cls: heard ? worstClass(pitch.class, onset?.class, release?.class) : 'red',
	}
}

/** Voiced frames after the attack from which a note counts as sung. */
const MIN_HEARD_FRAMES = 3

/**
 * The pitch of a note let go early. The intonation calls a note with less
 * than half of its frames voiced "not judgeable" - right for a needle, wrong
 * for a score: a note sung for 40 % of its length was sung, and is "too
 * short" (rhythm.js), not silence worth 0 %. Measured: all ten notes of a
 * run cut to 40 % read "not heard".
 *
 * @param {?{medianCents:?number, class:string, curve:Array}} evaluated from evaluateNote()
 * @param {{onMs:number}} note
 * @param {number} tempoFactor
 * @param {{green:number, yellow:number}} thresholds
 * @return {?{medianCents:?number, class:string}}
 */
function heardPitch(evaluated, note, tempoFactor, thresholds) {
	if (!evaluated || evaluated.class !== 'na') {
		return evaluated
	}
	const voiced = evaluated.curve
		.filter((p) => p.scoreMs >= note.onMs + DEFAULT_SKIP_ATTACK_MS * tempoFactor && p.cents !== null)
		.map((p) => p.cents)
		.sort((a, b) => a - b)
	if (voiced.length < MIN_HEARD_FRAMES) {
		return evaluated
	}
	const mid = Math.floor(voiced.length / 2)
	const medianCents = voiced.length % 2 ? voiced[mid] : (voiced[mid - 1] + voiced[mid]) / 2
	return { medianCents, class: classify(medianCents, thresholds) }
}

/**
 * The word under a note: "perfect", or the worst part - pitch before onset
 * before end when they are equally bad (as the note head, D2 of Paket C).
 *
 * @param {{class:string, medianCents:?number}} pitch
 * @param {?{class:string, devMs:number}} onset
 * @param {?{class:string, shortMs:number}} release
 * @return {{kind:string, value:?number}}
 */
function labelOf(pitch, onset, release) {
	if (pitch.class === 'na') {
		return { kind: 'notHeard', value: null }
	}
	const candidates = [
		{ cls: pitch.class, label: { kind: pitch.medianCents < 0 ? 'low' : 'high', value: pitch.medianCents } },
		onset && { cls: onset.class, label: { kind: onset.devMs < 0 ? 'early' : 'late', value: onset.devMs } },
		release && { cls: release.class, label: { kind: 'short', value: release.shortMs } },
	].filter(Boolean)
	let worst = null
	for (const c of candidates) {
		if (CLASS_VALUE[c.cls] < 1 && (worst === null || CLASS_VALUE[c.cls] < CLASS_VALUE[worst.cls])) {
			worst = c
		}
	}
	return worst ? worst.label : { kind: 'perfect', value: null }
}

/**
 * The percentages of a run: the whole and each part, weighted by the notes'
 * real duration. A part nothing could be measured for is null.
 *
 * @param {Array<object>} results from scoreNote()
 * @return {{totalPct:?number, pitchPct:?number, onsetPct:?number, releasePct:?number, notesScored:number}}
 */
export function summarizeRun(results) {
	const list = (results ?? []).filter(Boolean)
	const pct = (pick) => {
		let sum = 0
		let weight = 0
		for (const r of list) {
			const value = pick(r)
			if (value !== null && value !== undefined) {
				sum += value * r.weightMs
				weight += r.weightMs
			}
		}
		return weight > 0 ? Math.round((100 * sum) / weight) : null
	}
	return {
		totalPct: pct((r) => r.score),
		pitchPct: pct((r) => (r.pitch.class === 'na' ? 0 : CLASS_VALUE[r.pitch.class])),
		onsetPct: pct((r) => (r.onset ? CLASS_VALUE[r.onset.class] : null)),
		releasePct: pct((r) => (r.release ? CLASS_VALUE[r.release.class] : null)),
		notesScored: list.length,
	}
}

/**
 * The spots to practise: the worst notes, one per measure, worst first.
 *
 * @param {Array<object>} results from scoreNote()
 * @param {function(number): ?number} measureOf score time → measure number
 * @param {number} [max]
 * @return {Array<{measure:?number, label:{kind:string, value:?number}, onMs:number}>}
 */
export function practiceSpots(results, measureOf, max = 5) {
	const bad = (results ?? [])
		.filter((r) => r && r.label.kind !== 'perfect')
		.sort((a, b) => a.score - b.score || a.note.onMs - b.note.onMs)
	const seen = new Set()
	const spots = []
	for (const r of bad) {
		const measure = measureOf(r.note.onMs)
		const key = measure ?? `@${r.note.onMs}`
		if (seen.has(key)) {
			continue
		}
		seen.add(key)
		spots.push({ measure, label: r.label, onMs: r.note.onMs })
		if (spots.length >= max) {
			break
		}
	}
	return spots
}

/**
 * Whether the score time moved as the clock did - otherwise someone sought.
 *
 * @param {number} prevScoreMs
 * @param {number} nextScoreMs
 * @param {number} realElapsedMs
 * @param {number} tempoFactor
 * @return {boolean}
 */
export function isContinuous(prevScoreMs, nextScoreMs, realElapsedMs, tempoFactor) {
	return Math.abs(nextScoreMs - prevScoreMs - realElapsedMs * tempoFactor) <= CONTINUITY_MS
}
