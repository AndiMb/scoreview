// WAV lesen und schreiben - rein, ohne DOM und ohne AudioContext.
//
// Das Format ist festgelegt (docs/architecture.md, Abschnitt Mikrofon): PCM, mono, 16 kHz, 16 bit. Klein genug fuer
// den Upload (zehn Minuten ~ 19 MB), und genau das, was die
// Tonhoehenerkennung braucht (lib/pitchDetect.js rechnet mit 16 kHz). Der
// Server prueft denselben Kopf nach (Service\WavFormat) - wer hier etwas
// aendert, muss es dort mitziehen.
//
// Eigener Leser statt `decodeAudioData` fuer die Auswertung: Der Browser
// resampelt beim Dekodieren auf die Rate seines AudioContext, und die
// Intonation soll auf genau den Samples rechnen, die aufgenommen wurden.
// Zum ABSPIELEN geht es dagegen ueber `decodeAudioData` (useRecorder.js) -
// dort ist das Resampeln erwuenscht.

export const WAV_SAMPLE_RATE = 16000
const HEADER_BYTES = 44

/**
 * Gleitkomma (-1..1) in 16-bit-Ganzzahlen, mit Begrenzung statt
 * Ueberlauf: Ein uebersteuerter Wert wuerde sonst ins Gegenteil kippen und
 * als Knacken hoerbar.
 *
 * @param {Float32Array} samples
 * @return {Int16Array}
 */
export function floatToInt16(samples) {
	const out = new Int16Array(samples.length)
	for (let i = 0; i < samples.length; i++) {
		const v = Math.max(-1, Math.min(1, samples[i]))
		out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff)
	}
	return out
}

/**
 * Baut eine WAV aus Bloecken, wie sie das Aufnahme-Worklet liefert - ohne
 * sie vorher zu einem grossen Float-Puffer zusammenzukleben.
 *
 * @param {Array<Float32Array>|Float32Array} chunks
 * @param {number} [sampleRate]
 * @return {ArrayBuffer}
 */
export function encodeWav(chunks, sampleRate = WAV_SAMPLE_RATE) {
	const list = chunks instanceof Float32Array ? [chunks] : chunks
	const total = list.reduce((sum, c) => sum + c.length, 0)
	const dataBytes = total * 2
	const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes)
	const view = new DataView(buffer)
	writeAscii(view, 0, 'RIFF')
	view.setUint32(4, 36 + dataBytes, true)
	writeAscii(view, 8, 'WAVE')
	writeAscii(view, 12, 'fmt ')
	view.setUint32(16, 16, true)
	view.setUint16(20, 1, true) // PCM
	view.setUint16(22, 1, true) // mono
	view.setUint32(24, sampleRate, true)
	view.setUint32(28, sampleRate * 2, true)
	view.setUint16(32, 2, true)
	view.setUint16(34, 16, true)
	writeAscii(view, 36, 'data')
	view.setUint32(40, dataBytes, true)
	let offset = HEADER_BYTES
	for (const chunk of list) {
		const ints = floatToInt16(chunk)
		for (let i = 0; i < ints.length; i++) {
			view.setInt16(offset, ints[i], true)
			offset += 2
		}
	}
	return buffer
}

/**
 * Liest eine PCM-WAV mit 16 bit, mono oder mehrkanalig (dann auf mono
 * gemittelt). Fremde Bloecke (LIST, …) werden uebersprungen.
 *
 * @param {ArrayBuffer} buffer
 * @return {{sampleRate:number, samples:Float32Array}}
 * @throws {Error} bei allem, was keine solche WAV ist
 */
export function decodeWav(buffer) {
	const view = new DataView(buffer)
	if (buffer.byteLength < HEADER_BYTES || readAscii(view, 0) !== 'RIFF' || readAscii(view, 8) !== 'WAVE') {
		throw new Error('Keine WAV-Datei')
	}
	let offset = 12
	let format = null
	while (offset + 8 <= buffer.byteLength) {
		const id = readAscii(view, offset)
		const size = view.getUint32(offset + 4, true)
		const body = offset + 8
		if (id === 'fmt ') {
			format = {
				audioFormat: view.getUint16(body, true),
				channels: view.getUint16(body + 2, true),
				sampleRate: view.getUint32(body + 4, true),
				bits: view.getUint16(body + 14, true),
			}
		} else if (id === 'data') {
			if (!format || format.audioFormat !== 1 || format.bits !== 16 || format.channels < 1) {
				throw new Error('Nur PCM mit 16 bit wird gelesen')
			}
			const available = Math.min(size, buffer.byteLength - body)
			const frames = Math.floor(available / (2 * format.channels))
			const samples = new Float32Array(frames)
			for (let i = 0; i < frames; i++) {
				let sum = 0
				for (let c = 0; c < format.channels; c++) {
					sum += view.getInt16(body + (i * format.channels + c) * 2, true)
				}
				samples[i] = sum / format.channels / 0x8000
			}
			return { sampleRate: format.sampleRate, samples }
		}
		offset = body + size + (size % 2)
	}
	throw new Error('Kein data-Block')
}

function writeAscii(view, offset, text) {
	for (let i = 0; i < text.length; i++) {
		view.setUint8(offset + i, text.charCodeAt(i))
	}
}

function readAscii(view, offset) {
	return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))
}
