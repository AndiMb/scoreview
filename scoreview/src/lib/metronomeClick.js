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
//
// Three sounds for three levels (lib/metronome.js): the downbeat high, a
// beat lower, a subdivision lower still and shorter - it has to be heard as
// "between", not as another beat, or an eighth-note click in 4/4 sounds like
// 8/8. The render worker (workers/renderWorker.js) mixes the same three
// into a practice track.

import { audioSession, createAudioContext } from './audioSession.js'

/** Silence after which the metronome's own context rests. */
const OWN_REST_MS = 3000

/**
 * Frequency, gain and decay per level: 0 = downbeat, 1 = beat, 2 = subdivision.
 */
const SOUNDS = Object.freeze([
	{ hz: 1500, gain: 0.3, decayS: 0.05 },
	{ hz: 1000, gain: 0.3, decayS: 0.05 },
	{ hz: 1000, gain: 0.12, decayS: 0.03 },
])

/**
 * @param {0|1|2|boolean} level a level, or the pre-1.16 accent flag (true = downbeat)
 * @return {{hz: number, gain: number, decayS: number}}
 */
function soundOf(level) {
	if (typeof level === 'boolean') {
		return SOUNDS[level ? 0 : 1]
	}
	return SOUNDS[level] ?? SOUNDS[1]
}

/**
 * @param {?() => ?AudioContext} [getSharedContext] liefert den AudioContext
 *   der Wiedergabe, solange es einen gibt (siehe player.js)
 */
export function createMetronomeClick(getSharedContext = null) {
	let ownContext = null
	// The own context (silent mode only) rests a while after the last click,
	// like the playback context does (lib/audioIdle.js).
	let ownRestTimer = null

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
			ownContext = createAudioContext()
		}
		return ownContext
	}

	/**
	 * @param {0|1|2|boolean} [level] 0 = die Eins, 1 = Schlag, 2 = Unterteilung
	 *   (lib/metronome.js); ein Boolean wie vor 1.16 (true = die Eins)
	 * @param {number} [delaySeconds] Vorlauf: Klick genau in dieser Zeit,
	 *   terminiert über die Uhr des AudioContext statt über setTimeout/rAF.
	 *   Das Metronom klickt auf jedem Schlag, nicht nur auf dem Taktanfang -
	 *   der Aufrufer erkennt einen fälligen Schlag im
	 *   Bildwiederholtakt (~16ms Raster) und kann deshalb nur SAGEN, dass
	 *   einer ansteht, nicht exakt WANN. Auf Taktebene fiel dieses Zittern
	 *   nicht auf, auf Schlagebene hört man es. Der Aufrufer fragt deshalb
	 *   leicht in die Zukunft und reicht die Restzeit hier durch.
	 */
	function click(level = 1, delaySeconds = 0) {
		const ctx = ensureContext()
		return clickAt(level, ctx.currentTime + Math.max(0, delaySeconds))
	}

	/**
	 * A click at a fixed time on the context clock - for the count-in, which
	 * plans all its clicks from one base (planCountIn in metronome.js).
	 *
	 * @param {0|1|2|boolean} level see click()
	 * @param {number} at AudioContext time in seconds
	 * @return {{ cancel: () => void }} silences a click that has not sounded
	 */
	function clickAt(level, at) {
		const ctx = ensureContext()
		// A safeguard: whoever clicks should hold the context awake
		// (useMetronome), but a click on a resting context would only sound
		// once something else woke it - late, together with the next ones.
		if (ctx.state === 'suspended') {
			audioSession.forPlayback()
			ctx.resume().catch(() => {})
		}
		const startAt = Math.max(ctx.currentTime, at)
		if (ctx === ownContext) {
			// Counted from when the click sounds, not from when it was planned:
			// a count-in plans seconds ahead.
			clearTimeout(ownRestTimer)
			ownRestTimer = setTimeout(() => ownContext?.suspend().catch(() => {}), OWN_REST_MS + (startAt - ctx.currentTime) * 1000)
		}
		const sound = soundOf(level)
		const osc = ctx.createOscillator()
		const gain = ctx.createGain()
		osc.frequency.value = sound.hz
		gain.gain.setValueAtTime(sound.gain, startAt)
		gain.gain.exponentialRampToValueAtTime(0.001, startAt + sound.decayS)
		osc.connect(gain)
		gain.connect(ctx.destination)
		osc.start(startAt)
		osc.stop(startAt + sound.decayS + 0.01)
		return { cancel: () => gain.disconnect() }
	}

	/** The context the clicks run on - the shared one if there is one. */
	function context() {
		return ensureContext()
	}

	// Nur der eigene wird geschlossen - der geteilte gehört der Wiedergabe
	// und wird von dort abgeräumt (player.js, destroy()).
	function destroy() {
		clearTimeout(ownRestTimer)
		ownContext?.close()
		ownContext = null
	}

	return { click, clickAt, context, destroy }
}
