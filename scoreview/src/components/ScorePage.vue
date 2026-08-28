<template>
	<div
		ref="root"
		class="score-page"
		:style="pageStyle"
		@pointerdown="onPointerDown"
		@click="onClick">
		<!--
			Overlay HINTER dem Notenbild - hinter statt davor, damit es keinen
			Notenkopf verdeckt. Es ist der Rückfall, nicht die Ergänzung: Sobald
			die Notenköpfe selbst leuchten (M10), malt es nichts mehr - zwei
			Anzeigen derselben Stelle sind eine zu viel. Sichtbar bleibt es, wo
			das SVG keine Kennungen trägt (Sidecar-Weg, siehe
			docs/architecture.md M9/M10). Im DOM bleibt es in beiden Fällen: Das
			Autoscroll misst seine Bildschirmposition (ref="cursor", siehe
			getCursorClientRect()). Die Stapelreihenfolge kommt aus dem CSS
			(.score-page-svg bekommt ein explizites z-index), nicht aus dieser
			Template-Reihenfolge - siehe Kommentar dort.
		-->
		<!--
			Markierung der eigenen Stimme, ganz unten in der Stapelfolge: Sie
			liegt hinter dem Cursor und hinter dem Notenbild und faerbt damit
			nur den Untergrund der Zeile ein - wie ein Buntstiftstrich unter
			den Noten, nicht darueber.
		-->
		<div
			v-for="(band, i) in myPartBands"
			:key="`mine-${i}`"
			class="score-page-mystaff"
			:style="band" />
		<div
			v-for="(band, i) in dimmedBands"
			:key="`dim-${i}`"
			class="score-page-dimmed"
			:style="band" />
		<div
			v-for="(band, i) in cursorBands"
			:key="`cursor-${i}`"
			:ref="i === 0 ? 'cursor' : undefined"
			class="score-page-cursor"
			:class="{ 'score-page-cursor--hidden': notesHighlighted }"
			:style="band" />
		<!--
			v-html ist hier unvermeidbar: das MuseScore-SVG soll als echtes DOM
			im Dokument liegen, damit Zoom, Scoped-CSS (siehe :deep(svg) unten)
			und das Koordinaten-Overlay darauf greifen - ein <img>/<object> waere
			eine eigene Ressource ohne Zugriff darauf. Die Quelle ist ein
			Nutzer-Upload, MuseScore rendert Titel, Liedtext und freie Textfelder
			aus der Partitur hinein: `svgMarkup` ist deshalb IMMER durch
			lib/svgSanitizer.js (DOMPurify) gegangen, nie roher Antworttext -
			siehe load() unten. Wird diese Regel je gelockert, muss die Zeile
			hier wieder auffallen, darum nur diese eine Zeile ausgenommen statt
			der Datei.
		-->
		<!-- eslint-disable-next-line vue/no-v-html -->
		<div v-if="svgMarkup" class="score-page-svg" v-html="svgMarkup" />
		<!--
			Sichtbarer Fehlerzustand statt weisser Flaeche. Die
			Seite behaelt ihre reservierte Hoehe, das Notenbild rutscht also
			nicht - nur diese eine Seite fehlt, und man sieht, dass sie fehlt.
		-->
		<div v-else-if="loadError" class="score-page-error">
			<p>{{ t('This page could not be loaded ({error}).', { error: loadError }) }}</p>
			<NcButton :disabled="loading" @click.stop="retry">
				{{ t('Try again') }}
			</NcButton>
		</div>
		<div
			v-for="marker in pageMarkers"
			:key="marker.id"
			class="score-page-marker"
			:class="{ 'score-page-marker--shared': marker.visibility === 'shared' }"
			:style="marker.style"
			:title="t('Note')"
			@click.stop="$emit('markerClick', marker.id)" />
		<!--
			Der Notiztext im Notenbild: „In Takt 10 bitte forte" muss beim
			Singen lesbar sein, ohne ein Panel zu oeffnen - so, wie es sonst
			mit Bleistift danebensteht. Deshalb am Anker, nicht in einer Liste.
		-->
		<div
			v-for="label in pageNoteLabels"
			:key="`text-${label.id}`"
			class="score-page-note"
			:class="{ 'score-page-note--shared': label.visibility === 'shared' }"
			:style="label.style"
			@click.stop="$emit('markerClick', label.id)">
			{{ label.content }}
		</div>
		<!--
			Sichtbare Loop-Bereichsmarkierung - zwei schmale, farbige Flaggen an
			Start-/Ende-Takt statt eines vollflächigen Bereichs: measures.json
			liefert nur Punktkoordinaten je Takt (M4), keine Taktbreite, ein
			Vollbereich wäre also erfunden.
		-->
		<div
			v-for="marker in pageLoopMarkers"
			:key="marker.id"
			class="score-page-loop-marker"
			:class="`score-page-loop-marker--${marker.kind}`"
			:style="marker.style" />
	</div>
