// SoundFont rendering for the measuring rig: performances that sound like
// the viewer's playback (FluidR3 piano and choir aahs instead of additive
// tones), and the "rendered" reference the follower plan compares against
// the note template (decision at checkpoint 2). Local only - the repository
// has no SoundFont; pass one with --soundfont.
//
// Uses spessasynth_core directly, like workers/renderWorker.js; it is a
// transitive dependency of spessasynth_lib and stays one as long as only
// tools/ use it this way.

import { BasicSoundBank, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core'
import { analyserSpectrum, chroma36, createTuningState, fold12, normalize, toCens } from '../../src/lib/chroma.js'
import { buildFollowReference } from '../../src/lib/followRef.js'

const BLOCK = 128
const CHANNELS = 16
/** Pitch wheel centre and the default bend range of ±2 semitones. */
const WHEEL_CENTRE = 8192
const WHEEL_CENTS = 200

/**
 * @param {ArrayBuffer} soundFont
 * @param {number} sampleRate
 * @param {Map<number, number>} programs GM program per channel
 * @return {Promise<SpessaSynthProcessor>}
 */
async function createSynth(soundFont, sampleRate, programs) {
	await BasicSoundBank.ready
	const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false, effectsEnabled: false })
	await synth.ready
	synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(soundFont), 'main')
	synth.setSystemParameter('autoAllocateVoices', true)
	for (const [channel, program] of programs) {
		synth.programChange(channel, program)
	}
	return synth
}

/**
 * Render scheduled notes into one mono buffer per channel.
 *
 * @param {SpessaSynthProcessor} synth
 * @param {Array<{onMs:number, offMs:number, pitch:number, channel:number, gain?:number, cents?:number}>} scheduled
 * @param {number} sampleRate
 * @param {number} length samples
 * @return {Float32Array[]} per channel
 */
function renderChannels(synth, scheduled, sampleRate, length) {
	const events = []
	for (const n of scheduled) {
		const velocity = Math.max(1, Math.min(127, Math.round(80 * Math.sqrt(n.gain ?? 1))))
		events.push({ at: Math.floor((n.onMs / 1000) * sampleRate), on: true, n, velocity })
		events.push({ at: Math.floor((n.offMs / 1000) * sampleRate), on: false, n })
	}
	// Offs before ons at the same sample: a repeated note must sound again.
	events.sort((a, b) => a.at - b.at || Number(a.on) - Number(b.on))
	const out = Array.from({ length: CHANNELS }, () => new Float32Array(length))
	const dry = Array.from({ length: CHANNELS }, () => [new Float32Array(BLOCK), new Float32Array(BLOCK)])
	// The mix is not used, process() just needs somewhere to write it: the
	// rig wants each channel dry, and those come as channel outputs.
	const mixL = new Float32Array(BLOCK)
	const mixR = new Float32Array(BLOCK)
	// -1: set the wheel at each channel's first note - the synth keeps the
	// value of the previous render otherwise (measured: a case after the
	// drift case started 80 cents flat).
	const wheel = new Int32Array(CHANNELS).fill(-1)
	let next = 0
	for (let index = 0; index < length; index += BLOCK) {
		const count = Math.min(BLOCK, length - index)
		while (next < events.length && events[next].at < index + count) {
			const e = events[next++]
			if (e.on) {
				// Detuning by the pitch wheel, per channel, at each note-on.
				const value = Math.round(WHEEL_CENTRE + ((e.n.cents ?? 0) / WHEEL_CENTS) * WHEEL_CENTRE)
				if (value !== wheel[e.n.channel]) {
					synth.pitchWheel(e.n.channel, Math.max(0, Math.min(16383, value)))
					wheel[e.n.channel] = value
				}
				synth.noteOn(e.n.channel, e.n.pitch, e.velocity)
			} else {
				synth.noteOff(e.n.channel, e.n.pitch)
			}
		}
		for (const [l, r] of dry) {
			l.fill(0)
			r.fill(0)
		}
		mixL.fill(0)
		mixR.fill(0)
		synth.process(mixL, mixR, 0, count, dry)
		for (let c = 0; c < CHANNELS; c++) {
			const [l, r] = dry[c]
			const target = out[c]
			for (let i = 0; i < count; i++) {
				target[index + i] = 0.5 * (l[i] + r[i])
			}
		}
	}
	return out
}

