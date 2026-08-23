// Echte Wiedergabe im Browser (Phase 9, E1: Synthese statt vorgerendertem
// MP3 - siehe PLAN.md). Dünner spessasynth_lib-Wrapper, der dieselbe kleine
// Zeitquellen-Schnittstelle wie lib/silentClock.js erfüllt
// (getCurrentTimeMs/play/pause/seek/isPlaying/addEventListener('seeked')),
// damit useScoreSync.js und ScoreViewer.vue nicht wissen müssen, ob gerade
// echte Wiedergabe oder (mangels konfiguriertem SoundFont) der stumme
// Phase-8-Platzhalter läuft. Mute/Solo-Semantik selbst steckt NICHT hier,
// sondern in lib/mixerLayout.js (rein, ohne Synth-Abhängigkeit) - diese
// Datei wendet nur an, was von dort berechnet wird.

import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib'
import { generateFilePath } from '@nextcloud/router'

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

	function getCurrentTimeMs() {
		return sequencer.currentTime * 1000
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

	// Tempo (Phase 9): ein globaler Faktor auf playbackRate. sequencer.currentTime
	// bleibt dabei auf der Original-Zeitachse der Partitur (kein manuelles
	// Umrechnen in useScoreSync.js nötig, siehe PLAN.md Phase 8
	// "Tempo-unabhängig rechnen") - das ist Sequencer-Verhalten, kein von uns
	// nachgebautes; siehe player.live-test.md für den Verifikationsweg.
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

	/** Vom geladenen SoundFont tatsächlich angebotene Instrumente (Phase 9: "Auswahl aus dem SoundFont"). */
	function getPresetList() {
		return synth.presetList
	}

	function destroy() {
		sequencer.pause()
		synth.disconnect(context.destination)
		context.close()
	}

	return {
		getCurrentTimeMs,
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
		destroy,
	}
}
