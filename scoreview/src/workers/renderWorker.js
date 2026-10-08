// Rendert einen Uebe-Track (H1/H10): MIDI + SoundFont nach einem Plan aus
// lib/exportPlan.js, gemischt wie im Viewer, dann MP3 mit ID3-Kopf.
//
// Eigener Worker mit spessasynth_core direkt, nicht der WorkerSynthesizer der
// lib und kein OfflineAudioContext (Entwurf V3): Er laeuft unabhaengig vom
// spielenden Player, und Chromium leitet Worklet-Nachrichten im
// OfflineAudioContext nicht weiter (Hinweis der Bibliothek). Gemessen
// (M-C, Galaxy S23): 191 s Musik in 16 s, drei Viertel davon MP3.
//
// Gemischt wird HIER, nicht im Synthesizer: Das Panorama der eigenen Stimme
// sitzt im Viewer hinter dem Synthesizer (StereoPannerNode je Kanal, warum
// nicht CC10 steht in lib/player.js). Der Worker bekommt deshalb jeden Kanal
// einzeln (processSplit) und legt ihn nach derselben Kurve wie der
// StereoPannerNode in die Summe. Der Effektbus bleibt in der Mitte, wie dort.

import { Mp3Encoder } from '@breezystack/lamejs'
import { BasicMIDI, BasicSoundBank, SoundBankLoader, SpessaSynthProcessor, SpessaSynthSequencer } from 'spessasynth_core'
import { id3v23 } from '../lib/id3.js'

const SAMPLE_RATE = 44100
const BLOCK = 128
const CHANNELS = 16
/** CC7, wie in lib/player.js. */
const CC_VOLUME = 7
/** −1 dBFS: Platz fuer die MP3-Kodierung, die Spitzen leicht anhebt. */
const TARGET_PEAK = 0.891
/** Nie mehr als +12 dB: Eine sehr leise Partitur soll nicht rauschen. */
const MAX_GAIN = 4

self.onmessage = async ({ data }) => {
	try {
		const mp3 = await render(data)
		self.postMessage({ type: 'done', mp3 }, [mp3.buffer])
	} catch (err) {
		self.postMessage({ type: 'error', message: String(err?.message ?? err) })
	}
}

/**
 * @param {object} job
 * @param {ArrayBuffer} job.midi
 * @param {ArrayBuffer} job.soundFont
 * @param {import('../lib/exportPlan.js').ExportPlan} job.plan
 * @param {object} job.tags fuer id3v23
 * @param {number} [job.kbps]
 * @return {Promise<Uint8Array>}
 */
async function render({ midi, soundFont, plan, tags, kbps = 128 }) {
	await BasicSoundBank.isSF3DecoderReady
	const synth = new SpessaSynthProcessor(SAMPLE_RATE, { eventsEnabled: false, effectsEnabled: true })
	await synth.processorInitialized
	synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(soundFont), 'main')
	synth.setSystemParameter('autoAllocateVoices', true)
	// Die globale Transposition: uebersteht Suchlaeufe, laesst Schlagzeug aus
	// (gemessen fuer den Player, P2.1 - derselbe Kern).
	synth.setSystemParameter('keyShift', plan.transpose)

	const seq = new SpessaSynthSequencer(synth)
	seq.loadNewSongList([BasicMIDI.fromArrayBuffer(midi, 'score.mid')])
	seq.playbackRate = plan.rate
	// Lautstaerke und Instrument je Kanal wie im Viewer - verriegelt, damit
	// weder der Reset beim Suchlauf noch das MIDI selbst sie zuruecksetzen.
	for (const ch of plan.channels) {
		const channel = synth.midiChannels[ch.channel]
		if (!channel) {
			continue
		}
		if (ch.program !== null) {
			channel.setSystemParameter('presetLock', false)
			synth.programChange(ch.channel, ch.program)
			channel.setSystemParameter('presetLock', true)
		}
		channel.lockController(CC_VOLUME, false)
		synth.controllerChange(ch.channel, CC_VOLUME, ch.volume)
		channel.lockController(CC_VOLUME, true)
	}
	seq.play()
	seq.currentTime = plan.startMs / 1000

	const total = Math.ceil(plan.outputSeconds * SAMPLE_RATE)
	const outL = new Float32Array(total)
	const outR = new Float32Array(total)
	const dry = Array.from({ length: CHANNELS }, () => [new Float32Array(BLOCK), new Float32Array(BLOCK)])
	const wetL = new Float32Array(BLOCK)
	const wetR = new Float32Array(BLOCK)
	const gains = panGains(plan.channels)

	let lastReport = 0
	for (let index = 0; index < total; index += BLOCK) {
		const n = Math.min(BLOCK, total - index)
		// processSplit MISCHT in die Puffer - also je Block leeren.
		for (const [l, r] of dry) {
			l.fill(0)
			r.fill(0)
		}
		wetL.fill(0)
		wetR.fill(0)
		seq.processTick()
		synth.processSplit(dry, wetL, wetR, 0, n)
		for (let c = 0; c < CHANNELS; c++) {
			const [l, r] = dry[c]
			const g = gains[c]
			for (let i = 0; i < n; i++) {
				outL[index + i] += l[i] * g.ll + r[i] * g.rl
				outR[index + i] += r[i] * g.rr + l[i] * g.lr
			}
		}
		for (let i = 0; i < n; i++) {
			outL[index + i] += wetL[i]
			outR[index + i] += wetR[i]
		}
		if (index - lastReport > SAMPLE_RATE * 2) {
			lastReport = index
			self.postMessage({ type: 'progress', stage: 'render', p: index / total })
		}
	}

	addClicks(outL, outR, plan)
	normalize(outL, outR)
	return encode(outL, outR, kbps, tags)
}

