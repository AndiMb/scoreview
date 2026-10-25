import axios from '@nextcloud/axios'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { buildTimeline, groupRectsByPage } from '../lib/scoreLayout.js'
import { createScoreSync } from '../lib/scoreSync.js'
import { createWakeWindow } from '../lib/timeLoopWake.js'
import { elidMapping } from '../lib/variantChoice.js'

/**
 * Geteiltes leeres Array fuer Seiten ohne Takte - ein `[]` im Template waere
 * bei jedem Render ein neues und liesse die Props der Seite jedes Mal als
 * geaendert erscheinen.
 */
export const NO_RECTS = Object.freeze([])

/**
 * Die offene Partitur: was aus ihrer Konvertierung geladen wurde, die
 * Zeitquelle, die darauf laeuft, und DIE Frame-Schleife, die beides
 * zusammenhaelt.
 *
 * Der Zustand hier ist der, den fast alle anderen Bereiche teilen
 * (Zeitachsen, etag, Dauer, Zeitquelle) - deshalb entsteht er als Erstes, vor
 * den Composables, die ihn lesen. Das Laden selbst braucht umgekehrt einige
 * von ihnen (Wiedergabe, Zoom, Notizen, …); deren Handgriffe kommen deshalb
 * erst danach ueber `connect()` herein, wie ein nachgereichter Rueckruf.
 * Benannt statt als ganze Composables: So steht hier, welche Handgriffe das
 * Laden wirklich braucht, und ein Test kann genau die ersetzen.
 *
 * `clock` ist die Zeitquelle: entweder lib/player.js (echte Wiedergabe,
 * sobald ein SoundFont konfiguriert ist) oder lib/silentClock.js
 * (Platzhalter) - beide erfüllen dieselbe Schnittstelle, der Viewer muss
 * den Unterschied nur für die Tempo-/Mixer-Zusatzfunktionen kennen
 * (hasRealPlayer). Bewusst als shallowRef: dahinter haengt ein
 * AudioContext samt Synthesizer. Tiefe Reaktivitaet darauf waere sinnlos
 * teuer, und niemand verlaesst sich auf Reaktivitaet INNERHALB des
 * Objekts - nur darauf, dass der Austausch der Zeitquelle auffaellt.
 */
