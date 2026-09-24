import axios from '@nextcloud/axios'
import { computed, nextTick, ref, shallowRef } from 'vue'
import { buildTimeline, groupRectsByPage } from '../lib/scoreLayout.js'
import { createScoreSync } from '../lib/scoreSync.js'

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
	// score.mid dieser Partitur - die Intonation laedt es nach, wenn ohne Ton
	// niemand sonst es geholt hat (useScoreFacts.ensureMidi).
	const midiUrl = ref(null)
	// Was die Frame-Schleife aufloest: das Rechteck fuer den Cursor und das
	// elid fuer eine neue Notiz (currentAnchor im Viewer).
	const cursorRect = ref(null)
	const currentElid = ref(null)

	// Zaehlt jeden reset(): Ein load(), das nach einem await eine andere Zahl
	// vorfindet, gehoert zu einem Stueck, das nicht mehr offen ist
	// (Stueckwechsel mitten im Laden).
	let generation = 0
	let sync = null
	let frameHandle = null
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
	 */
	async function load({ files, soundFontUrl, renderer, canReconvert: mayReconvert }) {
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
			totalMeasures.value = metaRes.data.measures ?? measuresTimeline.value.events.length
			hooks.loadAnnotations()
			// Die Studierbuchstaben kommen auf dem Sidecar-Weg nur aus dem MIDI
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

			sync = createScoreSync(notes, (rect) => {
				cursorRect.value = rect
				// Nachführen statt nur beim Seitenwechsel zu springen. Nach
				// einem Sprung der Leitung auch dann, wenn gerade von Hand
				// geblaettert wurde: Blaettern loest das Folgen nicht, der
				// Sprung soll also sichtbar werden (forceAutoScrollFor).
				hooks.updateAutoScroll(rect, Date.now() < forceScrollUntil)
			})

			pumpTimeDisplay()
		} catch (err) {
			if (stale()) {
				return
			}
			hooks.onError(err.message)
		}
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
	 */
	function pumpTimeDisplay() {
		// Nie zwei Schleifen: Wer zweimal startet (erneutes Laden), liesse
		// die erste sonst ohne Griff weiterlaufen - auch nach dem Schliessen.
		stopTimeDisplay()
		const step = () => {
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
			frameHandle = requestAnimationFrame(step)
		}
		step()
	}

	function stopTimeDisplay() {
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
		totalMeasures.value = 0
		scoreParts.value = []
		timeline.value = null
		measuresTimeline.value = null
		currentEtag.value = null
		currentElid.value = null
		rendererBackend.value = null
		mscoreVersion.value = null
		canReconvert.value = false
	}

	return {
		timeline,
		measuresTimeline,
		systemRectsByPage,
		currentEtag,
		durationMs,
		clock,
		scoreMeta,
		pageUrls,
		scoreParts,
		totalMeasures,
		rendererBackend,
		mscoreVersion,
		canReconvert,
		midiUrl,
		cursorRect,
		currentElid,
		connect,
		load,
		pumpTimeDisplay,
		forceAutoScrollFor,
		cleanup,
		reset,
	}
}