</template>

<script>
import axios from '@nextcloud/axios'
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import { BASE_PAGE_WIDTH_PX, parseSvgSizeMm, parseViewBox } from '../lib/scoreLayout.js'
import { canMapStavesToParts, findStaffBands, groupBandsIntoSystems, stavesOfPart } from '../lib/staffBands.js'
import { buildSegmentIndex, setHighlight } from '../lib/svgIndex.js'
import { sanitizeSvg } from '../lib/svgSanitizer.js'

// Wie weit der Zeiger zwischen pointerdown und click wandern darf, damit es
// noch als Klick gilt. Grosszuegig genug fuer das Zittern eines
// Fingers auf Glas, klein genug, dass ein bewusstes Wischen nicht mehr
// hineinfaellt.
const CLICK_MOVE_TOLERANCE_PX = 8

// Abstand zum Sichtbereich, ab dem eine Seite geladen (LOAD) bzw. wieder
// freigegeben wird (UNLOAD). Der Unterschied ist
// Absicht: laden knapp vorher, entladen erst deutlich weiter weg. Waeren
// beide gleich, laege die Seite genau an der Grenze im Wechsel zwischen
// geladen und entladen - und jedes Nachladen ist ein HTTP-Abruf samt
// Sanitizer-Durchlauf.
const LOAD_MARGIN_PX = 600
const UNLOAD_MARGIN_PX = 2400

/**
 * Eine Seite als eingebettetes SVG (E2: MuseScore-eigenes Rendering statt
 * OSMD-Neusatz - siehe docs/architecture.md). Lädt lazy per
 * IntersectionObserver ("sichtbare Seiten bevorzugt laden, nicht alle auf
 * einmal"), nicht alle Seiten sofort beim Öffnen.
 *
 * Der Cursor ist ein reines CSS-Overlay in Prozent-Koordinaten relativ zur
 * eigenen viewBox (siehe scoreLayout.js/parseViewBox) - kein
 * Renderer-interner Zustand.
 */
