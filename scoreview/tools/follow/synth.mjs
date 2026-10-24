// Renders synthetic "performances" for the follower's measuring rig: notes
// → additive sound, warped in time, detuned, partly sung, with speech,
// silence and handling noise in between - and with the exact truth of
// where in the score each moment is.
//
// Additive on purpose: the repository has no SoundFont (FluidR3 arrives at
// run time) and `npm test` must run offline in CI. This is a regression net,
// not proof - a real rehearsal recording is (follower plan, phase 4).

import { mulberry32 } from './piece.mjs'

/** Voice and piano timbres: relative amplitudes of harmonics 1..n. */
const VOICE_HARMONICS = [1, 0.55, 0.35, 0.22, 0.12, 0.08, 0.05]
const PIANO_HARMONICS = [1, 0.6, 0.3, 0.2, 0.12, 0.08]

/** Resolution of the time map (ms). */
const MAP_STEP_MS = 10

/**
 * @typedef {object} Segment
 * @property {'play'} type kind of script item
 * @property {number} fromMs score time
 * @property {number} toMs score time
 * @property {number} [rate] score ms per performance ms (1.2 = 20 % faster)
 * @property {number} [wobble] rubato depth, e.g. 0.1 = ±10 % tempo
 * @property {?number[]} [channels] which channels sound; null = all
 * @property {Object<number, number>} [gains] gain per channel (default 1)
 *
 * @typedef {object} Insert
 * @property {'silence'|'speech'|'grips'} type what happens instead of music
 * @property {number} durMs how long
 */

/**
 * @param {object[]} notes score notes ({onMs, offMs, pitch, channel})
 * @param {Array<Segment|Insert>} script
 * @param {object} [options]
 * @param {number} [options.sampleRate]
 * @param {number} [options.seed]
 * @param {number} [options.tuningCents] constant offset
 * @param {number} [options.driftCents] additional offset reached at the end (linear)
 * @param {number[]} [options.pianoChannels] channels rendered as piano
 * @param {number} [options.noise] white noise amplitude
 * @param {number} [options.reverb] 0..1 wet share
 * @param {(scheduled: object[], samples: Float32Array, sampleRate: number) => void} [options.renderNotes]
 *   mixes the scheduled notes ({onMs, offMs, pitch, channel, gain, cents}) into
 *   `samples` instead of the additive voices - tools/follow/sfRender.mjs
 * @return {{samples: Float32Array, sampleRate: number, truth: Array<{atMs:number, scoreMs:?number}>, events: object[]}}
 */
export function renderPerformance(notes, script, options = {}) {
	const {
		sampleRate = 22050,
		seed = 1,
		tuningCents = 0,
		driftCents = 0,
		pianoChannels = [],
		noise = 0,
		reverb = 0,
	} = options
	const random = mulberry32(seed)
	const totalMs = script.reduce((sum, item) => sum + (item.type === 'play' ? playLengthMs(item) : item.durMs), 0)
	// Music and everything else apart: the music is normalised first, so
	// speech, handling noise and room noise keep the same level against it
	// whatever renders the notes (additive tones or a SoundFont).
	const samples = new Float32Array(Math.ceil((totalMs / 1000) * sampleRate) + sampleRate)
	const extras = new Float32Array(samples.length)
	const truth = []
	const events = []
	const cents = (atMs) => tuningCents + (driftCents * atMs) / Math.max(1, totalMs)
	const scheduled = []
	let perfMs = 0
	for (const item of script) {
		if (item.type !== 'play') {
			events.push({ type: item.type, atMs: perfMs, durMs: item.durMs })
			for (let t = 0; t < item.durMs; t += MAP_STEP_MS) {
				truth.push({ atMs: perfMs + t, scoreMs: null })
			}
			if (item.type === 'speech') {
				addSpeech(extras, sampleRate, perfMs, item.durMs, random)
			} else if (item.type === 'grips') {
				addGrips(extras, sampleRate, perfMs, item.durMs, random)
			}
			perfMs += item.durMs
			continue
		}
		const map = timeMap(item)
		events.push({ type: 'play', atMs: perfMs, fromMs: item.fromMs, toMs: item.toMs })
		for (const point of map) {
			truth.push({ atMs: perfMs + point.perfMs, scoreMs: point.scoreMs })
		}
		const channels = item.channels ? new Set(item.channels) : null
		for (const n of notes) {
			if ((channels && !channels.has(n.channel)) || n.offMs <= item.fromMs || n.onMs >= item.toMs) {
				continue
			}
			const on = perfMs + toPerf(map, Math.max(n.onMs, item.fromMs))
			const off = perfMs + toPerf(map, Math.min(n.offMs, item.toMs))
			scheduled.push({ onMs: on, offMs: off, pitch: n.pitch, channel: n.channel, gain: item.gains?.[n.channel] ?? 1, cents: cents(on) })
		}
		perfMs += map[map.length - 1].perfMs
	}
	if (options.renderNotes) {
		options.renderNotes(scheduled, samples, sampleRate)
	} else {
		for (const n of scheduled) {
			addNote(samples, sampleRate, n.onMs, n.offMs, n.pitch, n.cents, n.gain, pianoChannels.includes(n.channel), random)
		}
	}
	normalizePeak(samples, 0.5)
	for (let i = 0; i < samples.length; i++) {
		samples[i] += extras[i]
	}
	if (reverb > 0) {
		applyReverb(samples, sampleRate, reverb)
	}
	if (noise > 0) {
		for (let i = 0; i < samples.length; i++) {
			samples[i] += noise * (random() * 2 - 1)
		}
	}
	normalizePeak(samples, 0.8)
	return { samples, sampleRate, truth, events }
}