/**
 * Die Kurve des StereoPannerNode fuer ein Stereo-Eingangssignal
 * (Web-Audio-Spezifikation, „StereoPanner algorithm"): Unter 0 wandert die
 * rechte Seite nach links, ueber 0 die linke nach rechts.
 *
 * @param {Array<{channel:number, pan:number}>} channels
 * @return {Array<{ll:number, rl:number, rr:number, lr:number}>} je MIDI-Kanal
 */
function panGains(channels) {
	const gains = Array.from({ length: CHANNELS }, () => ({ ll: 1, rl: 0, rr: 1, lr: 0 }))
	for (const ch of channels) {
		const pan = Math.max(-1, Math.min(1, ch.pan ?? 0))
		const x = pan <= 0 ? pan + 1 : pan
		const gL = Math.cos(x * Math.PI / 2)
		const gR = Math.sin(x * Math.PI / 2)
		gains[ch.channel] = pan <= 0
			? { ll: 1, rl: gL, rr: gR, lr: 0 }
			: { ll: gL, rl: 0, rr: 1, lr: gR }
	}
	return gains
}

/**
 * Metronom wie lib/metronomeClick.js: 1000 Hz, betont 1500 Hz, 0,3 und in
 * 50 ms exponentiell auf 0,001.
 *
 * @param {Float32Array} outL
 * @param {Float32Array} outR
 * @param {import('../lib/exportPlan.js').ExportPlan} plan
 */
function addClicks(outL, outR, plan) {
	const length = Math.round(0.06 * SAMPLE_RATE)
	for (const click of plan.clicks) {
		const start = Math.round((click.timeMs - plan.startMs) / plan.rate / 1000 * SAMPLE_RATE)
		const freq = click.accent ? 1500 : 1000
		for (let i = 0; i < length && start + i < outL.length; i++) {
			if (start + i < 0) {
				continue
			}
			const t = i / SAMPLE_RATE
			const v = 0.3 * Math.pow(0.001 / 0.3, t / 0.05) * Math.sin(2 * Math.PI * freq * t)
			outL[start + i] += v
			outR[start + i] += v
		}
	}
}

/**
 * Auf −1 dBFS: Der Browser-Mixdown liegt rund 7 dB unter MuseScores eigenem
 * Render (limits.md) - im Autoradio waere das zu leise. Im Viewer gibt es
 * dafuer bewusst keinen Faktor (Clipping-Risiko in Echtzeit); hier ist die
 * Spitze vorher bekannt.
 *
 * @param {Float32Array} outL
 * @param {Float32Array} outR
 */
function normalize(outL, outR) {
	let peak = 0
	for (let i = 0; i < outL.length; i++) {
		peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]))
	}
	if (peak === 0) {
		return
	}
	const gain = Math.min(MAX_GAIN, TARGET_PEAK / peak)
	for (let i = 0; i < outL.length; i++) {
		outL[i] *= gain
		outR[i] *= gain
	}
}

/**
 * @param {Float32Array} outL
 * @param {Float32Array} outR
 * @param {number} kbps
 * @param {object} tags
 * @return {Uint8Array}
 */
function encode(outL, outR, kbps, tags) {
	const encoder = new Mp3Encoder(2, SAMPLE_RATE, kbps)
	const parts = [id3v23(tags)]
	const chunk = 1152 * 20
	const l16 = new Int16Array(chunk)
	const r16 = new Int16Array(chunk)
	let lastReport = 0
	for (let start = 0; start < outL.length; start += chunk) {
		const end = Math.min(outL.length, start + chunk)
		const n = end - start
		for (let i = 0; i < n; i++) {
			l16[i] = toInt16(outL[start + i])
			r16[i] = toInt16(outR[start + i])
		}
		const out = encoder.encodeBuffer(l16.subarray(0, n), r16.subarray(0, n))
		if (out.length > 0) {
			parts.push(new Uint8Array(out))
		}
		if (start - lastReport > SAMPLE_RATE * 5) {
			lastReport = start
			self.postMessage({ type: 'progress', stage: 'encode', p: start / outL.length })
		}
	}
	const last = encoder.flush()
	if (last.length > 0) {
		parts.push(new Uint8Array(last))
	}
	const size = parts.reduce((sum, p) => sum + p.length, 0)
	const mp3 = new Uint8Array(size)
	let offset = 0
	for (const p of parts) {
		mp3.set(p, offset)
		offset += p.length
	}
	return mp3
}

/**
 * @param {number} v
 * @return {number}
 */
function toInt16(v) {
	const c = Math.max(-1, Math.min(1, v))
	return c < 0 ? c * 0x8000 : c * 0x7FFF
}