export default {
	name: 'ScorePage',

	components: { NcButton },

	props: {
		svgUrl: {
			type: String,
			required: true,
		},

		// 0-indiziert, wie das "page"-Feld in timing.json/measures.json (M4).
		pageIndex: {
			type: Number,
			required: true,
		},

		cursorRect: {
			type: Object,
			default: null,
		},

		// Das gerade klingende Segment (elid aus timing.json). Traegt das SVG
		// die Kennungen aus M10, wird damit der Notenkopf selbst eingefaerbt;
		// sonst bleibt es beim Band aus cursorRect.
		cursorElid: {
			type: Number,
			default: null,
		},

		// Stufenloser Zoom ("über die SVG-Skalierung") - 1 = Standardbreite,
		// skaliert die max-width linear.
		zoom: {
			type: Number,
			default: 1,
		},

		// Notiz-Marker: {id, page, x, y, w, h} in SVG-Einheiten, unabhängig
		// von der Seite gefiltert - siehe pageMarkers.
		markers: {
			type: Array,
			default: () => [],
		},

		// Loop-Bereichsmarkierung: {id, kind:'start'|'end', page, x, y, w, h},
		// siehe pageLoopMarkers.
		loopMarkers: {
			type: Array,
			default: () => [],
		},

		// Taktrechtecke DIESER Seite aus measures.json. Sie liefern die
		// Systemgrenzen, an denen die Notenzeilen aufgeteilt werden - siehe
		// lib/staffBands.js, warum das nicht aus der Geometrie allein geht.
		systemRects: {
			type: Array,
			default: () => [],
		},

		// Welche Stimme "meine" ist (Index in metadata.parts) oder null.
		myPartIndex: {
			type: Number,
			default: null,
		},

		// Nur die eigene Zeile zeigen: die uebrigen werden zurueckgenommen,
		// nicht entfernt - das Seitenbild bleibt dasselbe (E2, kein Reflow).
		focusMyPart: {
			type: Boolean,
			default: false,
		},

		// Anzahl der Stimmen aus meta.json - die Gegenprobe fuer die
		// Zuordnung Notenzeile -> Stimme (siehe lib/staffBands.js).
		partCount: {
			type: Number,
			default: 0,
		},

		// Notiztexte im Notenbild anzeigen statt nur die Marker.
		showNoteText: {
			type: Boolean,
			default: false,
		},
	},

	emits: ['noteClick', 'markerClick', 'loaded', 'staffMapping'],

	data() {
		return {
			svgMarkup: null,
			viewBox: null,
			sizeMm: null,
			// Ladefehler dieser einen Seite: ohne ihn liesse ein 404
			// oder ein Verbindungsabriss die Seite dauerhaft leer, ohne Hinweis
			// und ohne zweiten Versuch.
			loadError: '',
			loading: false,
			// Position des letzten pointerdown - siehe onClick() zum Grund.
			pointerDownAt: null,
			// Ob auf dieser Seite gerade Notenkoepfe leuchten. Die Hervorhebung
			// selbst steht bewusst ausserhalb von data() (siehe created()); dieses
			// eine Bit liest das Template, es entscheidet, ob das Band malt.
			notesHighlighted: false,
		}
	},

	computed: {
		pageStyle() {
			// Reserviert die Seitenhöhe schon vor dem Laden (A4-Hochformat als
			// grobe Näherung, siehe docs/architecture.md E2 - "A4 ist das
			// native Seitenformat") - verhindert Scroll-Sprünge beim Nachladen
			// weiter unten liegender Seiten.
			const box = this.viewBox
			return {
				aspectRatio: box ? `${box.width} / ${box.height}` : '210 / 297',
				// Echte Breite statt `width: 100%` + `max-width`: mit `max-width`
				// bliebe die Containerbreite eine harte Obergrenze - `900 * zoom`
				// wirkte nur, solange es KLEINER als der Container war.
				// Hineinzoomen und schieben (der Normalfall am Tablet) ginge damit
				// gar nicht. Die Zoomstufe legt die Breite allein fest; der
				// Scroll-Container in ScoreViewer.vue erlaubt dafür waagerechtes
				// Scrollen, und "Seitenbreite" ist dort der Startwert, damit sich
				// nichts ändert, solange niemand selbst zoomt.
				width: `${BASE_PAGE_WIDTH_PX * this.zoom}px`,
			}
		},

		/**
		 * Die Notenzeilen dieser Seite, nach Systemen gruppiert. Wird einmal
		 * nach dem Laden berechnet und danach nur noch nachgeschlagen: Das
		 * SVG aendert sich nicht mehr, und die Ableitung laeuft ueber alle
		 * Notenlinien der Seite.
		 */
		staffSystems() {
			if (!this.svgMarkup) {
				return []
			}
			return groupBandsIntoSystems(findStaffBands(this.svgMarkup), this.systemRects)
		},

		/**
		 * Der Wiedergabecursor - EIN Band je Notenzeile statt eines Balkens
		 * ueber das ganze System.
		 *
		 * Der Unterschied ist nicht nur Optik: Ein durchgehender Balken
		 * ueberdeckt auch den Zwischenraum mit Liedtext und Dynamik und wirkt
		 * dadurch schwerer, als er muss. Aufgeteilt markiert er genau das, was
		 * gerade klingt - die Noten auf den Zeilen.
		 *
		 * Faellt die Zeilenerkennung aus (fremdes Notenbild, fehlende
		 * Taktrechtecke), bleibt es beim einen Rechteck ueber das System. Ohne
		 * diesen Rueckfall waere der Cursor dort ganz verschwunden.
		 */
		cursorBands() {
			const rect = this.cursorRect
			const box = this.viewBox
			if (!rect || !box || rect.page !== this.pageIndex) {
				return []
			}
			const links = `${((rect.x - box.minX) / box.width) * 100}%`
			const breite = `${(rect.w / box.width) * 100}%`

			const system = this.staffSystems.find((s) => rect.y < s.bottom + 1 && rect.y + rect.h > s.top - 1)
			if (!system) {
				return [{
					left: links,
					top: `${((rect.y - box.minY) / box.height) * 100}%`,
					width: breite,
					height: `${(rect.h / box.height) * 100}%`,
				}]
			}
			// Etwas ueber die aeusseren Notenlinien hinaus, damit Noten in
			// Hilfslinien noch im Band liegen.
			const luft = (system.staves[0].bottom - system.staves[0].top) / 4
			return system.staves.map((band) => ({
				left: links,
				top: `${((band.top - luft - box.minY) / box.height) * 100}%`,
				width: breite,
				height: `${((band.bottom - band.top + 2 * luft) / box.height) * 100}%`,
			}))
		},

		/**
		 * Ob sich die Notenzeilen dieser Seite ueberhaupt Stimmen zuordnen
		 * lassen - unabhaengig davon, ob schon eine gewaehlt ist. Der Viewer
		 * blendet die Bedienelemente danach aus (siehe onStaffMapping dort).
		 */
		staffMappingPossible() {
			return canMapStavesToParts(this.staffSystems, this.partCount)
		},

		/** Ob auf DIESER Seite eine Stimme markiert werden kann. */
		partsMappable() {
			return this.myPartIndex !== null && this.staffMappingPossible
		},

		myPartBands() {
			if (!this.partsMappable) {
				return []
			}
			return stavesOfPart(this.staffSystems, this.myPartIndex).map((band) => this.bandStyle(band))
		},

		/** Die uebrigen Zeilen, wenn „nur meine Zeile" eingeschaltet ist. */
		dimmedBands() {
			if (!this.partsMappable || !this.focusMyPart) {
				return []
			}
			return this.staffSystems
				.flatMap((system) => system.staves.filter((_, i) => i !== this.myPartIndex))
				.map((band) => this.bandStyle(band, 1.2))
		},

		pageMarkers() {
			const box = this.viewBox
			if (!box) {
				return []
			}
			return this.markers
				.filter((m) => m.page === this.pageIndex)
				.map((m) => ({
					id: m.id,
					visibility: m.visibility,
					style: {
						left: `${((m.x - box.minX) / box.width) * 100}%`,
						top: `${((m.y - box.minY) / box.height) * 100}%`,
					},
				}))
		},

		/**
		 * Die Notiztexte dieser Seite, am oberen Rand ihres Systems.
		 *
		 * Bewusst ueber dem System statt am Anker selbst: Am Anker laege der
		 * Text mitten in den Noten und verdeckte sie. Ueber dem System steht
		 * er dort, wo in gedruckten Noten ohnehin Anweisungen stehen - und
		 * bleibt beim Scrollen zusammen mit seinem Takt im Blick.
		 */
		pageNoteLabels() {
			const box = this.viewBox
			if (!box || !this.showNoteText) {
				return []
			}
			// Mehrere Notizen koennen am selben Takt haengen - in einer Probe
			// ist das der Normalfall, nicht die Ausnahme. Gestapelt statt
			// uebereinander gedruckt: ohne das ueberlagern sich die Texte bis
			// zur Unlesbarkeit (an zwei Notizen im selben Takt nachgestellt).
			const belegt = []
			return this.markers
				.filter((m) => m.page === this.pageIndex && (m.content ?? '') !== '')
				.map((m) => {
					const system = this.staffSystems.find((sys) => m.y < sys.bottom + 1 && m.y + m.h > sys.top - 1)
					const oben = system ? system.top : m.y
					// Ein Notenzeilen-Abstand ueber dem System - genug, um nicht
					// auf den Noten zu liegen, nah genug, um zuzugehoeren.
					const abstand = system ? (system.staves[0].bottom - system.staves[0].top) / 2 : m.h / 2
					const links = ((m.x - box.minX) / box.width) * 100
					const zeile = ((oben - abstand - box.minY) / box.height) * 100

					// Als belegt gilt, was in derselben Hoehe steht und
					// waagerecht naeher als eine Textbreite liegt.
					const stapel = belegt.filter((b) => Math.abs(b.zeile - zeile) < 0.5 && Math.abs(b.links - links) < 12).length
					belegt.push({ links, zeile })

					return {
						id: m.id,
						content: m.content,
						visibility: m.visibility,
						style: {
							left: `${links}%`,
							top: `${zeile}%`,
							maxWidth: `${100 - links}%`,
							transform: `translateY(calc(-100% - ${stapel * 1.7}em))`,
						},
					}
				})
		},

		pageLoopMarkers() {
			const box = this.viewBox
			if (!box) {
				return []
			}
			return this.loopMarkers
				.filter((m) => m.page === this.pageIndex)
				.map((m) => ({
					id: m.id,
					kind: m.kind,
					style: {
						left: `${((m.x - box.minX) / box.width) * 100}%`,
						top: `${((m.y - box.minY) / box.height) * 100}%`,
						height: `${(m.h / box.height) * 100}%`,
					},
				}))
		},
	},

	watch: {
		// Der Wiedergabeschritt: nur Klassen umhaengen, keine Suche im
		// Dokument (siehe lib/svgIndex.js).
		cursorElid() {
			this.applyHighlight()
		},
	},

	created() {
		/*
		 * Die Segmentkarte (M10) und die gerade eingefaerbten Knoten stehen
		 * bewusst NICHT in data(): Beides sind DOM-Knoten, die kein Template
		 * liest. In data() wuerde Vue sie tief reaktiv machen - einen Proxy um
		 * jeden einzelnen SVG-Knoten legen, je Seite ueber tausend davon - fuer
		 * einen Wert, dessen Aenderung gar nichts neu rendern soll.
		 */
		this.segmentIndex = null
		this.highlighted = []
	},

	mounted() {
		// Zwei Beobachter mit unterschiedlichem Rand: laden knapp vor dem
		// Sichtbarwerden, entladen erst deutlich weiter weg. Ein einzelner
		// Beobachter kann nur EINEN rootMargin haben, und mit nur einem waere
		// die Seite an der Grenze abwechselnd geladen und entladen worden.
		this.loadObserver = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) {
				this.load()
			}
		}, { rootMargin: `${LOAD_MARGIN_PX}px 0px` })
		this.loadObserver.observe(this.$refs.root)

		this.unloadObserver = new IntersectionObserver((entries) => {
			if (entries.every((e) => !e.isIntersecting)) {
				this.unload()
			}
		}, { rootMargin: `${UNLOAD_MARGIN_PX}px 0px` })
		this.unloadObserver.observe(this.$refs.root)
	},

	beforeUnmount() {
		this.loadObserver?.disconnect()
		this.unloadObserver?.disconnect()
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		/**
		 * Laedt das Seiten-SVG nach (lazy, siehe IntersectionObserver in
		 * mounted()).
		 *
		 * Der Observer wird erst NACH Erfolg abgemeldet. Vorher
		 * geschah es davor, und zusammen mit dem fehlenden catch war ein
		 * einzelner Fehlschlag endgueltig: die Seite blieb fuer den Rest der
		 * Sitzung weiss, ohne Hinweis, und weil der Observer schon weg war,
		 * loeste auch erneutes Hinscrollen keinen zweiten Versuch mehr aus.
		 * Das ist kein theoretischer Fall - `gcOldVersions()` raeumt den
		 * etag-Ordner einer aelteren Fassung weg, waehrend jemand sie noch
		 * offen hat (ConversionService), und dann antwortet genau diese Route
		 * mit 404.
		 */
		async load() {
			if (this.svgMarkup || this.loading) {
				return
			}
			this.loading = true
			this.loadError = ''
			try {
				const res = await axios.get(this.svgUrl, { responseType: 'text' })
				this.viewBox = parseViewBox(res.data)
				this.sizeMm = parseSvgSizeMm(res.data)
				this.svgMarkup = sanitizeSvg(res.data)
				// Für die Zoom-Presets ("Seitenbreite/ganze Seite/100%") -
				// ScoreViewer.vue kennt die Seitengeometrie selbst nicht, nur die
				// jeweils geladene ScorePage.
				this.$emit('loaded', { index: this.pageIndex, viewBox: this.viewBox, sizeMm: this.sizeMm })
				// Erst jetzt steht das SVG - vorher gaebe es keine Notenlinien
				// zu zaehlen.
				this.$emit('staffMapping', this.staffMappingPossible)
				// Und erst nach dem naechsten Rendern haengt es im Dokument.
				this.$nextTick(() => this.indexSegments())
			} catch (err) {
				this.loadError = err.response?.status
					? `HTTP ${err.response.status}`
					: err.message
			} finally {
				this.loading = false
			}
		},

		/** Erneuter Versuch nach einem Ladefehler (Knopf auf der leeren Seite). */
		retry() {
			this.load()
		},

		/**
		 * Baut die Karte elid -> Notenkopf fuer diese Seite (M10).
		 *
		 * Bleibt sie leer, traegt das SVG keine Kennungen - dann stammt die
		 * Partitur aus einer aelteren Konvertierung oder vom Sidecar mit
		 * Stock-MuseScore, und die Anzeige bleibt beim Cursor-Band. Kein
		 * Schalter, keine Einstellung: was da ist, wird benutzt.
		 */
		indexSegments() {
			const svg = this.$refs.root?.querySelector('.score-page-svg')
			this.segmentIndex = buildSegmentIndex(svg)
			this.highlighted = []
			// Die Seite kann mitten in der Wiedergabe nachgeladen worden sein.
			this.applyHighlight()
		},

		/** Haengt die Hervorhebung auf das gerade klingende Segment um. */
		applyHighlight() {
			if (!this.segmentIndex) {
				return
			}
			// Nur die Seite, auf der der Cursor steht, faerbt - dieselbe elid
			// kann bei einer Wiederholung (M7) sonst auf zwei Seiten leuchten.
			const aktiv = this.cursorRect?.page === this.pageIndex ? this.cursorElid : null
			this.highlighted = setHighlight(this.segmentIndex, aktiv, this.highlighted, 'scoreview-sounding')
			this.notesHighlighted = this.highlighted.length > 0
		},

		/**
		 * Gibt das Notenbild wieder frei, wenn die Seite weit aus dem Bild
		 * gescrollt ist.
		 *
		 * Ohne das Freigeben waeren bei einer Orchesterpartitur nach einmaligem
		 * Durchscrollen alle Seiten samt zehntausender `<path>`-Knoten
		 * gleichzeitig im DOM - siehe docs/limits.md zur DOM-Last.
		 *
		 * Freigegeben wird **nur** das Markup: `viewBox` und `sizeMm` bleiben,
		 * damit die Seite ihre Höhe weiter über `aspectRatio` reserviert (kein
		 * Scroll-Sprung) und die Zoom-Presets ihre Geometrie behalten. Die
		 * Seite verhält sich danach exakt wie eine noch nie geladene, und der
		 * Ladebeobachter greift beim Zurückscrollen unverändert.
		 */
		unload() {
			if (!this.svgMarkup) {
				return
			}
			// Die Seite, auf der der Cursor gerade steht, nie freigeben - sonst
			// verschwände das Notenbild unter der laufenden Wiedergabe, falls
			// der Beobachter bei einem weiten Sprung kurz „nicht sichtbar"
			// meldet, bevor das Autoscroll nachgezogen hat.
			if (this.cursorRect && this.cursorRect.page === this.pageIndex) {
				return
			}
			this.svgMarkup = null
			// Die Karte zeigt auf Knoten, die es gleich nicht mehr gibt.
			this.segmentIndex = null
			this.highlighted = []
			this.notesHighlighted = false
		},

		// Umkehrung von M4 (Koordinate -> elid: "Klick auf eine Note springt
		// dorthin"): rechnet die Klickposition in SVG-Einheiten dieser Seite
		// um und reicht sie an ScoreViewer.vue weiter, die dort per
		// findElementAtPoint()/findNearestOccurrenceTimeMs() (scoreLayout.js)
		// aufgelöst wird - diese Komponente kennt die Notenkoordinaten selbst
		// nicht (nur ihre eigene viewBox).
		onPointerDown(event) {
			this.pointerDownAt = { x: event.clientX, y: event.clientY }
		},

		onClick(event) {
			if (!this.viewBox) {
				return
			}
			// Ein Klick, zwischen dessen Nieder- und Loslassen der Zeiger
			// gewandert ist, war kein Klick, sondern das Ende eines Ziehens
			// oder einer Zweifinger-Geste. Auf dem Tablet ist das
			// der haeufigste Fall ueberhaupt: jedes Wischen und jedes
			// Pinch-Zoom endet sonst mit einem Sprung an eine andere Stelle.
			// Kein pointerdown gesehen (synthetischer Klick, Tastatur) zaehlt
			// bewusst als echter Klick.
			if (this.pointerDownAt) {
				const dx = event.clientX - this.pointerDownAt.x
				const dy = event.clientY - this.pointerDownAt.y
				this.pointerDownAt = null
				if (Math.sqrt((dx * dx) + (dy * dy)) > CLICK_MOVE_TOLERANCE_PX) {
					return
				}
			}
			const rect = this.$refs.root.getBoundingClientRect()
			const fracX = (event.clientX - rect.left) / rect.width
			const fracY = (event.clientY - rect.top) / rect.height
			this.$emit('noteClick', {
				page: this.pageIndex,
				x: this.viewBox.minX + fracX * this.viewBox.width,
				y: this.viewBox.minY + fracY * this.viewBox.height,
			})
		},

		// Für den Autoscroll (src/lib/scrollPlan.js): der Aufrufer
		// (ScoreViewer.vue) kennt nur ein SVG-Rechteck (page/x/y/w/h), nicht die
		// tatsächliche Bildschirmposition des gerenderten Cursor-Overlays -
		// getBoundingClientRect() liefert genau die, inklusive Zoom/Scroll, ohne
		// dass ScoreViewer.vue selbst rechnen müsste. null, solange kein Cursor
		// auf dieser Seite gerendert ist (siehe cursorStyle).
		getCursorClientRect() {
			// Seit der Cursor in Baender je Notenzeile zerfaellt, liefert Vue
			// hier ein Array. Das Autoscroll will das ganze System im Blick
			// behalten, nicht nur die oberste Zeile - deshalb die Huelle ueber
			// alle Baender statt des ersten.
			const baender = [this.$refs.cursor].flat().filter(Boolean)
			if (baender.length === 0) {
				return null
			}
			const rechtecke = baender.map((el) => el.getBoundingClientRect())
			const top = Math.min(...rechtecke.map((r) => r.top))
			const bottom = Math.max(...rechtecke.map((r) => r.bottom))
			const left = Math.min(...rechtecke.map((r) => r.left))
			const right = Math.max(...rechtecke.map((r) => r.right))
			return new DOMRect(left, top, right - left, bottom - top)
		},

		/**
		 * Ein Notenzeilen-Band als CSS-Position, ueber die volle Systembreite.
		 *
		 * @param {{top:number,bottom:number,left:number,right:number}} band
		 * @param {number} luftFaktor Vielfaches des Linienabstands als Rand
		 * @return {object}
		 */
		bandStyle(band, luftFaktor = 0.5) {
			const box = this.viewBox
			const luft = ((band.bottom - band.top) / 4) * luftFaktor
			return {
				left: `${((band.left - box.minX) / box.width) * 100}%`,
				top: `${((band.top - luft - box.minY) / box.height) * 100}%`,
				width: `${((band.right - band.left) / box.width) * 100}%`,
				height: `${((band.bottom - band.top + 2 * luft) / box.height) * 100}%`,
			}
		},
	},
}
</script>

