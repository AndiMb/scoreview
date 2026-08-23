// Klangerzeugung fürs Metronom (Phase 17) - ein eigener, minimaler
// AudioContext-Oszillator statt den Haupt-Synth (player.js) zu belasten.
// Zwei Gründe, warum das eigenständig sein muss statt über einen MIDI-Kanal
// zu laufen: `score.mid` hat nachweislich keine Metronomnoten (siehe
// metronome.js), und der Klick muss auch im stummen Modus funktionieren
// (silentClock.js, kein SoundFont konfiguriert) sowie beim Einzähler VOR dem
// eigentlichen Wiedergabestart, wenn player.js ggf. noch gar nicht läuft.
// Ungetestet wie player.js/silentClock.js - braucht einen echten
// AudioContext, siehe CLAUDE.md zu reiner Logik vs. DOM/Audio-Code.

export function createMetronomeClick() {
	let context = null

	function ensureContext() {
		if (!context) {
			context = new AudioContext()
		}
		return context
	}

	/**
	 * @param {boolean} [accent] höherer Ton, z.B. für den ersten Einzähler-Klick
	 */
	function click(accent = false) {
		const ctx = ensureContext()
		const osc = ctx.createOscillator()
		const gain = ctx.createGain()
		osc.frequency.value = accent ? 1500 : 1000
		gain.gain.setValueAtTime(0.3, ctx.currentTime)
		gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05)
		osc.connect(gain)
		gain.connect(ctx.destination)
		osc.start()
		osc.stop(ctx.currentTime + 0.06)
	}

	function destroy() {
		context?.close()
		context = null
	}

	return { click, destroy }
}
