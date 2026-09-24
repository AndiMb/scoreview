// Von der Rate des AudioContext (44,1 oder 48 kHz) auf 16 kHz - rein, fuer
// das Aufnahme-Worklet (worklets/captureWorklet.js), wo es blockweise laeuft.
//
// Zwei Schritte:
//
// 1. **Tiefpass** vor dem Ausduennen, sonst faltet sich alles ueber 8 kHz
//    (Zischlaute, Obertoene der Begleitung aus dem Lautsprecher) als
//    Scheinfrequenz ins Band - und die Tonhoehenerkennung saehe Toene, die
//    niemand gesungen hat. Butterworth sechster Ordnung (drei Biquads) bei
//    6,5 kHz: flach im Band der Singstimme, was sich von 12 kHz auf 4 kHz
//    falten wuerde, liegt gemessen ueber 30 dB tiefer, und es bleibt billig
//    genug fuer 128 Samples je Aufruf im Audio-Thread.
// 2. **Lineare Interpolation** an den Ausgabezeitpunkten. 48 → 16 kHz ist
//    ein glattes Drittel, 44,1 → 16 kHz nicht; die Interpolation deckt beide
//    mit derselben Rechnung ab. Fuer Sprache und Gesang bis 4 kHz ist ihr
//    Fehler unhoerbar, und die Tonhoehe haengt allein an der Zeitachse, die
//    hier exakt bleibt.
//
// **Zeitstempel:** Ausgabesample k liegt bei Eingabeposition k × ratio -
// daraus rechnet das Worklet die Kontextzeit jedes Blocks. Die Gruppenlaufzeit
// des Filters (unter 0,1 ms) ist dabei vernachlaessigt.

const BUTTERWORTH_Q = [0.5176, 0.7071, 1.9319]
const CUTOFF_HZ = 6500

/**
 * @param {number} fs Abtastrate
 * @param {number} f0 Grenzfrequenz
 * @param {number} q
 * @return {{process: function(number): number}}
 */
function lowpass(fs, f0, q) {
	const w0 = (2 * Math.PI * f0) / fs
	const cos = Math.cos(w0)
	const alpha = Math.sin(w0) / (2 * q)
	const a0 = 1 + alpha
	const b0 = (1 - cos) / 2 / a0
	const b1 = (1 - cos) / a0
	const b2 = b0
	const a1 = (-2 * cos) / a0
	const a2 = (1 - alpha) / a0
	let x1 = 0
	let x2 = 0
	let y1 = 0
	let y2 = 0
	return {
		process(x) {
			const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
			x2 = x1
			x1 = x
			y2 = y1
			y1 = y
			return y
		},
	}
}

/**
 * @param {number} inRate Rate des AudioContext
 * @param {number} [outRate]
 * @return {{ratio:number, process: function(Float32Array): Float32Array, inputPositionOf: function(number): number}}
 */
export function createDownsampler(inRate, outRate = 16000) {
	const ratio = inRate / outRate
	const filters = inRate > outRate * 1.01
		? BUTTERWORTH_Q.map((q) => lowpass(inRate, Math.min(CUTOFF_HZ, outRate * 0.41), q))
		: []
	// Absoluter Index des ersten Samples im naechsten Block, das letzte
	// gefilterte Sample davor, und wie viele Ausgabesamples es schon gab.
	let base = 0
	let prev = 0
	let produced = 0
	let scratch = new Float32Array(0)

	return {
		ratio,

		/**
		 * @param {Float32Array} input ein Block in der Rate des Kontexts
		 * @return {Float32Array} die Ausgabesamples, die dieser Block fertig macht
		 */
		process(input) {
			const n = input.length
			// Laeuft im Audio-Thread, rund 375-mal je Sekunde: Der Zwischenpuffer
			// wird wiederverwendet, und die Ausgabe entsteht in einem einzigen
			// Array passender Laenge - jede Zuteilung dort ist Futter fuer eine
			// Speicherbereinigung, die als Aussetzer hoerbar werden kann.
			if (scratch.length < n) {
				scratch = new Float32Array(n)
			}
			const filtered = scratch
			for (let i = 0; i < n; i++) {
				let v = input[i]
				for (const f of filters) {
					v = f.process(v)
				}
				filtered[i] = v
			}
			// Wie viele Ausgabesamples dieser Block fertig macht: alle k mit
			// floor(k * ratio) + 1 <= base + n - 1.
			let count = 0
			while (Math.floor((produced + count) * ratio) + 1 <= base + n - 1) {
				count++
			}
			const out = new Float32Array(count)
			for (let k = 0; k < count; k++) {
				const p = produced * ratio
				// Zwischen floor(p) und floor(p)+1 interpolieren; beide sind da.
				const i0 = Math.floor(p)
				const frac = p - i0
				const a = i0 < base ? prev : filtered[i0 - base]
				const b = filtered[i0 + 1 - base]
				out[k] = a + (b - a) * frac
				produced++
			}
			if (n > 0) {
				prev = filtered[n - 1]
			}
			base += n
			return out
		},

		/**
		 * Eingabeposition (in Samples seit Beginn) des k-ten Ausgabesamples.
		 *
		 * @param {number} k
		 * @return {number}
		 */
		inputPositionOf(k) {
			return k * ratio
		},
	}
}