<style scoped>
.score-page {
	position: relative;
	/* Breite kommt aus pageStyle (Zoom) - hier bewusst KEIN width/max-width,
	   sonst wäre der Zoom wieder an der Containerbreite gedeckelt. */
	margin: 0 auto 16px auto;
	background: #fff;
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
	cursor: pointer;
}

/*
 * Fehlerzustand einer einzelnen Seite - mittig auf der ohnehin
 * reservierten Seitenflaeche, damit die uebrigen Seiten an ihrem Platz
 * bleiben.
 */
.score-page-error {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 16px;
	text-align: center;
	color: var(--color-text-maxcontrast);
	z-index: 3;
}

.score-page-svg {
	/*
	 * position+z-index (nicht die DOM-Reihenfolge im Template) entscheidet
	 * hier über die Stapelreihenfolge: ein absolut positioniertes Element
	 * (score-page-cursor) malt CSS-spezifikationsgemäß immer NACH
	 * nicht-positionierten Elementen, unabhängig von der DOM-Reihenfolge -
	 * ohne dieses z-index läge der Cursor also trotz der Template-Reihenfolge
	 * weiter oben, nicht hinter dem Notenbild (siehe docs/architecture.md M9).
	 */
	position: relative;
	z-index: 1;
	width: 100%;
	height: 100%;
}

