// Das Aufnahme-Worklet (docs/architecture.md, Abschnitt Mikrofon): mischt auf mono, sampelt auf 16 kHz
// herunter und schickt Bloecke von 20 ms mit dem Kontextzeitpunkt ihres
// ersten Samples an den Hauptthread (composables/useMicrophone.js).
//
// **Warum ein Worklet** statt MediaRecorder: MediaRecorder liefert
// komprimierte Stuecke ohne Zeitbezug zur Audiouhr. Fuer den Zeitabgleich
// (lib/recordingAlign.js) braucht jedes Sample eine Kontextzeit, und die
// kennt nur der Audio-Thread selbst (`currentFrame`).
//
// **Warum im Wiedergabe-AudioContext:** Zeitstempel und Sequencer haben so
// dieselbe Uhr - ein zweiter Kontext liefe mit eigener Uhr und eigener
// Pufferung, und der Versatz zwischen beiden waere unbekannt.
//
// Eigener Webpack-Einstieg (webpack.config.js): Ein AudioWorkletGlobalScope
// kann keine nachgeladenen Teile holen, das Bundle muss fuer sich stehen.
//
// Das Mitverfolgen haengt nie an diesem Weg (S7) - siehe lib/micAccess.js.

import { createDownsampler } from '../lib/resample.js'

const OUT_RATE = 16000
// 20 ms bei 16 kHz.
const BLOCK = 320
const QUANTUM = 128

class CaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super()
		this.downsampler = createDownsampler(sampleRate, OUT_RATE)
		// Kontextframe des ersten verarbeiteten Samples. Danach wird JEDES
		// Quantum verarbeitet, auch ein leeres (als Stille) - so bleibt die
		// Rechnung „Eingabeindex + startFrame = Kontextframe" ueber die ganze
		// Aufnahme richtig.
		this.startFrame = null
		this.block = new Float32Array(BLOCK)
		this.filled = 0
		this.produced = 0
		this.blockStart = 0
		this.running = true
		this.port.onmessage = (event) => {
			if (event.data === 'stop') {
				this.running = false
			}
		}
	}

	process(inputs) {
		if (!this.running) {
			return false
		}
		if (this.startFrame === null) {
			this.startFrame = currentFrame
		}
		const input = inputs[0] ?? []
		const length = input[0]?.length ?? QUANTUM
		const mono = new Float32Array(length)
		for (const channel of input) {
			for (let i = 0; i < length; i++) {
				mono[i] += channel[i] / input.length
			}
		}
		const out = this.downsampler.process(mono)
		for (let i = 0; i < out.length; i++) {
			if (this.filled === 0) {
				this.blockStart = this.produced
			}
			this.block[this.filled++] = out[i]
			this.produced++
			if (this.filled === BLOCK) {
				const frame = this.startFrame + this.downsampler.inputPositionOf(this.blockStart)
				this.port.postMessage({ samples: this.block, contextTimeSec: frame / sampleRate }, [this.block.buffer])
				this.block = new Float32Array(BLOCK)
				this.filled = 0
			}
		}
		return true
	}
}

registerProcessor('scoreview-capture', CaptureProcessor)
