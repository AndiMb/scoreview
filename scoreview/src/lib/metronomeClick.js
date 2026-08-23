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
	 * @param {boolean} [accent] höherer Ton, z.B. für die Eins im Takt
	 * @param {number} [delaySeconds] Vorlauf: Klick genau in dieser Zeit,
	 *   terminiert über die Uhr des AudioContext statt über setTimeout/rAF.
	 *   Seit Phase 22 klickt das Metronom auf jedem Schlag statt nur auf dem
	 *   Taktanfang - der Aufrufer erkennt einen fälligen Schlag im
	 *   Bildwiederholtakt (~16ms Raster) und kann deshalb nur SAGEN, dass
	 *   einer ansteht, nicht exakt WANN. Auf Taktebene fiel dieses Zittern
	 *   nicht auf, auf Schlagebene hört man es. Der Aufrufer fragt deshalb
	 *   leicht in die Zukunft und reicht die Restzeit hier durch.
	 */
	function click(accent = false, delaySeconds = 0) {
		const ctx = ensureContext()
		const at = ctx.currentTime + Math.max(0, delaySeconds)
		const osc = ctx.createOscillator()
		const gain = ctx.createGain()
		osc.frequency.value = accent ? 1500 : 1000
		gain.gain.setValueAtTime(0.3, at)
		gain.gain.exponentialRampToValueAtTime(0.001, at + 0.05)
		osc.connect(gain)
		gain.connect(ctx.destination)
		osc.start(at)
		osc.stop(at + 0.06)
	}

	function destroy() {
		context?.close()
		context = null
	}

	return { click, destroy }
}
