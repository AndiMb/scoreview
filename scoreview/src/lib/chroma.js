// Chroma features for score following by microphone - pure, no DOM, no
// AudioContext, so the measuring rig (tools/follow-replay.mjs) computes
// exactly what the viewer computes.
//
// Why only a magnitude spectrum: the follower may read nothing but
// AnalyserNode.getFloatFrequencyData (S7 in docs/architecture.md - it gets the
// microphone source but no capture blocks). A magnitude spectrum of 170 ms
// windows is no longer audio anyone could play back. And the AnalyserNode
// computation is fixed by the Web Audio specification, so
// `analyserSpectrum()` below can rebuild it bit for bit for recorded files.
//
// Why chroma and not pitch detection: a choir sings several notes at once.
// Twelve pitch classes tolerate reverb, vibrato and missing parts; a
// fundamental-frequency tracker would follow one voice and lose the rest.
//
// Why 36 bins live: three bins per semitone give the tuning estimate almost
// for free (a cappella choirs sink, an organ may sit off 440 Hz), and folding
// to 12 classes at the estimated offset keeps a drifted chord in its class.

import { fft } from './pitchDetect.js'

/** Bins per semitone in the live chroma. */
export const SUB_BINS = 3
/** Width of one live bin in cents. */
const CENTS_PER_BIN = 100 / SUB_BINS

/** Lower and upper frequency taken into the chroma (Hz). */
export const CHROMA_MIN_HZ = 55
export const CHROMA_MAX_HZ = 2000

/** AnalyserNode's default dB floor - values below carry no information. */
const ANALYSER_MIN_DB = -100

/**
 * Rebuild of AnalyserNode.getFloatFrequencyData for a block of samples
 * (Web Audio API, "FFT windowing and smoothing over time"): Blackman window
 * with alpha 0.16, FFT, magnitude divided by the FFT size, smoothing time
 * constant 0, then 20·log10. The live path sets smoothingTimeConstant to 0,
 * so no state across calls is needed.
 *
 * @param {Float32Array|number[]} samples the last `fftSize` samples (older ones are ignored)
 * @param {number} fftSize power of two
 * @return {Float32Array} fftSize/2 values in dB (-Infinity for silence)
 */
export function analyserSpectrum(samples, fftSize) {
	const re = new Float64Array(fftSize)
	const im = new Float64Array(fftSize)
	const offset = samples.length - fftSize
	const a0 = 0.42
	const a1 = 0.5
	const a2 = 0.08
	for (let n = 0; n < fftSize; n++) {
		const x = offset + n >= 0 ? samples[offset + n] : 0
		const w = a0 - a1 * Math.cos((2 * Math.PI * n) / fftSize) + a2 * Math.cos((4 * Math.PI * n) / fftSize)
		re[n] = x * w
	}
	fft(re, im)
	const out = new Float32Array(fftSize / 2)
	for (let k = 0; k < out.length; k++) {
		const magnitude = Math.hypot(re[k], im[k]) / fftSize
		out[k] = 20 * Math.log10(magnitude)
	}
	return out
}

/**
 * Overall level of a dB spectrum in the chroma range - for the listening
 * gates (lib/listenGates.js), computed here because it walks the same bins.
 *
 * @param {Float32Array} dbSpectrum
 * @param {number} sampleRate
 * @param {number} fftSize
 * @return {number} level in dB (sum of magnitudes), -Infinity for silence
 */
export function spectrumLevelDb(dbSpectrum, sampleRate, fftSize) {
	const [from, to] = binRange(sampleRate, fftSize)
	let sum = 0
	for (let k = from; k <= to; k++) {
		const db = dbSpectrum[k]
		if (db > ANALYSER_MIN_DB) {
			sum += 10 ** (db / 20)
		}
	}
	return sum > 0 ? 20 * Math.log10(sum) : -Infinity
}

