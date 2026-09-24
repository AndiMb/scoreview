// Tonhoehe einer einzelnen Singstimme - rein, ohne DOM und ohne AudioContext,
// damit sie mit synthetischen und aufgezeichneten Signalen testbar ist (N-D2).
// Laeuft im Browser in einem Web Worker (workers/pitchWorker.js).
//
// **YIN** (de Cheveigné/Kawahara 2002) auf Rahmen von 1024 Samples bei 16 kHz
// (64 ms) mit 20 ms Vorschub. 64 ms fassen bei 70 Hz noch
// mehr als vier Perioden - genug fuer jede Chorstimme bis in den Bass.
//
// **Ehrlich „nicht auswertbar" statt geraten.** YIN allein findet
// auch in zwei Stimmen eine Periode: Bei einer Quinte (3:2) ist das Signal
// mit dem gemeinsamen Grundton periodisch, eine Oktave unter der tieferen
// Stimme, und YIN meldet ihn mit bester Sicherheit. Zwei Stimmen saehen dann
// aus wie eine, die eine Oktave daneben liegt. Deshalb zusaetzlich ein Blick
// ins Spektrum:
//
// - **Grundton vorhanden?** Eine Stimme hat Energie bei ihrem Grundton. Der
//   „gemeinsame Grundton" zweier Stimmen hat keine - dort liegt nichts.
// - **Harmonischer Anteil:** Wie viel der Energie auf den Vielfachen des
//   gefundenen Grundtons liegt. Bei einer Stimme fast alles; bei einer Terz
//   liegt die zweite Stimme zwischen den Teiltoenen der ersten.
//
// Beides fliesst in die `clarity` (0..1). Unter der Schwelle gilt der Rahmen
// als stimmlos oder mehrstimmig - dieselbe Aussage fuer die Anzeige, und
// genau die, die hier verlangt sind. Eine Oktavverdopplung (zwei Stimmen im
// Abstand einer Oktave) bleibt davon unberuehrt: Sie ist musikalisch ein
// Unisono und wird wie eine Stimme bewertet.

export const SAMPLE_RATE = 16000
export const FRAME_SIZE = 1024
export const HOP_SIZE = 320
/** Unter dieser Sicherheit: stimmlos oder mehrstimmig. */
export const CLARITY_THRESHOLD = 0.7

const DEFAULTS = {
	minHz: 70,
	maxHz: 1100,
	yinThreshold: 0.15,
	// -40 dBFS: darunter ist es Stille oder Rauschen im Raum.
	silenceRms: 0.01,
	// Bis hierher wird das Spektrum betrachtet - darueber traegt eine
	// Singstimme kaum noch, der Tiefpass der Aufnahme kappt ohnehin bei 6,5 kHz.
	spectrumMaxHz: 4000,
	// Energie des Grundtons mindestens 1 % der staerksten Harmonischen
	// (-20 dB). Auch ein Bass am Telefonmikrofon liegt darueber; eine
	// fehlende Grundfrequenz zweier Stimmen liegt bei null.
	fundamentalMinRatio: 0.01,
}

const FFT_SIZE = 2048

/**
 * @param {Float32Array} frame FRAME_SIZE Samples
 * @param {number} [sampleRate]
 * @param {object} [options] siehe DEFAULTS
 * @return {{hz:?number, clarity:number, rms:number}}
 */
export function detectPitch(frame, sampleRate = SAMPLE_RATE, options = {}) {
	const o = { ...DEFAULTS, ...options }
	const rms = rootMeanSquare(frame)
	if (rms < o.silenceRms) {
		return { hz: null, clarity: 0, rms }
	}
	const yin = yinPitch(frame, sampleRate, o)
	if (yin === null) {
		return { hz: null, clarity: 0, rms }
	}
	const spectrum = harmonicAnalysis(frame, sampleRate, yin.hz, o)
	const clarity = spectrum.fundamentalPresent
		? Math.max(0, 1 - yin.aperiodicity) * spectrum.harmonicRatio
		: 0
	return { hz: yin.hz, clarity, rms }
}

/**
 * Eine ganze Aufnahme, Rahmen fuer Rahmen.
 *
 * @param {Float32Array} samples
 * @param {number} [sampleRate]
 * @param {object} [options]
 * @return {Array<{timeSec:number, hz:?number, clarity:number}>} Zeit = Rahmenmitte
 */