export function useScoreSession() {
	const timeline = shallowRef(null)
	const measuresTimeline = shallowRef(null)
	// Einmal je measures.json gruppiert: Jede Seite bekommt bei jedem Render
	// dasselbe Array, statt eines frisch gefilterten, das ihre Props jedes Mal
	// als geaendert erscheinen liess (lib/scoreLayout.js).
	const systemRectsByPage = computed(() => groupRectsByPage(measuresTimeline.value))
	const currentEtag = shallowRef(null)
	const durationMs = shallowRef(0)
	const clock = shallowRef(null)
	// meta.json - fuer die Partiturfakten (Tonarten, Studierbuchstaben).
	const scoreMeta = shallowRef(null)
	const pageUrls = ref([])
	// Fuer die Zuordnung Notenzeile -> Stimme: Reihenfolge UND Anzahl aus
	// meta.json, nicht aus dem Mixer - der laesst die Metronomspur weg und
	// zaehlt damit anders (siehe mixerLayout.js).
	const scoreParts = ref([])
	// Der Partiturtitel steht nicht in der Leiste - Nextclouds Viewer zeigt
	// den Dateinamen ohnehin in seiner eigenen Kopfzeile, und die Leiste
	// braucht den Platz fuer Bedienelemente.
	const totalMeasures = ref(0)
	// Womit diese Darstellung erzeugt wurde: der Konvertierungsweg aus dem
	// Statusendpunkt ('sidecar' | 'local' | 'client' | null fuer aeltere
	// Datensaetze) und - davon unabhaengig - die Version, mit der die
	// Partitur geschrieben wurde (meta.json). Rein zum Anzeigen, nichts im
	// Viewer verzweigt danach (E3).
	const rendererBackend = ref(null)
	const mscoreVersion = ref(null)
	// Ob diese Nutzerin die Partitur neu konvertieren lassen darf - kommt aus
	// dem Statusendpunkt, nicht aus einer eigenen Annahme ueber Freigaben.
	const canReconvert = ref(false)
	// Ob neben der Partitur angelegt werden darf - Tracks fuer alle Stimmen
	// (H10) gibt es nur dann; ebenfalls aus dem Statusendpunkt.
	const canWriteFolder = ref(false)
	// score.mid dieser Partitur - die Intonation laedt es nach, wenn ohne Ton
	// niemand sonst es geholt hat (useScoreFacts.ensureMidi).
	const midiUrl = ref(null)
	// Was die Frame-Schleife aufloest: das Rechteck fuer den Cursor und das
	// elid fuer eine neue Notiz (currentAnchor im Viewer).
	const cursorRect = ref(null)
	// Whether this cursor came inside a forceAutoScrollFor() window - the
	// band and the lyrics view scroll along on it even with autoscroll off,
	// like useAutoScroll does with `force`.
	const cursorForced = ref(false)
	const currentElid = ref(null)

	// The display variant shown instead of the base pages (E19), or null.
	// Its meta.json describes the picture only; everything about the piece
	// stays in scoreMeta. `pictureMeta` is what reads the picture - the
	// base meta with the variant's elid- and staff-bearing fields over it.
	const variantMeta = shallowRef(null)
	const variantKey = ref(null)
	const pictureMeta = computed(() => {
		const base = scoreMeta.value
		const variant = variantMeta.value
		if (!base || !variant) {
			return base
		}
		const merged = { ...base, noteSpellings: variant.noteSpellings, pageFormat: variant.pageFormat ?? base.pageFormat, pages: variant.pages }
		// Absent means "too much text" in both - keep that apart from "none".
		if (Array.isArray(variant.lyricSyllables)) {
			merged.lyricSyllables = variant.lyricSyllables
		} else {
			delete merged.lyricSyllables
		}
		return merged
	})
	// The parts the picture draws, in staff order - for "which staff is my
	// part" (lib/staffBands.js); the mixer keeps scoreParts.
	const pictureParts = computed(() => variantMeta.value?.parts ?? scoreParts.value)
	// Segment numbers between picture and base (I3): notes are anchored
	// against the base, whatever picture they were made in.
	const elids = computed(() => elidMapping(variantMeta.value))
	// What the base looked like, to go back to it without a reload.
	let basePicture = null

	// Zaehlt jeden reset(): Ein load(), das nach einem await eine andere Zahl
	// vorfindet, gehoert zu einem Stueck, das nicht mehr offen ist
	// (Stueckwechsel mitten im Laden).
	let generation = 0
	let sync = null
	let frameHandle = null
	// Whether the loop is switched on at all (between pumpTimeDisplay() and
	// stopTimeDisplay()) - it may still be asleep (frameHandle === null).
	let pumping = false
	const wakeWindow = createWakeWindow()
	// Others that need the loop's beat (LyricsView) - they run when it runs
	// and sleep when it sleeps, instead of keeping a loop of their own.
	const frameListeners = new Set()
	// Bis wann das Nachfuehren auch gegen manuelles Blaettern gilt
	// (forceAutoScrollFor).
	let forceScrollUntil = 0
	let hooks = null

	/**
	 * Die Handgriffe der anderen Bereiche, die Laden, Frame-Schleife und
	 * Abbau brauchen. Genau einmal, am Ende von setup().
	 *
	 * @param {object} deps
	 * @param {(meta: object) => void} deps.applyMetadata Tempo/Stimmen an die Wiedergabe
	 * @param {() => void} deps.loadAnnotations
	 * @param {(midiUrl: string) => void} deps.ensureMidi Partiturfakten aus dem MIDI
	 * @param {() => void} deps.restoreZoom
	 * @param {() => void} deps.observeViewport
	 * @param {(midiUrl: string, soundFontUrl: string, timeline: object) => Promise<void>} deps.useRealPlayer
	 * @param {() => void} deps.setNoSoundFontConfigured
	 * @param {(timeline: object) => void} deps.useSilentClock
	 * @param {(rect: ?object, force: boolean) => void} deps.updateAutoScroll
	 * @param {(message: string) => void} deps.onError Laden gescheitert
	 * @param {() => void} deps.sampleTime legt currentTimeMs/displayTimeMs an
	 * @param {() => number} deps.displayTimeMs was gerade zu HOEREN ist
	 * @param {() => number} deps.currentTimeMs die rohe Zeit der Audiouhr
	 * @param {(rawMs: number) => void} deps.wrapLoop
	 * @param {(rawMs: number) => void} deps.tickMetronome
	 * @param {() => void} deps.stopPolling
	 * @param {() => void} deps.destroyMetronome
	 * @param {() => void} deps.destroyPlayback
	 * @param {() => void} deps.stopZoomObserver
	 * @param {() => boolean} [deps.isFollowing] the display hangs on the
	 *   leader's time ("Folgt mir") - the loop has to keep running
	 */
	function connect(deps) {
		hooks = deps
	}

	/**
	 * Die Artefakte einer fertigen Konvertierung laden und die Wiedergabe
	 * darauf aufsetzen.
	 *
	 * @param {object} body Antwort des Statusendpunkts (oder des Rueckfalls im Browser)
	 * @param {object} body.files Adressen der Artefakte samt etag
	 * @param {?string} body.soundFontUrl null = ohne Ton, nur der Cursor laeuft
	 * @param {?{backend: ?string}} body.renderer der Konvertierungsweg (E3)
	 * @param {boolean} body.canReconvert
	 * @param {boolean} [body.canWriteFolder]
	 */
	async function load({ files, soundFontUrl, renderer, canReconvert: mayReconvert, canWriteFolder: mayWrite }) {
		const mine = generation
		const stale = () => mine !== generation
		try {
			const [timingRes, measuresRes, metaRes] = await Promise.all([
				axios.get(files.timingJson),
				axios.get(files.measuresJson),
				axios.get(files.metaJson),
			])
			if (stale()) {
				return
			}
			const notes = buildTimeline(timingRes.data)
			timeline.value = notes
			measuresTimeline.value = buildTimeline(measuresRes.data)
			pageUrls.value = files.pages
			basePicture = { timeline: notes, measures: measuresTimeline.value, pages: files.pages }
			variantMeta.value = null
			variantKey.value = null
			currentEtag.value = files.etag
			scoreMeta.value = metaRes.data
			hooks.applyMetadata(metaRes.data)
			scoreParts.value = metaRes.data.parts ?? []
			// Herkunft der Darstellung (E3). Zwei verschiedene Aussagen, die
			// leicht verwechselt werden: `renderer.backend` ist der
			// Konvertierungsweg, `meta.mscoreVersion` die Version, mit der die
			// Partitur GESCHRIEBEN wurde - siehe lib/viewerTexts.js.
			rendererBackend.value = renderer?.backend ?? null
			mscoreVersion.value = metaRes.data.mscoreVersion ?? null
			canReconvert.value = mayReconvert === true
			canWriteFolder.value = mayWrite === true
			totalMeasures.value = metaRes.data.measures ?? measuresTimeline.value.events.length
			hooks.loadAnnotations()
			// Die Studierbuchstaben kommen mit MuseScore auf dem Sidecar nur aus dem MIDI
			// - und das laedt sonst nur, wer Ton hat (useScoreFacts).
			hooks.ensureMidi(files.midi)
			midiUrl.value = files.midi
			// Startzoom "Seitenbreite" statt fester Faktor 1: die Seite hat
			// eine echte Breite (ScorePage.vue), ein fester Faktor 1 hieße auf
			// einem Telefon 900px Seitenbreite neben 390px Bildschirm. Erst
			// nach nextTick, damit .scoreview-pages die Seiten schon enthält
			// und seine endgültige Breite (inkl. Scrollbalken) steht.
			await nextTick()
			if (stale()) {
				return
			}
			// Das zuletzt gewaehlte Preset, nicht immer „Seitenbreite": Beim
			// Stueckwechsel einer Setliste bleibt der Zoom.
			hooks.restoreZoom()
			hooks.observeViewport()

			if (soundFontUrl) {
				await hooks.useRealPlayer(files.midi, soundFontUrl, notes)
				if (stale()) {
					return
				}
			} else {
				hooks.setNoSoundFontConfigured()
				hooks.useSilentClock(notes)
			}

			// The picture shown by now - a variant chosen for this score may
			// already have replaced the base while the player was loading.
			startSync(timeline.value)

			pumpTimeDisplay()
		} catch (err) {
			if (stale()) {
				return
			}
			hooks.onError(err.message)
		}
	}

	/**
	 * The cursor's source of truth: which rectangle the time falls into, on
	 * the timeline of whatever picture is shown.
	 *
	 * @param {object} notes timing.json as built by buildTimeline()
	 */
	function startSync(notes) {
		sync = createScoreSync(notes, (rect) => {
			const force = Date.now() < forceScrollUntil
			cursorForced.value = force
			cursorRect.value = rect
			// Nachführen statt nur beim Seitenwechsel zu springen. Nach
			// einem Sprung der Leitung auch dann, wenn gerade von Hand
			// geblaettert wurde: Blaettern loest das Folgen nicht, der
			// Sprung soll also sichtbar werden (forceAutoScrollFor).
			// Erst nach dem Rendern: Das Nachfuehren misst den Cursor im
			// DOM, und der steht bis dahin noch an der alten Stelle. In der
			// Wiedergabe faellt das nicht auf, weil die naechste Note es
			// richtet - nach einem Sprung im Stillstand kommt keine, und
			// die Ansicht fuhr zur vorigen Stelle statt zur neuen.
			nextTick(() => hooks.updateAutoScroll(rect, force))
		})
	}

	/**
	 * Shows a display variant instead of the base pages, or the base again
	 * (E19). Only the picture changes - pages, timing and measures, which
	 * share the base's time axis and measure numbering (I1, I2). Sound,
	 * mixer, tempo, notes and the open position stay as they are; the cursor
	 * finds its place on the new pages at the next frame.
	 *
	 * @param {?object} answer `{variant, files}` of a ready variant, null for the base
	 * @return {Promise<boolean>} false when the score changed meanwhile
	 */
	async function applyPicture(answer) {
		const mine = generation
		if (!basePicture) {
			return false
		}
		let next
		if (answer?.files) {
			const [timingRes, measuresRes, metaRes] = await Promise.all([
				axios.get(answer.files.timingJson),
				axios.get(answer.files.measuresJson),
				axios.get(answer.files.metaJson),
			])
			if (mine !== generation) {
				return false
			}
			next = {
				timeline: buildTimeline(timingRes.data),
				measures: buildTimeline(measuresRes.data),
				pages: answer.files.pages,
				meta: metaRes.data,
				key: answer.variant ?? metaRes.data?.variant ?? null,
			}
		} else {
			next = { ...basePicture, meta: null, key: null }
		}
		timeline.value = next.timeline
		measuresTimeline.value = next.measures
		pageUrls.value = next.pages
		variantMeta.value = next.meta
		variantKey.value = next.key
		cursorRect.value = null
		currentElid.value = null
		if (sync) {
			startSync(next.timeline)
			forceAutoScrollFor(1500)
			wakeTimeDisplay()
		}
		return true
	}

	/**
	 * DIE Zeitschleife des Viewers - die einzige: Cursor, Notiz-Anker,
	 * Loop und Metronom brauchen alle dieselbe Zeitquelle und denselben
	 * Takt.
	 *
	 * Reihenfolge ist nicht beliebig: erst die Zeit abgreifen, dann Cursor
	 * und Notiz-Anker daraus ableiten, dann Loop und Metronom - die
	 * späteren Schritte lesen die Zeitwerte.
	 *
	 * **Zwei Zeiten, und hier fällt die Zuordnung.** `sampleTime()` legt
	 * beide an (usePlayback.js): `currentTimeMs` ist die rohe Zeit der
	 * Audiouhr, `displayTimeMs` das, was gerade zu HÖREN ist - um die
	 * Ausgabelatenz zurückgerechnet, über Bluetooth bis zu 300 ms. Der
	 * Cursor bekommt die Anzeigezeit; Loop und Metronom bekommen die rohe,
	 * weil beide gegen dieselbe Audiouhr terminieren bzw. springen. Ein
	 * pauschaler Abzug schon in der Zeitquelle wäre deshalb falsch - die
	 * ausführliche Begründung steht in lib/playbackTime.js.
	 *
	 * Die Schleife schreibt nur in Refs, die der Viewer selbst NICHT rendert
	 * (die Zeit liest LiveValue.vue) oder die sich nur mit der Note aendern
	 * (Cursor, elid) - sonst rendete der ganze Viewer in jedem Frame neu.
	 *
	 * It runs only while the time moves - playing, following the leader, or
	 * shortly after the clock announced a change - and sleeps otherwise
	 * (lib/timeLoopWake.js). A paused score costs no frames.
	 */
	function pumpTimeDisplay() {
		// Nie zwei Schleifen: Wer zweimal startet (erneutes Laden), liesse
		// die erste sonst ohne Griff weiterlaufen - auch nach dem Schliessen.
		stopTimeDisplay()
		pumping = true
		wakeWindow.wake(performance.now())
		step()
	}

	function step() {
		frameHandle = null
		if (!pumping) {
			return
		}
		if (clock.value) {
			hooks.sampleTime()
			// Eine Auflösung für beides: der Cursor braucht das Rechteck,
			// eine Notiz das elid (currentAnchor) - so wird nicht zweimal
			// nach demselben elid gesucht.
			currentElid.value = sync?.update(hooks.displayTimeMs()) ?? null
			// Loop (Kernfunktion für Probenarbeit): sobald das Ende
			// erreicht/überschritten ist, zurück zum Anfang - hier statt in
			// silentClock.js/player.js geprüft, weil beide Zeitquellen
			// dieselbe kleine seek()-Schnittstelle erfüllen und Looping keine
			// Eigenschaft der Zeitquelle selbst ist.
			//
			// Mit der ROHEN Zeit: So springt der Ton rechtzeitig, und der
			// Cursor springt (auf der Anzeigezeit) genau dann, wenn der
			// Sprung hörbar wird. Mit der Anzeigezeit käme der Rücksprung
			// um die Ausgabelatenz zu spät - man hörte über das
			// Loop-Ende hinaus.
			hooks.wrapLoop(hooks.currentTimeMs())
			// Ebenfalls die rohe Zeit: Der Klick wird über die Uhr des
			// AudioContext terminiert (metronomeClick.js) und geht damit
			// durch dieselbe Ausgabelatenz wie die Musik. Mit der
			// Anzeigezeit käme er um genau diese Latenz zu spät - der
			// Fehler wäre verdoppelt statt behoben.
			hooks.tickMetronome(hooks.currentTimeMs())
		}
		for (const listener of frameListeners) {
			listener()
		}
		const keepRunning = wakeWindow.shouldRun({
			playing: clock.value?.isPlaying?.() ?? false,
			following: hooks?.isFollowing?.() ?? false,
			nowMs: performance.now(),
		})
		if (keepRunning) {
			frameHandle = requestAnimationFrame(step)
		}
	}

	/**
	 * Something moved the time (play, pause, seek, tempo - announced by the
	 * clock itself, or the leader's time being attached): run the loop again
	 * for at least the settle window. Cheap when it already runs.
	 */
	function wakeTimeDisplay() {
		wakeWindow.wake(performance.now())
		if (pumping && frameHandle === null) {
			frameHandle = requestAnimationFrame(step)
		}
	}

	/**
	 * Run `listener` on every step of the loop.
	 *
	 * @param {() => void} listener
	 * @return {() => void} unsubscribe
	 */
	function onFrame(listener) {
		frameListeners.add(listener)
		wakeTimeDisplay()
		return () => frameListeners.delete(listener)
	}

	// Every movement of the time passes through the clock - so the clock
	// wakes the loop, not the many places that call play/seek (lib/player.js).
	watch(clock, (neu, alt) => {
		alt?.removeEventListener?.('wake', wakeTimeDisplay)
		neu?.addEventListener?.('wake', wakeTimeDisplay)
		wakeTimeDisplay()
	})

	function stopTimeDisplay() {
		pumping = false
		if (frameHandle) {
			cancelAnimationFrame(frameHandle)
			frameHandle = null
		}
	}

	/**
	 * Das Nachfuehren eine Weile auch gegen manuelles Blaettern erzwingen -
	 * fuer einen Sprung der Leitung, der sichtbar werden soll.
	 *
	 * @param {number} ms
	 */
	function forceAutoScrollFor(ms) {
		forceScrollUntil = Date.now() + ms
	}

	/** Wiedergabe, Schleife und Abfragen abbauen - beim Schliessen und in reset(). */
	function cleanup() {
		hooks.stopPolling()
		sync = null
		hooks.destroyMetronome()
		stopTimeDisplay()
		hooks.destroyPlayback()
		hooks.stopZoomObserver()
	}

	/**
	 * Alles vergessen, was an der geladenen Konvertierung hing, und ein noch
	 * laufendes load() zum Veralteten erklaeren. Was andere Bereiche von
	 * sich aus zuruecksetzen, bleibt deren Sache (reset() im Viewer).
	 */
	function reset() {
		generation++
		midiUrl.value = null
		cleanup()
		scoreMeta.value = null
		pageUrls.value = []
		cursorRect.value = null
		cursorForced.value = false
		totalMeasures.value = 0
		scoreParts.value = []
		timeline.value = null
		measuresTimeline.value = null
		variantMeta.value = null
		variantKey.value = null
		basePicture = null
		currentEtag.value = null
		currentElid.value = null
		rendererBackend.value = null
		mscoreVersion.value = null
		canReconvert.value = false
		canWriteFolder.value = false
	}

	return {
		timeline,
		measuresTimeline,
		systemRectsByPage,
		currentEtag,
		durationMs,
		clock,
		scoreMeta,
		pictureMeta,
		pictureParts,
		variantMeta,
		variantKey,
		elids,
		applyPicture,
		pageUrls,
		scoreParts,
		totalMeasures,
		rendererBackend,
		mscoreVersion,
		canReconvert,
		canWriteFolder,
		midiUrl,
		cursorRect,
		cursorForced,
		currentElid,
		connect,
		load,
		pumpTimeDisplay,
		wakeTimeDisplay,
		onFrame,
		forceAutoScrollFor,
		cleanup,
		reset,
	}
}