/*
 * :deep() ist hier zwingend, nicht nur Stil: v-html fügt das <svg> als
 * rohes DOM ein, ohne Vues Scoped-CSS-Attribut (data-v-xxxx) - ein
 * gewöhnliches ".score-page-svg svg { ... }" kompiliert zu
 * ".score-page-svg svg[data-v-xxxx]" (das Attribut landet auf dem
 * RECHTEN/inneren Selektor) und traf das <svg> dadurch nie. Ohne diese
 * Regel rendert das SVG stattdessen in seiner eigenen mm-Bemaßung statt
 * auf 100% der Containerbreite - das Cursor-Overlay (Prozentwerte relativ
 * zum Container) und die tatsächlich sichtbare Note driften dann
 * auseinander (gemessen: SVG 793.9px statt Container-Breite 900px).
 */
.score-page-svg :deep(svg) {
	width: 100%;
	height: auto;
	display: block;
}

/*
 * MuseScore rendert als allererstes Element ein deckendes weißes
 * Hintergrundrechteck über die volle viewBox (siehe docs/architecture.md
 * M9) - ohne diese Regel würde es den dahinterliegenden Cursor vollständig
 * verdecken. path[class=""] ist laut M9 im ganzen Dokument eindeutig nur
 * dieses eine Element (kein id-Attribut vorhanden, das sich sonst
 * anbieten würde). :deep() aus demselben Grund wie oben (v-html, kein
 * Scoped-Attribut).
 */
