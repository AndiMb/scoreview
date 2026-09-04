// Echte Wiedergabe im Browser (E1: Synthese statt vorgerendertem MP3 - siehe
// docs/architecture.md). Dünner spessasynth_lib-Wrapper, der dieselbe kleine
// Zeitquellen-Schnittstelle wie lib/silentClock.js erfüllt
// (getCurrentTimeMs/play/pause/seek/isPlaying/addEventListener('seeked')),
// damit useScoreSync.js und ScoreViewer.vue nicht wissen müssen, ob gerade
// echte Wiedergabe oder (mangels konfiguriertem SoundFont) der stumme
// Platzhalter läuft. Mute/Solo-Semantik selbst steckt NICHT hier,
// sondern in lib/mixerLayout.js (rein, ohne Synth-Abhängigkeit) - diese
// Datei wendet nur an, was von dort berechnet wird.

import { generateFilePath } from '@nextcloud/router'
import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib'

// spessasynth_lib's AudioWorklet-Prozessor läuft in einem eigenen
// AudioWorkletGlobalScope und wird per addModule(url) als eigenständige
// Datei geladen, nicht importiert/gebündelt - webpack.config.js kopiert sie
// unverändert neben die anderen Bundles (siehe dort).
const WORKLET_URL = generateFilePath('scoreview', 'js', 'spessasynth_processor.min.js')

// MIDI CC7 = Kanal-Lautstärke (General-MIDI-Standard). Mute/Solo werden
// bewusst darüber abgebildet statt über eine synth-interne Mute-API - CC7
// ist auf jedem General-MIDI-kompatiblen SoundFont garantiert vorhanden.
const CC_CHANNEL_VOLUME = 7

/**
 * @param {ArrayBuffer} midiArrayBuffer
 * @param {ArrayBuffer} soundFontArrayBuffer
 */