/**
 * Magnitude spectrum → 36-bin chroma, L2-normalised.
 *
 * Each FFT bin is spread over the two nearest chroma bins by its fractional
 * position: low notes lie closer together than one FFT bin (5.9 Hz at
 * 48 kHz/8192, a semitone at 82 Hz is 4.9 Hz), and a hard assignment would
 * flip between neighbours with every small tuning change.
 *
 * Bin layout: pitch class pc at concert pitch sits in bin 3·pc + 1; bins
 * 3·pc and 3·pc + 2 are a third of a semitone below and above.
 *
 * @param {Float32Array} dbSpectrum as from getFloatFrequencyData
 * @param {number} sampleRate
 * @param {number} fftSize
 * @return {?Float32Array} 36 values, or null if nothing is in range
 */
export function chroma36(dbSpectrum, sampleRate, fftSize) {
	const out = new Float32Array(12 * SUB_BINS)
	const [from, to] = binRange(sampleRate, fftSize)
	let any = false
	for (let k = from; k <= to; k++) {
		const db = dbSpectrum[k]
		if (!(db > ANALYSER_MIN_DB)) {
			continue
		}
		const magnitude = 10 ** (db / 20)
		const hz = (k * sampleRate) / fftSize
		// Position in live bins, measured so that pitch class 0 (C) at
		// concert pitch lands on the centre of bin 1.
		const midi = 69 + 12 * Math.log2(hz / 440)
		const position = midi * SUB_BINS + 1
		const lower = Math.floor(position)
		const fraction = position - lower
		out[mod(lower, out.length)] += magnitude * (1 - fraction)
		out[mod(lower + 1, out.length)] += magnitude * fraction
		any = true
	}
	return any && normalize(out) ? out : null
}

/**
 * A running tuning estimate. Unwrapped on purpose: a choir that sinks by
 * 80 cents must read as -80, not as +20 relative to the next semitone - the
 * folding would otherwise turn a C major chord into a B major one.
 *
 * @param {object} [options]
 * @param {number} [options.smoothing] weight of a new observation (0..1)
 * @param {number} [options.initialCents]
 * @return {{cents: number}}
 */
export function createTuningState({ smoothing = 0.02, initialCents = 0 } = {}) {
	return { cents: initialCents, smoothing }
}

/**
 * Tuning offset seen in one 36-bin frame: the circular mean of the energy
 * over the three sub-bin positions, in cents, between -50 and +50.
 *
 * @param {Float32Array} c36
 * @return {?number} null if the frame carries no direction (e.g. noise)
 */
export function frameTuningCents(c36) {
	let x = 0
	let y = 0
	let total = 0
	for (let b = 0; b < c36.length; b++) {
		// Sub-bin 1 is concert pitch, 0 and 2 a third of a semitone off.
		const angle = (2 * Math.PI * (mod(b, SUB_BINS) - 1)) / SUB_BINS
		x += c36[b] * Math.cos(angle)
		y += c36[b] * Math.sin(angle)
		total += c36[b]
	}
	// Equal energy on all three positions (broadband noise) has no
	// direction; reading an angle out of it would be a guess.
	if (total <= 0 || Math.hypot(x, y) / total < 0.1) {
		return null
	}
	return (Math.atan2(y, x) / (2 * Math.PI)) * SUB_BINS * CENTS_PER_BIN
}

/**
 * Fold 36 bins to 12 at the current tuning estimate, and update it.
 *
 * Each pitch class collects the live bins within one semitone of its
 * (shifted) centre, weighted by a triangle - the same spreading chroma36
 * used, so a note between two bins counts once, not twice.
 *
 * @param {Float32Array} c36
 * @param {{cents: number, smoothing: number}} tuning updated in place
 * @param {object} [options]
 * @param {boolean} [options.learn] update the estimate from this frame
 *   (false for frames the gates did not accept as music)
 * @return {{chroma: Float32Array, tuningCents: number}}
 */
