// The singer's own voice for the microphone follower - pure, no DOM, no
// AudioContext.
//
// Why a pitch at all, when chroma (lib/chroma.js) deliberately follows the
// whole choir: the phone sits next to one singer, whose voice is the loudest
// thing it hears. Measured on rehearsal recordings (one bass singer, twelve
// takes): where this estimate is clear (56-82 % of the sung time), it lies
// within a quarter tone of the bass line at the true place in 71-86 % of the
// frames, but only in 9-76 % two seconds away - the chroma of the whole
// choir fits the true place only slightly better than its neighbours. One
// line against one part separates places the chord cannot.
//
// Why from the magnitude spectrum: the follower reads nothing but
// AnalyserNode.getFloatFrequencyData (S7 in docs/architecture.md), and the
// estimate must be the same in the viewer and in the replay of recordings.
// A harmonic sum over a log grid of candidates finds the fundamental whose
// partials carry the most energy; `clarity` is the share of all energy on
// those partials. Measured against YIN on the samples (lib/pitchDetect.js):
// the same agreement with the sung part, on more frames.

/** Below this share of energy on the partials, nobody clearly dominates. */
export const VOICE_MIN_CLARITY = 0.5
/** Below this, the "fundamental" has no energy of its own - a common root of two voices. */
export const VOICE_MIN_FUNDAMENTAL = 0.1

const ANALYSER_MIN_DB = -100

/**
 * @param {number} sampleRate
 * @param {number} fftSize of the AnalyserNode
 * @param {object} [options]
 * @param {number} [options.minHz] lowest fundamental (a bass)
 * @param {number} [options.maxHz] highest fundamental (a soprano)
 * @param {number} [options.stepCents] candidate spacing
 * @param {number} [options.harmonics] partials summed per candidate
 * @param {number} [options.decay] weight of each further partial
 * @param {number} [options.spectrumMaxHz] energy above is not looked at
 * @return {(db: Float32Array) => ?{hz:number, clarity:number, fundamental:number}}
 */
export function createVoicePitch(sampleRate, fftSize, { minHz = 70, maxHz = 1000, stepCents = 10, harmonics = 6, decay = 0.75, spectrumMaxHz = 4000 } = {}) {
	const binHz = sampleRate / fftSize
	const candidates = []
	for (let cents = 0; ; cents += stepCents) {
		const hz = minHz * 2 ** (cents / 1200)
		if (hz > maxHz) {
			break
		}
		candidates.push(hz)
	}
	const firstBin = Math.max(1, Math.floor(minHz / binHz))
	const lastBin = Math.min(fftSize / 2 - 2, Math.floor(spectrumMaxHz / binHz))
	const mag = new Float32Array(fftSize / 2)
	// A partial between two bins: the larger of the three around it.
	const at = (hz) => {
		const k = Math.round(hz / binHz)
		if (k < firstBin || k > lastBin) {
			return 0
		}
		return Math.max(mag[k], mag[k - 1], mag[k + 1])
	}

	return function estimate(db) {
		let total = 0
		for (let k = firstBin - 1; k <= lastBin + 1; k++) {
			const m = db[k] <= ANALYSER_MIN_DB ? 0 : 10 ** (db[k] / 20)
			mag[k] = m
			if (k >= firstBin && k <= lastBin) {
				total += m * m
			}
		}
		if (!(total > 0)) {
			return null
		}
		let best = -1
		let hz = 0
		for (const f of candidates) {
			let sum = 0
			let weight = 1
			for (let h = 1; h <= harmonics; h++) {
				sum += weight * at(f * h)
				weight *= decay
			}
			if (sum > best) {
				best = sum
				hz = f
			}
		}
		let onPartials = 0
		for (let h = 1; hz * h <= spectrumMaxHz; h++) {
			const k = Math.round((hz * h) / binHz)
			for (let q = k - 1; q <= k + 1; q++) {
				if (q >= firstBin && q <= lastBin) {
					onPartials += mag[q] * mag[q]
				}
			}
		}
		let peak = 0
		for (let h = 1; h <= harmonics; h++) {
			peak = Math.max(peak, at(hz * h))
		}
		return { hz, clarity: onPartials / total, fundamental: peak > 0 ? at(hz) / peak : 0 }
	}
}

/**
 * The voice as a MIDI pitch, or null where no single voice is clear.
 *
 * @param {?{hz:number, clarity:number, fundamental:number}} estimate
 * @return {?number}
 */
export function clearVoiceMidi(estimate) {
	if (!estimate || estimate.clarity < VOICE_MIN_CLARITY || estimate.fundamental < VOICE_MIN_FUNDAMENTAL) {
		return null
	}
	return 69 + 12 * Math.log2(estimate.hz / 440)
}

/**
 * Distance of two pitches as pitch classes, in semitones (-6..6): a bass
 * reading the tenor clef an octave off, or a phone hearing the second
 * partial louder than the first, is still on the line.
 *
 * @param {number} a
 * @param {number} b
 * @return {number}
 */
export function pitchClassDistance(a, b) {
	let d = (a - b) % 12
	if (d >= 6) {
		d -= 12
	} else if (d < -6) {
		d += 12
	}
	return d
}

/**
 * The line of one part per reference frame: the MIDI pitch of its highest
 * sounding note, NaN where it rests.
 *
 * @param {Array<{onMs:number, offMs:number, pitch:number, channel:number}>} notes
 * @param {Iterable<number>} channels of the part
 * @param {number} frames
 * @param {number} frameMs
 * @return {Float32Array}
 */
export function partLine(notes, channels, frames, frameMs) {
	const line = new Float32Array(frames).fill(NaN)
	const set = new Set(channels)
	for (const note of notes) {
		if (!set.has(note.channel)) {
			continue
		}
		const first = Math.max(0, Math.floor(note.onMs / frameMs))
		const last = Math.min(frames - 1, Math.floor((note.offMs - 1e-6) / frameMs))
		for (let j = first; j <= last; j++) {
			if (!(line[j] >= note.pitch)) {
				line[j] = note.pitch
			}
		}
	}
	return line
}
