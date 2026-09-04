// Klangerzeugung fürs Metronom - ein eigener, minimaler
// AudioContext-Oszillator statt den Haupt-Synth (player.js) zu belasten.
// Zwei Gründe, warum das eigenständig sein muss statt über einen MIDI-Kanal
// zu laufen: `score.mid` hat nachweislich keine Metronomnoten (siehe
// metronome.js), und der Klick muss auch im stummen Modus funktionieren
// (silentClock.js, kein SoundFont konfiguriert) sowie beim Einzähler VOR dem
// eigentlichen Wiedergabestart, wenn player.js ggf. noch gar nicht läuft.
// Ungetestet wie player.js/silentClock.js - braucht einen echten
// AudioContext, siehe CLAUDE.md zu reiner Logik vs. DOM/Audio-Code.
//
// Der Klick braucht aber nur DANN einen eigenen AudioContext, wenn es keinen
// gibt - nicht einen ZWEITEN, wenn die Wiedergabe schon einen hat. Auf
// Android sind zwei Contexts zwei Ausgabe-Streams, die das System unabhängig
// puffert; über Bluetooth liegen sie um zig Millisekunden auseinander, und
// der Versatz ist nicht stabil. Klick und Musik gingen dann hörbar
// auseinander. Deshalb `getSharedContext`: Wo die Wiedergabe läuft, klickt es
// durch deren Kette mit - und der Latenzausgleich (playbackTime.js) gilt für
// beide gleichzeitig.

/**
 * @param {?() => ?AudioContext} [getSharedContext] liefert den AudioContext
 *   der Wiedergabe, solange es einen gibt (siehe player.js)
 */
export function createMetronomeClick(getSharedContext = null) {
	let ownContext = null

	function ensureContext() {
		const shared = getSharedContext?.() ?? null
		if (shared) {
			// Ein früher angelegter eigener Context wird nicht mehr gebraucht,
			// sobald die Wiedergabe steht (Reihenfolge beim Einzähler vor dem
			// ersten Start). Offen ließe er einen zweiten Ausgabe-Stream
			// zurück, der genau das Problem oben wieder aufmacht.
			ownContext?.close()
			ownContext = null
			return shared
		}
		if (!ownContext) {
			ownContext = new AudioContext()
		}
		return ownContext
	}

	/**
	 * @param {boolean} [accent] höherer Ton, z.B. für die Eins im Takt
	 * @param {number} [delaySeconds] Vorlauf: Klick genau in dieser Zeit,
	 *   terminiert über die Uhr des AudioContext statt über setTimeout/rAF.
	 *   Das Metronom klickt auf jedem Schlag, nicht nur auf dem Taktanfang -
	 *   der Aufrufer erkennt einen fälligen Schlag im
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

	// Nur der eigene wird geschlossen - der geteilte gehört der Wiedergabe
	// und wird von dort abgeräumt (player.js, destroy()).
	function destroy() {
		ownContext?.close()
		ownContext = null
	}

	return { click, destroy }
}
