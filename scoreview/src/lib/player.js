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
import { withAppVersion } from './assetVersion.js'
import { pickToneChannel } from './startTone.js'

// spessasynth_lib's AudioWorklet-Prozessor läuft in einem eigenen
// AudioWorkletGlobalScope und wird per addModule(url) als eigenständige
// Datei geladen, nicht importiert/gebündelt - webpack.config.js kopiert sie
// unverändert neben die anderen Bundles (siehe dort). Mit App-Version, weil
// sie sonst nach einem Update aus dem Browser-Cache kaeme (assetVersion.js).
const WORKLET_URL = withAppVersion(generateFilePath('scoreview', 'js', 'spessasynth_processor.min.js'), SCOREVIEW_APP_VERSION)

// MIDI CC7 = Kanal-Lautstärke (General-MIDI-Standard). Mute/Solo werden
// bewusst darüber abgebildet statt über eine synth-interne Mute-API - CC7
// ist auf jedem General-MIDI-kompatiblen SoundFont garantiert vorhanden.
const CC_CHANNEL_VOLUME = 7
// Die Kanaele der General-MIDI-Welt - je einer eigener Ausgang am Worklet.
const MIDI_CHANNELS = 16

// Anfangston: Klavier (GM-Programm 0), unabhaengig vom Instrument der
// Stimme - ein Chorklang „Aah" ist als Stimmton zu weich im Einsatz.
const TONE_PROGRAM = 0
const TONE_VELOCITY = 100
// Obergrenze, falls ein Tipp haengen bleibt: Ein pointerup, das nie
// ankommt (Finger vom Bildschirm gerutscht, Tab gewechselt), laesst den Ton
// sonst endlos klingen.
const TONE_MAX_MS = 8000
// Frist fuer das Einlesen des MIDI im Worklet. Grosszuegig, weil ein
// langsames Geraet nicht an ihr scheitern soll - sie faengt nur den Fall, in
// dem nie eine Antwort kommt.
const SONG_LOAD_TIMEOUT_MS = 30_000

/**
 * @param {ArrayBuffer} midiArrayBuffer
 * @param {ArrayBuffer} soundFontArrayBuffer
 */