.score-page-svg :deep(path[class=""]) {
	fill: none;
}

/*
 * Rechteck statt Ellipse (Nutzer-Feedback: eine hochskalierte Ellipse
 * ragte deutlich über das eigentliche System hinaus). Das Overlay liegt
 * hinter dem Notenbild (siehe .score-page-svg oben) und darf den
 * Notenkopf deshalb ohne Weichzeichnung markieren - die Notenlinien werden
 * ohnehin vom SVG darüber gezeichnet, kein Scale-Trick nötig.
 */
/*
 * Der Cursor liegt HINTER dem Notenbild (siehe .score-page-svg), faerbt also
 * den Untergrund der klingenden Noten ein, statt sie zu ueberdecken. Dezent
 * genug, dass er beim Lesen nicht traegt: eine weiche Flaeche mit leichter
 * Rundung, kein Rahmen. Der Rahmen der frueheren Fassung zog auf jeder Zeile
 * eine zweite Linie ins Bild und konkurrierte mit den Notenlinien.
 */
.score-page-cursor {
	position: absolute;
	background: rgba(0, 130, 201, 0.22);
	border-radius: 4px;
	pointer-events: none;
	transition: left 0.08s linear, top 0.08s linear, height 0.08s linear;
}

/*
 * Leuchten die Notenkoepfe selbst (M10), malt das Band nichts mehr - eine
 * Anzeige der klingenden Stelle genuegt. Es bleibt trotzdem im DOM und
 * behaelt seine Groesse: Das Autoscroll misst genau dieses Element
 * (getCursorClientRect()), mit display:none oder v-if haette es keine.
 */