export function trackPitch(samples, sampleRate = SAMPLE_RATE, options = {}) {
	const result = []
	for (let start = 0; start + FRAME_SIZE <= samples.length; start += HOP_SIZE) {
		const { hz, clarity } = detectPitch(samples.subarray(start, start + FRAME_SIZE), sampleRate, options)
		result.push({ timeSec: (start + FRAME_SIZE / 2) / sampleRate, hz, clarity })
	}
	return result
}

/**
 * Fuer die Live-Anzeige: sammelt Bloecke und liefert je vollem Vorschub
 * einen Rahmen samt Kontextzeit seiner Mitte.
 *
 * @param {object} [options]
 * @return {{push: function(Float32Array, number): Array<{contextTimeSec:number, hz:?number, clarity:number}>, reset: function(): void}}
 */
export function createPitchStream(options = {}) {
	// Ein Puffer fuer vier Rahmen: Nachgerueckt wird erst, wenn er voll ist -
	// ein Verschieben je Sample waere im Worker die teuerste Zeile.
	const buf = new Float32Array(FRAME_SIZE * 4)
	let len = 0
	let sinceHop = 0
	return {
		/**
		 * @param {Float32Array} block 16-kHz-Samples
		 * @param {number} contextTimeSec Kontextzeit des ersten Samples im Block
		 * @return {Array<{contextTimeSec:number, hz:?number, clarity:number}>}
		 */
		push(block, contextTimeSec) {
			const out = []
			for (let i = 0; i < block.length; i++) {
				if (len === buf.length) {
					buf.copyWithin(0, len - FRAME_SIZE, len)
					len = FRAME_SIZE
				}
				buf[len++] = block[i]
				sinceHop++
				if (len >= FRAME_SIZE && sinceHop >= HOP_SIZE) {
					sinceHop = 0
					const { hz, clarity } = detectPitch(buf.subarray(len - FRAME_SIZE, len), SAMPLE_RATE, options)
					// Mitte des Rahmens: Sein letztes Sample ist block[i].
					const endSec = contextTimeSec + (i + 1) / SAMPLE_RATE
					out.push({ contextTimeSec: endSec - FRAME_SIZE / 2 / SAMPLE_RATE, hz, clarity })
				}
			}
			return out
		},
		reset() {
			len = 0
			sinceHop = 0
		},
	}
}

function rootMeanSquare(frame) {
	let sum = 0
	for (let i = 0; i < frame.length; i++) {
		sum += frame[i] * frame[i]
	}
	return Math.sqrt(sum / frame.length)
}

/**
 * YIN: Differenzfunktion, kumulativ normiert, erste Senke unter der Schwelle,
 * parabolisch verfeinert.
 *
 * @param frame
 * @param sampleRate
 * @param o
 * @return {?{hz:number, aperiodicity:number}}
 */
function yinPitch(frame, sampleRate, o) {
	const tauMin = Math.max(2, Math.floor(sampleRate / o.maxHz))
	const tauMax = Math.min(Math.floor(frame.length / 2), Math.ceil(sampleRate / o.minHz))
	const w = frame.length - tauMax
	const d = new Float64Array(tauMax + 2)
	for (let tau = 1; tau <= tauMax + 1 && tau + w <= frame.length; tau++) {
		let sum = 0
		for (let j = 0; j < w; j++) {
			const diff = frame[j] - frame[j + tau]
			sum += diff * diff
		}
		d[tau] = sum
	}
	const cmnd = new Float64Array(tauMax + 2)
	cmnd[0] = 1
	let running = 0
	for (let tau = 1; tau < d.length; tau++) {
		running += d[tau]
		cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1
	}

	let best = -1
	for (let tau = tauMin; tau <= tauMax; tau++) {
		if (cmnd[tau] < o.yinThreshold) {
			while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) {
				tau++
			}
			best = tau
			break
		}
	}
	if (best === -1) {
		// Keine Senke unter der Schwelle: die tiefste nehmen, ihre schlechte
		// Periodizitaet geht als niedrige Sicherheit weiter.
		let min = Infinity
		for (let tau = tauMin; tau <= tauMax; tau++) {
			if (cmnd[tau] < min) {
				min = cmnd[tau]
				best = tau
			}
		}
	}
	if (best <= 0) {
		return null
	}
	let tauExact = best
	if (best > 1 && best < d.length - 1) {
		const a = cmnd[best - 1]
		const b = cmnd[best]
		const c = cmnd[best + 1]
		const denom = a - 2 * b + c
		if (denom > 0) {
			tauExact = best + (a - c) / (2 * denom)
		}
	}
	return { hz: sampleRate / tauExact, aperiodicity: Math.max(0, cmnd[best]) }
}