export async function createPlayer(midiArrayBuffer, soundFontArrayBuffer) {
	const context = new AudioContext()
	// Scheitert der Aufbau irgendwo dazwischen (Worklet nicht ladbar,
	// SoundFont kaputt, MIDI unlesbar), gehoert der Kontext niemandem mehr -
	// ohne das close() hielte der Tab ihn samt Audio-Thread bis zum Schliessen,
	// und Browser deckeln die Zahl gleichzeitiger AudioContexts.
	let synth
	let sequencer
	let master
	const panners = []
	try {
		await context.audioWorklet.addModule(WORKLET_URL)
		synth = new WorkletSynthesizer(context)
		// Ein Regler fuer die ganze Begleitung, vor dem Ausgang: Eine eigene
		// Aufnahme laeuft wahlweise mit oder ohne Begleitung, mit getrennten
		// Pegeln. Das Metronom haengt bewusst NICHT daran - es
		// soll auch zu hoeren sein, wenn die Begleitung schweigt.
		master = context.createGain()
		master.connect(context.destination)
		synth.connect(master)
		// „Meine Stimme im Stereobild" haengt HINTER dem Synthesizer, nicht an
		// CC10: Gemessen am Abgriff je Kanal liess CC10 selbst ganz aussen (0/127)
		// bei den Chorstimmen des SoundFonts noch ein Drittel auf der anderen Seite
		// - deren Samples sind selbst stereo, CC10 verschiebt nur die Balance. Ein
		// StereoPannerNode auf dem eigenen Ausgang des Kanals legt beide Seiten
		// wirklich auf ein Ohr, und er steht ausserhalb des Sequencers, den ein
		// Suchlauf zuruecksetzt (siehe setController). Der Effektbus (Ausgang 0,
		// Hall/Chorus aller Stimmen) bleibt in der Mitte.
		for (let channel = 0; channel < MIDI_CHANNELS; channel++) {
			const panner = context.createStereoPanner()
			panner.connect(master)
			synth.disconnectChannel(master, channel)
			synth.connectChannel(panner, channel)
			panners.push(panner)
		}
		await synth.soundBankManager.addSoundBank(soundFontArrayBuffer, 'main')
		await synth.isReady

		sequencer = new Sequencer(synth, { skipToFirstNoteOn: false })
		sequencer.loadNewSongList([{ binary: midiArrayBuffer }])
		// loadNewSongList lädt/parst asynchron (Worklet-intern) - ohne auf
		// 'songChange' zu warten, wäre sequencer.duration beim Verlassen dieser
		// Funktion noch nicht verlässlich (0 oder veraltet).
		// Mit Frist: Ein MIDI, das das Worklet nicht parsen kann, meldet sich
		// nie - ohne Frist bliebe die Ladeanzeige fuer immer stehen.
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('MIDI could not be loaded.')), SONG_LOAD_TIMEOUT_MS)
			sequencer.eventHandler.addEvent('songChange', 'scoreview-player-init', () => {
				clearTimeout(timer)
				resolve()
			})
		})
	} catch (err) {
		context.close().catch(() => {})
		throw err
	}

	const seekedListeners = new Set()
	// Gemessen: `sequencer.currentTime = x` schickt nur eine Nachricht ans
	// Worklet. Bis dessen Antwort (`timeChange`) da ist, meldet der Getter
	// weiter die ALTE Stelle - wer direkt nach einem Suchlauf die Zeit liest,
	// liest Vergangenes. Die eigene Aufnahme richtet sich an genau dieser
	// Zeit aus (useRecorder.js) und wartet deshalb auf dieses Ereignis.
	const timeChangeListeners = new Set()
	sequencer.eventHandler.addEvent('timeChange', 'scoreview-player-time', () => {
		timeChangeListeners.forEach((cb) => cb())
	})
	// Der gerade klingende Anfangston: {channel, pitch, timer} oder null.
	let tone = null

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

	/**
	 * Lautstaerke der Begleitung, 0..1 - fuer Aufnahme und Abhoeren
	 * (useRecorder.js). Weich gesetzt, damit das Umschalten nicht knackt.
	 *
	 * @param {number} value
	 */
	function setAccompanimentGain(value) {
		const v = Math.min(1, Math.max(0, Number(value) || 0))
		master.gain.setTargetAtTime(v, context.currentTime, 0.01)
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
		} else if (type === 'timechange') {
			timeChangeListeners.add(cb)
		}
	}

	function removeEventListener(type, cb) {
		if (type === 'seeked') {
			seekedListeners.delete(cb)
		} else if (type === 'timechange') {
			timeChangeListeners.delete(cb)
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
	 * Einen Controller setzen und gegen den Sequencer verriegeln.
	 *
	 * Gemessen: Jeder Suchlauf - und damit jeder Loop-Ruecksprung - setzt den
	 * Synthesizer zurueck (`setTimeTo()` in spessasynth_core ruft
	 * `synth.reset()`) und spielt danach die Controller aus dem MIDI bis zur
	 * Zielstelle nach. MuseScore schreibt CC7 und CC10 an den Anfang jeder
	 * Spur; ohne Sperre stand ein stummgeschalteter Kanal nach dem ersten
	 * Suchlauf wieder auf 100 - im Loop hiesse das: Mute, Solo, „Meine Stimme"
	 * und das Stereobild waeren nach dem ersten Durchlauf weg. Ein gesperrter
	 * Controller uebersteht den Reset (resetChannelInternal ueberspringt ihn)
	 * und ignoriert die Werte aus dem MIDI.
	 *
	 * Erst entsperren, dann setzen, dann wieder sperren - sonst prallte der
	 * neue Wert an der eigenen Sperre ab. Alle drei Nachrichten laufen ueber
	 * denselben Port und kommen in dieser Reihenfolge an.
	 *
	 * @param {number} channel
	 * @param {number} controller
	 * @param {number} value 0-127
	 * @param {boolean} lock danach gesperrt lassen
	 */
	function setController(channel, controller, value, lock) {
		const midiChannel = synth.midiChannels?.[channel]
		midiChannel?.lockController(controller, false)
		synth.controllerChange(channel, controller, value)
		if (lock) {
			midiChannel?.lockController(controller, true)
		}
	}

	/**
	 * @param {Map<number, number>} effectiveVolumes channel -> 0-127, siehe mixerLayout.js
	 */
	function applyChannelVolumes(effectiveVolumes) {
		for (const [channel, volume] of effectiveVolumes) {
			setController(channel, CC_CHANNEL_VOLUME, volume, true)
		}
	}

	/**
	 * Das Stereobild aus lib/panLayout.js anwenden. Die Mitte (0) laesst das
	 * Panorama der Partitur selbst unberuehrt - das steckt im MIDI (CC10) und
	 * wirkt davor.
	 *
	 * @param {Map<number, number>} pans channel -> -1 (links) .. 1 (rechts)
	 */
	function applyChannelPans(pans) {
		for (const [channel, pan] of pans) {
			const panner = panners[channel]
			if (panner) {
				panner.pan.setValueAtTime(Math.min(1, Math.max(-1, pan)), context.currentTime)
			}
		}
	}

	/**
	 * Ob es einen Kanal fuer den Anfangston gibt - siehe startTone.js.
	 *
	 * @return {boolean}
	 */
	function canPlayTone() {
		return pickToneChannel(getTrackChannels()) !== null
	}

	/**
	 * Den Anfangston anschlagen. Er klingt, bis stopTone() kommt, laengstens
	 * TONE_MAX_MS. Laeuft durch dieselbe Ausgabekette wie die Musik - gleiche
	 * Latenz, gleiche Lautstaerke - und aendert weder Position noch
	 * Wiedergabezustand.
	 *
	 * @param {number} pitch MIDI-Tonhoehe, klingend
	 * @return {Promise<boolean>} false, wenn kein Kanal frei ist
	 */
	async function startTone(pitch) {
		stopTone()
		const channel = pickToneChannel(getTrackChannels())
		if (channel === null) {
			return false
		}
		// Bei gestoppter Wiedergabe kann der Context noch suspendiert sein
		// (Autoplay-Policy) - der Druck auf den Knopf ist die Nutzergeste,
		// die ihn wecken darf.
		await context.resume()
		// Der Programmwechsel jedes Mal: Ein Suchlauf setzt den Kanal zurueck
		// (siehe setController), und ein spaeter geladenes Stueck koennte ihn
		// benutzen.
		synth.programChange(channel, TONE_PROGRAM)
		synth.noteOn(channel, pitch, TONE_VELOCITY)
		const timer = setTimeout(stopTone, TONE_MAX_MS)
		tone = { channel, pitch, timer }
		return true
	}

	function stopTone() {
		if (!tone) {
			return
		}
		clearTimeout(tone.timer)
		synth.noteOff(tone.channel, tone.pitch)
		tone = null
	}

	/**
	 * Das Instrument eines Kanals aus dem Mixer - verriegelt wie die
	 * Controller in setController(), aus demselben Grund: Der Reset beim
	 * Suchlauf setzt auch das Programm zurueck (resetChannelInternal endet
	 * mit programChange(0)), und danach spielt der Sequencer den
	 * Programmwechsel aus dem MIDI nach. Ohne Sperre klang die gewaehlte
	 * Trompete nach dem ersten Suchlauf oder Loop-Ruecksprung wieder als das
	 * Instrument der Partitur. Die Sperre (`presetLock`) laesst jeden
	 * Programmwechsel abprallen, auch den des Resets.
	 *
	 * @param {number} channel
	 * @param {number} programNumber GM-Programm 0-127
	 */
	function setProgram(channel, programNumber) {
		const midiChannel = synth.midiChannels?.[channel]
		midiChannel?.setSystemParameter('presetLock', false)
		synth.programChange(channel, programNumber)
		midiChannel?.setSystemParameter('presetLock', true)
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
		stopTone()
		sequencer.pause()
		synth.disconnect()
		panners.forEach((panner) => panner.disconnect())
		master.disconnect()
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
		// Siehe timeChangeListeners: Nach seek() stimmt getCurrentTimeMs()
		// erst mit dem Ereignis 'timechange' (der stumme Platzhalter springt
		// sofort und kennt es nicht).
		seekIsAsync: true,
		setTempo,
		getTempo,
		setAccompanimentGain,
		applyChannelVolumes,
		applyChannelPans,
		canPlayTone,
		startTone,
		stopTone,
		setProgram,
		getPresetList,
		getTrackChannels,
		destroy,
	}
}