.score-page-cursor--hidden {
	background: transparent;
}

/*
 * Der klingende Notenkopf selbst - moeglich, seit das SVG seine
 * Segmentkennung mitbringt (M10, siehe lib/svgIndex.js). Sobald hier etwas
 * leuchtet, tritt das Cursor-Band zurueck (siehe .score-page-cursor--hidden)
 * - beides zusammen markierte dieselbe Stelle doppelt.
 *
 * Zwei Regeln statt einer, weil MuseScore zwei Maltechniken mischt
 * (nachgezaehlt an einer ausgelieferten Seite): Note, Rest und Beam sind
 * gefuellte <path> ohne fill-Attribut, Stem und LedgerLine dagegen
 * <polyline fill="none" stroke="#000000">. Eine gemeinsame fill-Regel liesse
 * die Notenhaelse schwarz.
 *
 * :deep() ist zwingend: die Knoten kommen aus v-html und tragen deshalb kein
 * scoped-Attribut. Kein transition - bei acht Ereignissen je Sekunde soll die
 * Farbe stehen, nicht nachlaufen.
 */
.score-page-svg :deep(path.scoreview-sounding),
.score-page-svg :deep(text.scoreview-sounding) {
	fill: #0082c9;
}

.score-page-svg :deep(polyline.scoreview-sounding),
.score-page-svg :deep(line.scoreview-sounding) {
	stroke: #0082c9;
}