/**
 * Wie viel der Energie auf den Vielfachen von `hz` liegt, und ob der
 * Grundton selbst traegt.
 *
 * @param frame
 * @param sampleRate
 * @param hz
 * @param o
 * @return {{harmonicRatio:number, fundamentalPresent:boolean}}
 */
function harmonicAnalysis(frame, sampleRate, hz, o) {
	const re = new Float64Array(FFT_SIZE)
	const im = new Float64Array(FFT_SIZE)
	const n = Math.min(frame.length, FFT_SIZE)
	for (let i = 0; i < n; i++) {
		// Hann-Fenster: Ohne es verschmieren die Teiltoene ueber das ganze
		// Spektrum und saehen aus wie Energie zwischen den Harmonischen.
		re[i] = frame[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))
	}
	fft(re, im)
	const binHz = sampleRate / FFT_SIZE
	const minBin = Math.max(1, Math.floor(50 / binHz))
	const maxBin = Math.min(FFT_SIZE / 2 - 1, Math.ceil(o.spectrumMaxHz / binHz))
	const power = new Float64Array(maxBin + 1)
	let total = 0
	for (let k = minBin; k <= maxBin; k++) {
		power[k] = re[k] * re[k] + im[k] * im[k]
		total += power[k]
	}
	if (total <= 0) {
		return { harmonicRatio: 0, fundamentalPresent: false }
	}
	const mask = new Uint8Array(maxBin + 1)
	const bandEnergy = []
	for (let h = 1; h * hz <= o.spectrumMaxHz; h++) {
		const center = (h * hz) / binHz
		// Das Hauptmaximum des Hann-Fensters ist vier Bins breit; bei hohen
		// Teiltoenen zusaetzlich 3 % Spielraum fuer Vibrato im Rahmen.
		const halfWidth = Math.max(2.5, (0.03 * h * hz) / binHz)
		let energy = 0
		for (let k = Math.max(minBin, Math.floor(center - halfWidth)); k <= Math.min(maxBin, Math.ceil(center + halfWidth)); k++) {
			if (!mask[k]) {
				mask[k] = 1
				energy += power[k]
			}
		}
		bandEnergy.push(energy)
	}
	const harmonic = bandEnergy.reduce((s, e) => s + e, 0)
	const strongest = Math.max(0, ...bandEnergy.slice(0, 8))
	return {
		harmonicRatio: Math.min(1, harmonic / total),
		fundamentalPresent: bandEnergy.length > 0 && strongest > 0 && bandEnergy[0] >= o.fundamentalMinRatio * strongest,
	}
}

/**
 * Radix-2-FFT, an Ort und Stelle.
 *
 * @param {Float64Array} re
 * @param {Float64Array} im
 */
export function fft(re, im) {
	const n = re.length
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1
		for (; j & bit; bit >>= 1) {
			j ^= bit
		}
		j ^= bit
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]]
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const angle = (-2 * Math.PI) / len
		const wRe = Math.cos(angle)
		const wIm = Math.sin(angle)
		for (let i = 0; i < n; i += len) {
			let curRe = 1
			let curIm = 0
			for (let k = 0; k < len / 2; k++) {
				const aRe = re[i + k]
				const aIm = im[i + k]
				const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm
				const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe
				re[i + k] = aRe + bRe
				im[i + k] = aIm + bIm
				re[i + k + len / 2] = aRe - bRe
				im[i + k + len / 2] = aIm - bIm
				const nextRe = curRe * wRe - curIm * wIm
				curIm = curRe * wIm + curIm * wRe
				curRe = nextRe
			}
		}
	}
}