/**
 * A `renderNotes` hook for tools/follow/synth.mjs::renderPerformance.
 *
 * @param {ArrayBuffer} soundFont
 * @param {number} sampleRate
 * @param {Map<number, number>} programs
 * @return {Promise<(scheduled: object[], samples: Float32Array) => void>}
 */
export async function soundFontNotes(soundFont, sampleRate, programs) {
	const synth = await createSynth(soundFont, sampleRate, programs)
	return (scheduled, samples) => {
		const channels = renderChannels(synth, scheduled, sampleRate, samples.length)
		for (const channel of channels) {
			for (let i = 0; i < samples.length; i++) {
				samples[i] += channel[i]
			}
		}
	}
}

/**
 * The reference from rendered sound instead of the note template: each
 * channel rendered once at score tempo, magnitude spectra summed per
 * ensemble (magnitudes of different instruments add up closely enough),
 * then the same chroma as live. Silence masks stay those of the notes -
 * a decaying piano tail is no note.
 *
 * @param {object[]} notes
 * @param {object[]} parts
 * @param {object} options
 * @param {ArrayBuffer} options.soundFont
 * @param {Map<number, number>} options.programs
 * @param {number} [options.sampleRate]
 * @param {number} options.durationMs
 * @param {number} [options.fftSize]
 * @return {Promise<import('../../src/lib/followRef.js').FollowReference>}
 */
export async function renderedReference(notes, parts, { soundFont, programs, sampleRate = 22050, durationMs, fftSize = 4096, ...rest }) {
	const reference = buildFollowReference(notes, parts, { durationMs, ...rest })
	const synth = await createSynth(soundFont, sampleRate, programs)
	const length = Math.ceil(((durationMs + 1000) / 1000) * sampleRate)
	const channels = renderChannels(synth, notes, sampleRate, length)
	const used = [...new Set(notes.map((n) => n.channel))]
	const frameMs = reference.frameMs
	const half = fftSize / 2
	// Linear magnitude spectra per channel and reference frame, window
	// centred on the middle of the frame.
	const spectra = new Map()
	for (const c of used) {
		const list = []
		for (let f = 0; f < reference.frames; f++) {
			const centre = Math.round((((f + 0.5) * frameMs) / 1000) * sampleRate)
			const end = Math.min(length, centre + half)
			const db = analyserSpectrum(channels[c].subarray(Math.max(0, end - fftSize), end), fftSize)
			list.push(Float32Array.from(db, (v) => (Number.isFinite(v) ? 10 ** (v / 20) : 0)))
		}
		spectra.set(c, list)
	}
	const tuning = createTuningState()
	const plan = parts.flatMap((p) => p.channels)
	reference.ensembles.forEach((ensemble, e) => {
		const members = e === 0 ? plan : ensembleChannels(reference, ensemble, parts)
		for (let f = 0; f < reference.frames; f++) {
			if (ensemble.silent[f]) {
				continue
			}
			const sum = new Float32Array(half)
			for (const c of members) {
				const s = spectra.get(c)?.[f]
				if (s) {
					for (let k = 0; k < half; k++) {
						sum[k] += s[k]
					}
				}
			}
			const db = Float32Array.from(sum, (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity))
			const c36 = chroma36(db, sampleRate, fftSize)
			const target = ensemble.chroma.subarray(f * 12, f * 12 + 12)
			if (c36) {
				target.set(fold12(c36, tuning, { learn: false }).chroma)
			}
			normalize(target)
		}
	})
	reference.cens = reference.ensembles.map(({ chroma, silent }) => toCens(
		Array.from({ length: reference.frames }, (_, f) => (silent[f] ? null : chroma.subarray(f * 12, f * 12 + 12))),
		frameMs,
		{ targetMs: reference.censMs },
	))
	return reference
}

function ensembleChannels(reference, ensemble, parts) {
	if (ensemble.id === 'accompaniment') {
		return parts.filter((p) => !p.vocal).flatMap((p) => p.channels)
	}
	if (ensemble.id === 'voices') {
		return parts.filter((p) => p.vocal).flatMap((p) => p.channels)
	}
	const ids = ensemble.id.split('+').map((s) => s.replace(/^part:/, ''))
	return parts.filter((p) => ids.includes(p.id)).flatMap((p) => p.channels)
}