/*
 * „Meine Stimme": ein durchgehender, blasser Streifen unter der eigenen
 * Notenzeile - das digitale Gegenstueck zum Buntstiftstrich, mit dem
 * Singende ihre Zeile markieren. Bewusst blass: Er soll beim Blaettern ins
 * Auge fallen, aber beim Lesen der Noten nicht mithalten.
 */
.score-page-mystaff {
	position: absolute;
	background: rgba(255, 193, 7, 0.18);
	border-inline-start: 3px solid rgba(255, 152, 0, 0.75);
	border-radius: 3px;
	pointer-events: none;
}

/*
 * „Nur meine Zeile": Die uebrigen Zeilen werden mit der Seitenfarbe
 * ueberblendet statt entfernt. Entfernen ginge nur mit einem zweiten
 * Notensatz (E2: kein Reflow) - so bleibt das Seitenbild erhalten, und wer
 * doch in die Nachbarstimme schauen will, erkennt sie noch schemenhaft.
 *
 * Liegt als einziges dieser Overlays VOR dem Notenbild - es soll ja gerade
 * ueberdecken.
 */
.score-page-dimmed {
	position: absolute;
	background: var(--color-main-background, #fff);
	opacity: 0.78;
	pointer-events: none;
	z-index: 2;
}

/*
 * Notiztext im Notenbild. Klein, aber nicht kleiner als lesbar: Er steht am
 * Notenstaender in Armlaenge. Er skaliert bewusst NICHT mit dem Zoom (feste
 * Punktgroesse), damit er beim Herauszoomen lesbar bleibt, wo die Noten es
 * schon nicht mehr sind.
 */
.score-page-note {
	position: absolute;
	/* transform kommt aus pageNoteLabels - es traegt den Stapelversatz. */
	padding: 1px 6px;
	border-radius: 4px;
	background: var(--color-primary-element-light, #d5eaff);
	color: var(--color-main-text, #222);
	font-size: 13px;
	line-height: 1.35;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	cursor: pointer;
	z-index: 3;
}

.score-page-note--shared {
	background: var(--color-success-hover, #d8f0d8);
}

.score-page-loop-marker {
	position: absolute;
	width: 3px;
	pointer-events: none;
	z-index: 2;
}

.score-page-loop-marker--start {
	background: var(--color-success, #2e7d32);
	box-shadow: 2px 0 0 rgba(46, 125, 50, 0.3);
}

.score-page-loop-marker--end {
	background: var(--color-error, #c62828);
	box-shadow: -2px 0 0 rgba(198, 40, 40, 0.3);
}

.score-page-marker {
	position: absolute;
	width: 14px;
	height: 14px;
	/*
	 * Physisch, nicht logisch - hier ausnahmsweise mit Absicht: der Marker
	 * wird ueber `left`/`top` in Prozent der SVG-viewBox positioniert
	 * (pageMarkers oben), und ein Notenbild spiegelt sich in einer
	 * RTL-Oberflaeche nicht mit. `margin-inline-start` wuerde den Punkt dort
	 * gegen sein eigenes `left` verschieben, statt ihn auf der Koordinate zu
	 * zentrieren. Die Bedienflaeche drumherum nutzt sehr wohl logische
	 * Eigenschaften (siehe ScoreViewer.vue).
	 */
	/* stylelint-disable-next-line csstools/use-logical */
	margin-left: -7px;
	margin-top: -7px;
	background: var(--color-warning, orange);
	border: 2px solid #fff;
	border-radius: 50%;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
	cursor: pointer;
	z-index: 2;
}

/*
 * Geteilte Notizen bekommen eine eigene Farbe ("eigene und geteilte
 * Notizen unterscheidbar, Markerfarbe") - dieselbe Primärfarbe wie der
 * linke Akzentbalken in ScoreAnnotations.vue, damit Notenbild und Liste
 * dieselbe Sprache sprechen.
 */
.score-page-marker--shared {
	background: var(--color-primary-element, #0082c9);
}
</style>