export async function createPlayer(midiArrayBuffer, soundFontArrayBuffer) {
	const context = new AudioContext()
	await context.audioWorklet.addModule(WORKLET_URL)
	const synth = new WorkletSynthesizer(context)
	synth.connect(context.destination)
	await synth.soundBankManager.addSoundBank(soundFontArrayBuffer, 'main')
	await synth.isReady

	const sequencer = new Sequencer(synth, { skipToFirstNoteOn: false })
	sequencer.loadNewSongList([{ binary: midiArrayBuffer }])
	// loadNewSongList lädt/parst asynchron (Worklet-intern) - ohne auf
	// 'songChange' zu warten, wäre sequencer.duration beim Verlassen dieser
	// Funktion noch nicht verlässlich (0 oder veraltet).
	await new Promise((resolve) => {
		sequencer.eventHandler.addEvent('songChange', 'scoreview-player-init', () => resolve())
	})

	const seekedListeners = new Set()

	// Bewusst die ROHE Zeit der Audiouhr, ohne Latenzausgleich: Sie ist die
	// Bezugsgroesse fuer alles, was gegen dieselbe Uhr terminiert (Metronom)
	// oder springt (Loop, seek). Der Ausgleich fuer die Anzeige passiert eine
	// Ebene hoeher, in usePlayback.js - warum das so getrennt sein MUSS, steht
	// im Kopfkommentar von lib/playbackTime.js.
	function getCurrentTimeMs() {
		return sequencer.currentTime * 1000
	}

	/**
	 * Wie weit das, was man hoert, hinter dem zurueckliegt, was die Audiouhr
	 * sagt - in ms.
	 *
	 * `getOutputTimestamp().contextTime` ist die Position des Stroms, den das
	 * Ausgabegeraet GERADE AUSGIBT, `currentTime` die des zuletzt gerenderten.
	 * Die Differenz ist die Ausgabelatenz, gemessen statt deklariert - und es
	 * ist dieselbe Groesse, mit der die Media-Pipeline des Browsers ein
	 * `<video>` an den Ton haengt (weshalb ein YouTube-Video ueber
	 * Bluetooth-Kopfhoerer lippensynchron bleibt und diese App es bis dahin
	 * nicht war).
	 *
	 * Beide Werte zurueckgeben statt nur den besseren: `getOutputTimestamp()`
	 * ist nicht ueberall implementiert und liefert dann konstant 0 - die
	 * Entscheidung, welcher Wert taugt, faellt in playbackTime.js, wo sie
	 * ohne AudioContext testbar ist.
	 *
	 * @return {{measuredMs: ?number, reportedMs: number}}
	 */
	function getLatencyReport() {
		let measuredMs = null
		try {
			const timestamp = context.getOutputTimestamp?.()
			if (timestamp && Number.isFinite(timestamp.contextTime)) {
				measuredMs = (context.currentTime - timestamp.contextTime) * 1000
			}
		} catch {
			// Manche Implementierungen werfen, solange der Context noch nicht
			// laeuft. Kein Grund, die Wiedergabe zu stoeren - dann gilt der
			// gemeldete Wert.
			measuredMs = null
		}
		return {
			measuredMs,
			reportedMs: ((context.baseLatency ?? 0) + (context.outputLatency ?? 0)) * 1000,
		}
	}

	/**
	 * Der AudioContext der Wiedergabe - fuer den Metronomklick, damit Klick
	 * und Musik durch DIESELBE Pufferkette gehen (siehe lib/metronomeClick.js).
	 *
	 * @return {AudioContext}
	 */
	function getAudioContext() {
		return context
	}

	function isPlaying() {
		return !sequencer.paused
	}

	async function play() {
		// AudioContext startet in vielen Browsern suspendiert, bis eine
		// Nutzerinteraktion vorliegt (Autoplay-Policy) - play() wird nur über
		// einen Klick ausgelöst (ScoreViewer.vue), erfüllt diese Bedingung
		// also garantiert.
		await context.resume()
		sequencer.play()
	}

	function pause() {
		sequencer.pause()
	}

	function seek(ms) {
		sequencer.currentTime = ms / 1000
		seekedListeners.forEach((cb) => cb())
	}

	function addEventListener(type, cb) {
		if (type === 'seeked') {
			seekedListeners.add(cb)
		}
	}

	function removeEventListener(type, cb) {
		if (type === 'seeked') {
			seekedListeners.delete(cb)
		}
	}

	// Tempo: ein globaler Faktor auf playbackRate. sequencer.currentTime bleibt
	// dabei auf der Original-Zeitachse der Partitur (kein manuelles Umrechnen
	// in useScoreSync.js nötig, "Tempo-unabhängig rechnen") - das ist
	// Sequencer-Verhalten, kein von uns nachgebautes; siehe player.live-test.md
	// für den Verifikationsweg.
	function setTempo(factor) {
		sequencer.playbackRate = factor
	}

	function getTempo() {
		return sequencer.playbackRate
	}

	/**
	 * @param {Map<number, number>} effectiveVolumes channel -> 0-127, siehe mixerLayout.js
	 */
	function applyChannelVolumes(effectiveVolumes) {
		for (const [channel, volume] of effectiveVolumes) {
			synth.controllerChange(channel, CC_CHANNEL_VOLUME, volume)
		}
	}

	function setProgram(channel, programNumber) {
		synth.programChange(channel, programNumber)
	}

	/** Vom geladenen SoundFont tatsächlich angebotene Instrumente ("Auswahl aus dem SoundFont"). */
	function getPresetList() {
		return synth.presetList
	}

	/**
	 * Die tatsächlich verwendeten MIDI-Kanäle je Spur, in Dokumentreihenfolge -
	 * aus dem geladenen MIDI selbst gelesen
	 * (`sequencer.midiData.tracks[].channels`, spessasynth_core), NICHT aus
	 * einer Index-Annahme. Grund: an duckwerk.mscz gemessen vergibt MuseScores
	 * MIDI-Export Kanäle nicht in Track-Reihenfolge (Sopran/Alt/Tenor/Bariton/
	 * Bass landeten auf Kanal 0/2/3/1/6, nicht 0-4) - siehe mixerLayout.js für
	 * die Konsequenz. `sequencer.midiData.tracks[i].events` ist zwar absichtlich
	 * leer (siehe spessasynth_lib-Typdefinition), `.channels` bleibt aber
	 * gefüllt.
	 *
	 * @return {number[][]} pro Spur die Menge ihrer MIDI-Kanäle (meist genau einer)
	 */
	function getTrackChannels() {
		return (sequencer.midiData?.tracks ?? []).map((track) => [...(track.channels ?? [])])
	}

	function destroy() {
		sequencer.pause()
		synth.disconnect(context.destination)
		context.close()
	}

	return {
		getCurrentTimeMs,
		getLatencyReport,
		getAudioContext,
		isPlaying,
		play,
		pause,
		seek,
		addEventListener,
		removeEventListener,
		get durationMs() {
			return sequencer.duration * 1000
		},
		setTempo,
		getTempo,
		applyChannelVolumes,
		setProgram,
		getPresetList,
		getTrackChannels,
		destroy,
	}
}