function playLengthMs(segment) {
	const map = timeMap(segment)
	return map[map.length - 1].perfMs
}

/**
 * Performance time → score time for one segment, in steps of MAP_STEP_MS.
 *
 * @param {Segment} segment
 * @return {Array<{perfMs:number, scoreMs:number}>}
 */
function timeMap(segment) {
	const { fromMs, toMs, rate = 1, wobble = 0 } = segment
	const map = [{ perfMs: 0, scoreMs: fromMs }]
	let score = fromMs
	let perf = 0
	while (score < toMs) {
		const speed = rate * (1 + wobble * Math.sin((2 * Math.PI * perf) / 7000))
		score = Math.min(toMs, score + MAP_STEP_MS * speed)
		perf += MAP_STEP_MS
		map.push({ perfMs: perf, scoreMs: score })
	}
	return map
}

function toPerf(map, scoreMs) {
	let lo = 0
	let hi = map.length - 1
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (map[mid].scoreMs < scoreMs) {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	const b = map[lo]
	const a = map[Math.max(0, lo - 1)]
	if (b.scoreMs === a.scoreMs) {
		return b.perfMs
	}
	return a.perfMs + ((scoreMs - a.scoreMs) / (b.scoreMs - a.scoreMs)) * (b.perfMs - a.perfMs)
}

function addNote(samples, sampleRate, onMs, offMs, pitch, cents, gain, piano, random) {
	const hz = 440 * 2 ** ((pitch - 69 + cents / 100) / 12)
	const start = Math.floor((onMs / 1000) * sampleRate)
	const release = piano ? 0.05 : 0.08
	const end = Math.min(samples.length, Math.floor((offMs / 1000 + release) * sampleRate))
	const harmonics = piano ? PIANO_HARMONICS : VOICE_HARMONICS
	let phase = random() * 2 * Math.PI
	const vibratoRate = 5 + random()
	const lengthSec = (offMs - onMs) / 1000
	for (let i = Math.max(0, start); i < end; i++) {
		const t = (i - start) / sampleRate
		let env
		if (piano) {
			env = Math.exp(-2.5 * t) * Math.min(1, t / 0.005)
		} else {
			env = Math.min(1, t / 0.06)
		}
		if (t > lengthSec) {
			env *= Math.max(0, 1 - (t - lengthSec) / release)
		}
		// Voices: vibrato of about ±25 cents after the attack. The phase is
		// integrated sample by sample - multiplying the deviation into
		// hz·t instead would make the frequency swing grow with time.
		const vibrato = piano ? 0 : 0.015 * Math.min(1, t / 0.3) * Math.sin(2 * Math.PI * vibratoRate * t)
		phase += (2 * Math.PI * hz * (1 + vibrato)) / sampleRate
		let v = 0
		for (let h = 0; h < harmonics.length; h++) {
			v += harmonics[h] * Math.sin((h + 1) * phase)
		}
		samples[i] += 0.05 * gain * env * v
	}
}

/**
 * Speech-like sound: a voiced source (100-180 Hz, new per syllable) shaped by two
 * moving formants, chopped into syllables. It has pitch - that is the hard
 * case for the gates, unlike plain noise.
 *
 * @param {Float32Array} samples mixed into
 * @param {number} sampleRate
 * @param {number} atMs
 * @param {number} durMs
 * @param {() => number} random
 */
function addSpeech(samples, sampleRate, atMs, durMs, random) {
	const start = Math.floor((atMs / 1000) * sampleRate)
	const length = Math.floor((durMs / 1000) * sampleRate)
	let syllableStart = 0
	let syllableEnd = 0
	let f1 = 500
	let f2 = 1500
	let f0 = 130
	for (let i = 0; i < length && start + i < samples.length; i++) {
		if (i >= syllableEnd) {
			syllableStart = i
			syllableEnd = i + Math.floor((0.15 + random() * 0.15) * sampleRate)
			f1 = 300 + random() * 500
			f2 = 900 + random() * 1400
			f0 = 100 + random() * 80
		}
		const t = i / sampleRate
		const env = Math.sin((Math.PI * (i - syllableStart)) / (syllableEnd - syllableStart))
		let v = 0
		for (let h = 1; h * f0 < 3500; h++) {
			const f = h * f0
			const formant = Math.exp(-(((f - f1) / 150) ** 2)) + 0.6 * Math.exp(-(((f - f2) / 200) ** 2))
			v += formant * Math.sin(2 * Math.PI * f * t)
		}
		samples[start + i] += 0.08 * env * v
	}
}

/**
 * Handling noise: short, loud, broadband bursts.
 *
 * @param {Float32Array} samples mixed into
 * @param {number} sampleRate
 * @param {number} atMs
 * @param {number} durMs
 * @param {() => number} random
 */
function addGrips(samples, sampleRate, atMs, durMs, random) {
	const count = Math.max(1, Math.round(durMs / 400))
	for (let g = 0; g < count; g++) {
		const at = atMs + random() * durMs
		const len = (0.01 + random() * 0.07) * sampleRate
		const start = Math.floor((at / 1000) * sampleRate)
		for (let i = 0; i < len && start + i < samples.length; i++) {
			samples[start + i] += 0.6 * (random() * 2 - 1) * Math.exp(-i / (len / 3))
		}
	}
}

/**
 * Schroeder reverb: four combs, two allpasses - a room, not a cathedral.
 *
 * @param {Float32Array} samples changed in place
 * @param {number} sampleRate
 * @param {number} wet share of the reverberated signal, 0..1
 */
function applyReverb(samples, sampleRate, wet) {
	const dry = Float32Array.from(samples)
	const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((s) => Math.floor(s * sampleRate))
	const out = new Float32Array(samples.length)
	for (const delay of combs) {
		const buffer = new Float32Array(delay)
		let idx = 0
		for (let i = 0; i < dry.length; i++) {
			const y = buffer[idx]
			buffer[idx] = dry[i] + 0.84 * y
			idx = (idx + 1) % delay
			out[i] += y / combs.length
		}
	}
	for (const delay of [0.005, 0.0017].map((s) => Math.floor(s * sampleRate))) {
		const buffer = new Float32Array(delay)
		let idx = 0
		for (let i = 0; i < out.length; i++) {
			const b = buffer[idx]
			const x = out[i]
			buffer[idx] = x + 0.7 * b
			out[i] = b - 0.7 * x
			idx = (idx + 1) % delay
		}
	}
	for (let i = 0; i < samples.length; i++) {
		samples[i] = (1 - wet) * dry[i] + wet * 3 * out[i]
	}
}

function normalizePeak(samples, peak) {
	let max = 0
	for (let i = 0; i < samples.length; i++) {
		max = Math.max(max, Math.abs(samples[i]))
	}
	if (max > 0) {
		const scale = peak / max
		for (let i = 0; i < samples.length; i++) {
			samples[i] *= scale
		}
	}
}

/**
 * Score time at a performance time, from the truth table (null = nobody sings).
 *
 * @param {Array<{atMs:number, scoreMs:?number}>} truth
 * @param {number} atMs
 * @return {?number}
 */
export function truthAt(truth, atMs) {
	let lo = 0
	let hi = truth.length - 1
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1
		if (truth[mid].atMs <= atMs) {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	return truth[lo]?.scoreMs ?? null
}