export function fold12(c36, tuning, { learn = true } = {}) {
	if (learn) {
		const seen = frameTuningCents(c36)
		if (seen !== null) {
			// Take the representative of the observation nearest to the
			// current estimate - that is what keeps the estimate unwrapped.
			const step = 100
			const nearest = seen + step * Math.round((tuning.cents - seen) / step)
			tuning.cents += tuning.smoothing * (nearest - tuning.cents)
		}
	}
	const chroma = new Float32Array(12)
	const shift = tuning.cents / CENTS_PER_BIN
	for (let pc = 0; pc < 12; pc++) {
		const centre = pc * SUB_BINS + 1 + shift
		let sum = 0
		for (let b = Math.floor(centre - SUB_BINS / 2); b <= Math.ceil(centre + SUB_BINS / 2); b++) {
			const weight = 1 - Math.abs(b - centre) / (SUB_BINS / 2)
			if (weight > 0) {
				sum += weight * c36[mod(b, c36.length)]
			}
		}
		chroma[pc] = sum
	}
	normalize(chroma)
	return { chroma, tuningCents: tuning.cents }
}

/**
 * Chroma frames → CENS (chroma energy normalised statistics, Müller): the
 * feature for finding a position again after a jump. Quantising throws away
 * the fine dynamics a live choir never reproduces; smoothing over about a
 * second throws away the exact timing, which a jump search does not know
 * yet anyway; downsampling makes the search over a whole piece affordable.
 *
 * @param {Array<?Float32Array>} frames 12-bin chroma per frame, null = silence
 * @param {number} frameMs spacing of `frames`
 * @param {object} [options]
 * @param {number} [options.targetMs] spacing of the result
 * @param {number} [options.smoothMs] length of the Hann smoothing window
 * @return {Float32Array[]} 12 values per result frame, L2-normalised (zeros where silent)
 */
export function toCens(frames, frameMs, { targetMs = 200, smoothMs = 1000 } = {}) {
	const thresholds = [0.05, 0.1, 0.2, 0.4]
	const quantised = frames.map((frame) => {
		const q = new Float32Array(12)
		if (!frame) {
			return q
		}
		let l1 = 0
		for (let i = 0; i < 12; i++) {
			l1 += Math.abs(frame[i])
		}
		if (l1 <= 0) {
			return q
		}
		for (let i = 0; i < 12; i++) {
			const share = frame[i] / l1
			for (const threshold of thresholds) {
				if (share >= threshold) {
					q[i] += 1
				}
			}
		}
		return q
	})
	const half = Math.max(1, Math.round(smoothMs / frameMs / 2))
	const window = []
	for (let i = -half; i <= half; i++) {
		window.push(0.5 + 0.5 * Math.cos((Math.PI * i) / (half + 1)))
	}
	const step = Math.max(1, Math.round(targetMs / frameMs))
	const result = []
	for (let centre = 0; centre < quantised.length; centre += step) {
		const out = new Float32Array(12)
		for (let i = -half; i <= half; i++) {
			const frame = quantised[centre + i]
			if (!frame) {
				continue
			}
			const w = window[i + half]
			for (let pc = 0; pc < 12; pc++) {
				out[pc] += w * frame[pc]
			}
		}
		normalize(out)
		result.push(out)
	}
	return result
}

/**
 * Cosine similarity of two L2-normalised vectors (0 if either is zero).
 *
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @return {number}
 */
export function similarity(a, b) {
	let sum = 0
	for (let i = 0; i < a.length; i++) {
		sum += a[i] * b[i]
	}
	return sum
}

/**
 * @param {Float32Array} v normalised in place
 * @return {boolean} false if v is all zeros
 */
export function normalize(v) {
	let sum = 0
	for (let i = 0; i < v.length; i++) {
		sum += v[i] * v[i]
	}
	if (sum <= 0) {
		return false
	}
	const scale = 1 / Math.sqrt(sum)
	for (let i = 0; i < v.length; i++) {
		v[i] *= scale
	}
	return true
}

function binRange(sampleRate, fftSize) {
	const from = Math.max(1, Math.ceil((CHROMA_MIN_HZ * fftSize) / sampleRate))
	const to = Math.min(fftSize / 2 - 1, Math.floor((CHROMA_MAX_HZ * fftSize) / sampleRate))
	return [from, to]
}

function mod(n, m) {
	return ((n % m) + m) % m
}
