<template>
	<div
		ref="root"
		class="score-page"
		:class="{ 'score-page--dark': noteTheme === 'dark', 'score-page--static': printSheet }"
		:style="pageStyle"
		@pointerdown="onPointerDown"
		@click="onClick">
		<!--
			Overlay HINTER dem Notenbild - hinter statt davor, damit es keinen
			Notenkopf verdeckt. Es ist der Rückfall, nicht die Ergänzung: Sobald
			die Notenköpfe selbst leuchten (M10), malt es nichts mehr - zwei
			Anzeigen derselben Stelle sind eine zu viel. Sichtbar bleibt es, wo
			das SVG keine Kennungen trägt (MuseScore auf dem Sidecar, siehe
			docs/architecture.md M9/M10). Die Stapelreihenfolge kommt aus dem CSS
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
		<!--
			Der Cursor als <rect> in einer SVG-Ebene mit der viewBox der Seite,
			nicht als positionierte <div>s: Er bewegt sich bei jedem Notenschritt,
			und in Files kostet jede Aenderung eines style-Attributs eine
			Stil-Neuberechnung ueber den ganzen Baum (Nextclouds :has()-Regeln
			mit [style*=...] an body/Viewer - gemessen: ~70 ms je Aenderung am
			Desktop, am S23 die halbe Hauptthread-Zeit). Geometrie-Attribute
			eines SVG-Elements kosten dort nichts (gemessen: 3 ms fuer 50).
		-->
		<svg
			v-if="cursorRects.length > 0"
			class="score-page-cursor-layer"
			:viewBox="viewBoxAttr"
			preserveAspectRatio="none"
			aria-hidden="true">
			<rect
				v-for="(band, i) in cursorRects"
				:key="`cursor-${i}`"
				class="score-page-cursor"
				:class="{ 'score-page-cursor--hidden': notesHighlighted }"
				:x="band.x"
				:y="band.y"
				:width="band.w"
				:height="band.h" />
		</svg>
		<!--
			The notation lives in a document of its own: a source-less iframe
			in this element, filled by renderSvg() - not v-html. The page SVG
			is thousands of nodes, and in the Files page every style change
			anywhere (a menu opening, Play turning into Pause) recomputed all
			of them - against Nextcloud's ~1,900 global selectors, and even
			from a shadow root through a :has() rule of the unified search.
			Measured figures and the details in scorePageFrame.js. Vue never
			patches the children of this element, so the frame survives every
			re-render.
		-->
		<div ref="svgHost" class="score-page-svg" />
		<!--
			Sichtbarer Fehlerzustand statt weisser Flaeche. Die
			Seite behaelt ihre reservierte Hoehe, das Notenbild rutscht also
			nicht - nur diese eine Seite fehlt, und man sieht, dass sie fehlt.
		-->
		<div v-if="!svgMarkup && loadError" class="score-page-error">
			<p>{{ t('This page could not be loaded ({error}).', { error: loadError }) }}</p>
			<NcButton :disabled="loading" @click.stop="retry">
				{{ t('Try again') }}
			</NcButton>
		</div>
		<div
			v-for="marker in pageMarkers"
			:key="marker.id"
			class="score-page-marker"
			:class="{
				'score-page-marker--shared': marker.visibility === 'shared',
				'score-page-marker--parts': marker.visibility === 'parts',
				'score-page-marker--dimmed': marker.dimmed,
			}"
			:style="marker.style"
			:title="marker.voices.length ? t('Note for {voices}', { voices: marker.voices.join(', ') }) : t('Note')"
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
			:class="{
				'score-page-note--shared': label.visibility === 'shared',
				'score-page-note--parts': label.visibility === 'parts',
				'score-page-note--dimmed': label.dimmed,
			}"
			:style="label.style"
			@click.stop="$emit('markerClick', label.id)">
			<!-- Die Zielstimme vorneweg - eine Stimmnotiz ohne sie liest sich
				wie eine Anweisung an alle. -->
			<strong v-if="label.voices.length">{{ label.voices.join(', ') }}:</strong>
			{{ label.content }}
		</div>
		<!--
			Stempel als Zeichen im Notenbild, nicht als Marker mit
			Aufklapptext: Ein Atemzeichen muss man beim Singen sehen, nicht
			suchen. Ueber dem Notenbild, damit es nicht darunter verschwindet.
		-->
		<ScoreStamps
			:stamps="pageStamps"
			:systems="staffSystems"
			:mappable="staffMappingPossible"
			:viewBox="viewBox"
			@stampClick="(id) => $emit('markerClick', id)" />
		<!--
			Freehand drawings (E22), and the pen while drawing - over the
			stamps, because a drawing is the last thing put on the page.
		-->
		<ScoreDrawings
			:drawings="pageDrawings"
			:systems="staffSystems"
			:mappable="staffMappingPossible"
			:viewBox="viewBox"
			:drawMode="drawMode && !printSheet"
			:pendingStrokes="pagePendingStrokes"
			@drawingClick="(id) => $emit('markerClick', id)"
			@stroke="onStroke" />
		<!--
			Tonnamen (H3) links neben den Notenkoepfen. Nicht klickbar: Ein
			Tipp soll die Note treffen, nicht ihr Etikett.
		-->
		<span
			v-for="label in noteLabels"
			:key="label.key"
			class="score-page-note-name"
			:style="{ left: label.left + '%', top: label.top + '%', fontSize: label.size + 'px', lineHeight: label.lineHeight + 'px', width: label.width + 'px', textAlign: label.align }"
			aria-hidden="true">{{ label.text }}</span>
		<!--
			Beat numbers (B1) as SVG text in page units: they scale with the
			notation, and - like the cursor - cost no style recalculation
			during playback, since nothing of them ever changes an attribute
			while the music runs.
		-->
		<!--
			Focus on the loop: a veil in the paper's colour over everything
			outside the looped measures. Over the notation, so the ink fades
			with the paper; attributes only, like the cursor.
		-->
		<svg
			v-if="loopDimRects.length > 0"
			class="score-page-loopdim-layer"
			:viewBox="viewBoxAttr"
			preserveAspectRatio="none"
			aria-hidden="true">
			<rect
				v-for="(band, i) in loopDimRects"
				:key="`dim-${i}`"
				class="score-page-loopdim"
				:x="band.x"
				:y="band.y"
				:width="band.w"
				:height="band.h" />
		</svg>
		<svg
			v-if="countLabels.length > 0"
			class="score-page-count-layer"
			:viewBox="viewBoxAttr"
			aria-hidden="true">
			<text
				v-for="label in countLabels"
				:key="label.key"
				class="score-page-count"
				:x="label.x"
				:y="label.y"
				:font-size="label.size">{{ label.text }}</text>
		</svg>
		<span
			v-if="tapBubble"
			class="score-page-tap-bubble"
			:style="{ left: tapBubble.left + '%', top: tapBubble.top + '%' }"
			role="status">{{ tapBubble.text }}</span>
		<!--
			Sichtbare Loop-Bereichsmarkierung - zwei schmale, farbige Flaggen an
			Start-/Ende-Takt statt eines vollflächigen Bereichs: measures.json
			liefert nur Punktkoordinaten je Takt (M4), keine Taktbreite, ein
			Vollbereich wäre also erfunden.
		-->
		<!--
			Die Live-Nadel der Intonation am Cursor, ueber der eigenen
			Zeile, wo sie sich zuordnen laesst: -50 … +50 Cent, links zu tief,
			rechts zu hoch. Ueber dem Notenbild, aber klein - sie soll neben
			den Noten stehen, nicht auf ihnen.
		-->
		<div
			v-if="needleStyle"
			class="score-page-needle"
			:class="`score-page-needle--${needle.cls}`"
			:style="needleStyle"
			role="status"
			:aria-label="needleLabel">
			<span class="score-page-needle-track" aria-hidden="true">
				<span v-if="needle.cents !== null" class="score-page-needle-pointer" :style="{ left: needlePercent + '%' }" />
			</span>
			<span class="score-page-needle-text">{{ needleText }}</span>
		</div>
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
import NcButton from '@nextcloud/vue/components/NcButton'
import ScoreDrawings from './ScoreDrawings.vue'
import ScoreStamps from './ScoreStamps.vue'
import { translate } from '../l10n.js'
import { placeCountLabels } from '../lib/countLayout.js'
import { formatCents } from '../lib/intonation.js'
import { createLru } from '../lib/lruCache.js'
import { placeNoteLabels } from '../lib/noteLabelLayout.js'
import { nameOf } from '../lib/noteNames.js'
import { hitNotehead, matchNoteheads } from '../lib/noteSpellingIndex.js'
import { BASE_PAGE_WIDTH_PX, parseSvgSizeMm, parseViewBox } from '../lib/scoreLayout.js'
import { canMapStavesToParts, findStaffBands, groupBandsIntoSystems, stavesOfPart } from '../lib/staffBands.js'
import { buildNoteIndex, buildSegmentIndex, pickNoteheads, setHighlight } from '../lib/svgIndex.js'
import { sanitizeSvgPage } from '../lib/svgSanitizer.js'
import { yieldToMain } from '../lib/yieldToMain.js'
import { createScoreFrame } from './scorePageFrame.js'

// Sanitized pages, shared by all ScorePages. Page URLs carry the conversion
// version (`?v=`), so an entry never goes stale. A few pages are enough: the
// system band mounts several frames of the same page and re-mounts them when
// they scroll back into reach (SystemBand.vue), and the page view unloads a
// page 2,400 px away and loads it again on the way back. Each entry holds
// the text and the parsed nodes (lib/svgSanitizer.js#sanitizeSvgPage).
const svgCache = createLru(6)

// Wie weit der Zeiger zwischen pointerdown und click wandern darf, damit es
// noch als Klick gilt. Grosszuegig genug fuer das Zittern eines
// Fingers auf Glas, klein genug, dass ein bewusstes Wischen nicht mehr
// hineinfaellt.
const CLICK_MOVE_TOLERANCE_PX = 8

// Cursor bands of a page the cursor is not on (see cursorRects()).
const NO_CURSOR_RECTS = Object.freeze([])

// Abstand zum Sichtbereich, ab dem eine Seite geladen (LOAD) bzw. wieder
// freigegeben wird (UNLOAD). Der Unterschied ist
// Absicht: laden knapp vorher, entladen erst deutlich weiter weg. Waeren
// beide gleich, laege die Seite genau an der Grenze im Wechsel zwischen
// geladen und entladen - und jedes Nachladen ist ein HTTP-Abruf samt
// Sanitizer-Durchlauf.
const LOAD_MARGIN_PX = 600
const UNLOAD_MARGIN_PX = 2400

// Was ein Tonname nicht verdecken soll (siehe obstacles()). Wiederholungs-
// punkte zeichnet MuseScore als Teil der BarLine.
const LABEL_OBSTACLES = 'Accidental BarLine NoteDot Stem Hook Rest Clef KeySig TimeSig Articulation Fermata Dynamic Lyrics Tuplet'
	.split(' ').map((c) => `.${c}`).join(',')

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

	components: { NcButton, ScoreDrawings, ScoreStamps },

	// The element the pages scroll in. The load/unload margins of the
	// observers below only widen their ROOT; without one the root is the
	// viewport, and a page clipped by the scrolling container counted as
	// gone the moment it left the container - measured: 12 reloads (fetch,
	// sanitizer, index) while scrolling just +-1500 px back and forth.
	inject: {
		scrollRoot: { from: 'scoreviewScrollRoot', default: () => () => null },
	},

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

		// Stempel aus useAnnotations (stamps), aller Seiten - gefiltert und
		// gesetzt wird hier bzw. in ScoreStamps.vue, weil erst die Seite ihre
		// Notenzeilen kennt.
		stamps: {
			type: Array,
			default: () => [],
		},

		// Freehand drawings (E22) of all pages from useAnnotations - placed
		// here, because only the page knows its staves.
		drawings: {
			type: Array,
			default: () => [],
		},

		// The pen is down (E22): pointer input on the page draws.
		drawMode: {
			type: Boolean,
			default: false,
		},

		// Strokes drawn but not yet saved, of all pages: {page, points}.
		pendingStrokes: {
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

		// Wie die klingende Stelle markiert wird: 'notes' faerbt die
		// Notenkoepfe selbst (M10), 'bar' zeigt das Band. Siehe
		// lib/highlightStyle.js - die Farbe kommt getrennt davon ueber
		// CSS-Variablen, die der Viewer an seine Wurzel haengt.
		highlightMode: {
			type: String,
			default: 'notes',
		},

		// 'light' oder 'dark' (lib/noteTheme.js resolveNoteTheme). Die Farben
		// selbst kommen als CSS-Variablen vom Viewer; hier haengt nur die
		// Klasse, an der die Umfaerbe-Regeln greifen.
		noteTheme: {
			type: String,
			default: 'light',
		},

		// The notation's colours as CSS custom properties (`--scoreview-ink`,
		// `--scoreview-highlight`, ...; lib/noteTheme.js). They no longer
		// inherit from the viewer: the SVG sits in a document of its own
		// (scorePageFrame.js), so they are copied onto it.
		svgVars: {
			type: Object,
			default: null,
		},

		// Intonation: Notenkoepfe, die dreifarbig markiert werden -
		// {elid, staff, rank, size, cls} aus lib/intonation.js noteMarks().
		// Wirkt nur, wo das SVG `st-` traegt (M10).
		noteMarks: {
			type: Array,
			default: () => [],
		},

		// Dasselbe fuer die Live-Nadel, getrennt von `noteMarks`: Sie wechselt
		// mit jedem Rahmen, die Auswertung einer Aufnahme dagegen nie. In einer
		// gemeinsamen Liste faerbte jeder Rahmen alle ausgewerteten Noten
		// jeder geladenen Seite neu, samt Layoutabfrage je Notenkopf.
		liveNoteMarks: {
			type: Array,
			default: () => [],
		},

		// Die Live-Nadel: {cents, cls} oder null.
		needle: {
			type: Object,
			default: null,
		},

		// Tonhoehe und Schreibweise je Notenkopf (`noteSpellings`, E15), als
		// Map aus lib/noteSpellingIndex.js - oder null, wenn die Artefakte
		// sie nicht tragen. Grundlage fuer Tonnamen und „Note antippen".
		spellings: {
			type: Map,
			default: null,
		},

		// Tonnamen anzeigen: 'de' | 'en' | 'solfa-fixed' | 'solfa-movable',
		// null = aus (H3).
		noteNameSystem: {
			type: String,
			default: null,
		},

		// Nur diese Notenzeilen beschriften (die eigene Stimme), null = alle.
		noteNameStaves: {
			type: Array,
			default: null,
		},

		// Vorzeichen an einem Segment, fuer das bewegliche Do.
		keyOfElid: {
			type: Function,
			default: () => 0,
		},

		// Beat numbers (B1): the count of every chord by elid
		// (lib/countLabels.js), or null = off. Placed here, above the staff,
		// because only the page knows its noteheads and staves.
		countOfElid: {
			type: Map,
			default: null,
		},

		// Only these staves get beat numbers (the own part), null = all.
		countStaves: {
			type: Array,
			default: null,
		},

		// Focus on the loop (B4): the measure runs of this page that lie
		// outside the loop, as rectangles in page units (lib/loopFocus.js) -
		// dimmed, not removed, the page image stays (E2).
		loopDimRects: {
			type: Array,
			default: () => [],
		},

		// A sheet for the print page (E16): loaded at once, never unloaded,
		// no cursor and no pointer handling. Everything placed on the page -
		// markers, note texts, stamps, note names - stays the same code as
		// on screen; that is the point of reusing this component.
		printSheet: {
			type: Boolean,
			default: false,
		},
	},

	emits: ['noteClick', 'markerClick', 'loaded', 'staffMapping', 'indexed', 'stroke'],

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
			// Die Tonnamen dieser Seite: {key, left, top, size, text}, die
			// linke obere Ecke in Prozent der Seite. Einmal je Seite und Einstellung berechnet,
			// nicht je Rahmen (die Arbeit aus 1.10.2 bleibt so erhalten).
			noteLabels: [],
			// The beat numbers of this page: {key, x, y, size, text} in SVG
			// units (lib/countLayout.js) - drawn as SVG text, so playback
			// never touches a style attribute for them.
			countLabels: [],
			// Der Name des zuletzt angetippten Kopfs, kurz eingeblendet (D13).
			tapBubble: null,
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
		/**
		 * Wo die Nadel steht: an der x-Position des Cursors, ueber der eigenen
		 * Zeile im aktuellen System - sonst ueber dem Cursor-Rechteck.
		 */
		needleStyle() {
			const rect = this.cursorRect
			const box = this.viewBox
			if (!this.needle || !rect || !box || rect.page !== this.pageIndex) {
				return null
			}
			let top = rect.y
			if (this.partsMappable) {
				const system = this.staffSystems.find((s) => rect.y < s.bottom + 1 && rect.y + rect.h > s.top - 1)
				const band = system?.staves[this.myPartIndex]
				if (band) {
					top = band.top - (band.bottom - band.top) * 1.6
				}
			}
			return {
				left: `${((rect.x - box.minX) / box.width) * 100}%`,
				top: `${((top - box.minY) / box.height) * 100}%`,
			}
		},

		needlePercent() {
			const c = Math.max(-50, Math.min(50, this.needle?.cents ?? 0))
			return 50 + c
		},

		needleText() {
			if (!this.needle || this.needle.cls === 'rest') {
				return '–'
			}
			return this.needle.cents === null ? '?' : formatCents(this.needle.cents)
		},

		needleLabel() {
			if (!this.needle || this.needle.cls === 'rest') {
				return this.t('Rest')
			}
			if (this.needle.cents === null) {
				return this.t('Not evaluable')
			}
			return this.t('{cents} cents', { cents: formatCents(this.needle.cents) })
		},

		/** Die viewBox der Seite fuer die Cursor-Ebene. */
		viewBoxAttr() {
			const box = this.viewBox
			return box ? `${box.minX} ${box.minY} ${box.width} ${box.height}` : '0 0 1 1'
		},

		/**
		 * Der Cursor in Seitenkoordinaten - ein Band je Notenzeile des Systems,
		 * damit er die Zeilen trifft und nicht die Zwischenraeume.
		 *
		 * @return {Array<{x: number, y: number, w: number, h: number}>}
		 */
		cursorRects() {
			const rect = this.cursorRect
			const box = this.viewBox
			if (!rect || !box || rect.page !== this.pageIndex) {
				// The same frozen array every time: a fresh [] counts as a
				// change and would re-render the page for nothing.
				return NO_CURSOR_RECTS
			}
			const system = this.staffSystems.find((s) => rect.y < s.bottom + 1 && rect.y + rect.h > s.top - 1)
			if (!system) {
				return [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h }]
			}
			// Etwas ueber die aeusseren Notenlinien hinaus, damit Noten in
			// Hilfslinien noch im Band liegen.
			const luft = (system.staves[0].bottom - system.staves[0].top) / 4
			return system.staves.map((band) => ({
				x: rect.x,
				y: band.top - luft,
				w: rect.w,
				h: band.bottom - band.top + 2 * luft,
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
					dimmed: m.dimmed === true,
					voices: m.voices ?? [],
					style: {
						left: `${((m.x - box.minX) / box.width) * 100}%`,
						top: `${((m.y - box.minY) / box.height) * 100}%`,
					},
				}))
		},

		pageStamps() {
			return this.stamps.filter((s) => s.page === this.pageIndex)
		},

		pageDrawings() {
			return this.drawings.filter((d) => d.page === this.pageIndex)
		},

		pagePendingStrokes() {
			return this.pendingStrokes.filter((s) => s.page === this.pageIndex).map((s) => s.points)
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
						dimmed: m.dimmed === true,
						voices: m.voices ?? [],
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

		// Umschalten waehrend der Wiedergabe: ohne das bliebe die zuletzt
		// gefaerbte Note stehen, bis der naechste Wiedergabeschritt kommt -
		// beim Pausieren also fuer immer.
		highlightMode() {
			this.applyHighlight()
		},

		noteMarks() {
			this.applyNoteMarks()
		},

		liveNoteMarks() {
			this.applyLiveNoteMarks()
		},

		spellings() {
			this.indexSpellings()
		},

		noteNameSystem() {
			this.updateNoteLabels()
		},

		noteNameStaves() {
			this.updateNoteLabels()
		},

		countOfElid() {
			this.updateCountLabels()
		},

		countStaves() {
			this.updateCountLabels()
		},

		zoom() {
			// Die Schriftgroesse der Tonnamen folgt dem Notenbild.
			this.updateNoteLabels()
		},

		noteTheme() {
			this.applyNoteTheme()
		},

		svgVars() {
			this.frame?.setVars(this.svgVars)
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
		// Dasselbe fuer die Intonation: Karte `elid:staff` -> Notenkoepfe
		// und die gerade gefaerbten Knoten mit ihrer Klasse.
		this.noteIndex = null
		this.marked = []
		this.liveMarked = []
		// Notenkoepfe mit Tonhoehe und Schreibweise (lib/noteSpellingIndex.js)
		// - DOM-Knoten, also ebenfalls nicht reaktiv. Gemessen erst bei
		// Bedarf (measuredNoteItems()), `noteItemsMeasured` sagt, ob schon.
		this.noteItems = []
		this.noteItemsMeasured = false
		// Hindernisse fuer die Tonnamen, gemessen beim ersten Bedarf.
		this.labelObstacles = null
		this.tapTimer = null
		// The frame with the page SVG and the element in it that holds the
		// SVG (see the template and attachSvgRoot()) - DOM nodes, so not in
		// data(). `svgSource` is the sanitized page as nodes, cloned in by
		// renderSvg().
		this.frame = null
		this.svgRoot = null
		this.svgSource = null
	},

	mounted() {
		this.attachSvgRoot()
		if (this.printSheet) {
			// A sheet is printed whole or not at all: no observers, the page
			// loads now and stays.
			this.load()
			return
		}
		// Zwei Beobachter mit unterschiedlichem Rand: laden knapp vor dem
		// Sichtbarwerden, entladen erst deutlich weiter weg. Ein einzelner
		// Beobachter kann nur EINEN rootMargin haben, und mit nur einem waere
		// die Seite an der Grenze abwechselnd geladen und entladen worden.
		// The margins apply on all four sides: the system band (SystemBand.vue)
		// scrolls sideways, and with no horizontal margin the next system only
		// started loading once its frame was already on screen - it stayed
		// white for the whole fetch and sanitize.
		this.loadObserver = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) {
				this.load()
			}
		}, { root: this.scrollRoot(), rootMargin: `${LOAD_MARGIN_PX}px` })
		this.loadObserver.observe(this.$refs.root)

		this.unloadObserver = new IntersectionObserver((entries) => {
			if (entries.every((e) => !e.isIntersecting)) {
				this.unload()
			}
		}, { root: this.scrollRoot(), rootMargin: `${UNLOAD_MARGIN_PX}px` })
		this.unloadObserver.observe(this.$refs.root)
	},

	beforeUnmount() {
		this.loadObserver?.disconnect()
		this.unloadObserver?.disconnect()
		clearTimeout(this.tapTimer)
		this.frame?.destroy()
		this.frame = null
		this.svgRoot = null
	},

	methods: {
		/**
		 * Notenkoepfe dieser Seite mit Tonhoehe und Schreibweise verbinden
		 * (E15). Only marks the list as stale: the boxes are measured when
		 * something needs them (measuredNoteItems()).
		 */
		indexSpellings() {
			this.labelObstacles = null
			this.noteItems = []
			this.noteItemsMeasured = false
			this.updateNoteLabels()
			this.updateCountLabels()
		},

		/**
		 * The noteheads with their boxes, measured on first use. getBBox() on
		 * every head of a page is the dearest step of loading one - measured
		 * at 4x CPU throttling: about 790 ms for three pages - and only note
		 * names, beat counts and tapping a note use the boxes. Without those,
		 * a page never pays for it.
		 *
		 * @return {Array<object>}
		 */
		measuredNoteItems() {
			if (this.noteItemsMeasured) {
				return this.noteItems
			}
			this.noteItemsMeasured = true
			this.noteItems = []
			if (this.spellings && this.noteIndex) {
				this.noteItems = matchNoteheads(this.noteIndex, this.spellings).map((item) => {
					let box = null
					try {
						const b = item.node.getBBox()
						box = { x: b.x, y: b.y, width: b.width, height: b.height }
					} catch {
						// Ein Knoten ohne Layout (ausgeblendet) bleibt ohne Box.
					}
					return { ...item, box }
				}).filter((item) => item.box !== null)
			}
			return this.noteItems
		},

		updateCountLabels() {
			this.countLabels = this.viewBox && this.countOfElid?.size > 0
				? placeCountLabels(this.measuredNoteItems(), this.staffSystems, this.countOfElid, this.countStaves)
				: []
		},

		updateNoteLabels() {
			const box = this.viewBox
			if (!this.noteNameSystem || !box || this.measuredNoteItems().length === 0) {
				this.noteLabels = []
				return
			}
			const staves = this.noteNameStaves ? new Set(this.noteNameStaves) : null
			// Schriftgroesse aus der Kopfhoehe: deutlich groesser als ein
			// Notenkopf, damit sie am Notenstaender lesbar bleibt; wo es dafuer
			// zu eng ist, weicht der Name aus (lib/noteLabelLayout.js). Die
			// Untergrenze bleibt klein: Bei Seitenbreite am Telefon sind die
			// Koepfe nur 4 px hoch, groessere Namen deckten dort alles zu.
			const pxPerUnit = (BASE_PAGE_WIDTH_PX * this.zoom) / box.width
			const items = this.noteItems
				.map((item, id) => ({ item, id }))
				.filter(({ item }) => staves === null || staves.has(item.staff))
				.map(({ item, id }) => ({
					key: `${item.elid}:${item.staff}:${item.voice}:${id}`,
					id,
					head: item.box,
					sizePx: Math.round(Math.max(9, Math.min(24, item.box.height * pxPerUnit * 1.4))),
					text: nameOf({ tpc: item.tpc, system: this.noteNameSystem, concertKey: this.keyOfElid(item.elid) }),
				}))
			this.noteLabels = placeNoteLabels(items, this.obstacles(), pxPerUnit).map((label) => ({
				key: label.key,
				text: label.text,
				size: label.sizePx,
				lineHeight: label.box.height * pxPerUnit,
				// Die Breite ist geschaetzt - zum Kopf hin buendig, damit eine
				// Abweichung nach aussen geht und nicht auf den Kopf.
				width: label.box.width * pxPerUnit,
				align: { left: 'right', right: 'left' }[label.side] ?? 'center',
				left: ((label.box.x - box.minX) / box.width) * 100,
				top: ((label.box.y - box.minY) / box.height) * 100,
			}))
		},

		/**
		 * Was ein Tonname nicht verdecken soll, einmal je Seite gemessen und
		 * erst, wenn Tonnamen gebraucht werden: die Koepfe selbst und alles,
		 * was links, ueber oder unter ihnen stehen kann. Notenlinien und
		 * Hilfslinien nicht - ueber ihnen steht ein Name zwangslaeufig.
		 *
		 * @return {Array<{box: object, id: number}>}
		 */
		obstacles() {
			if (this.labelObstacles) {
				return this.labelObstacles
			}
			const out = this.measuredNoteItems().map((item, id) => ({ box: item.box, id }))
			for (const node of this.svgRoot?.querySelectorAll(LABEL_OBSTACLES) ?? []) {
				try {
					const b = node.getBBox()
					if (b.width > 0 || b.height > 0) {
						out.push({ box: { x: b.x, y: b.y, width: b.width, height: b.height }, id: -1 })
					}
				} catch {
					// Ohne Layout kein Hindernis.
				}
			}
			this.labelObstacles = out
			return out
		},

		/**
		 * Der angetippte Notenkopf, falls einer getroffen wurde - fuer
		 * „Note antippen = Ton hoeren" (D13).
		 *
		 * @param {number} x SVG-Einheiten
		 * @param {number} y SVG-Einheiten
		 * @return {?{pitch: number, tpc: number, elid: number, left: number, top: number}}
		 */
		hitNote(x, y) {
			const items = this.measuredNoteItems()
			if (items.length === 0 || !this.viewBox) {
				return null
			}
			const height = items[0].box.height
			const hit = hitNotehead(items, x, y, height * 0.8)
			if (!hit) {
				return null
			}
			const box = this.viewBox
			return {
				pitch: hit.pitch,
				tpc: hit.tpc,
				elid: hit.elid,
				left: ((hit.box.x + hit.box.width / 2 - box.minX) / box.width) * 100,
				top: ((hit.box.y - box.minY) / box.height) * 100,
			}
		},

		/**
		 * Den Namen eines angetippten Kopfs kurz zeigen.
		 *
		 * @param {{left: number, top: number}} at
		 * @param {string} text
		 */
		showTapName(at, text) {
			clearTimeout(this.tapTimer)
			this.tapBubble = { left: at.left, top: at.top, text }
			this.tapTimer = setTimeout(() => {
				this.tapBubble = null
			}, 1500)
		},

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
				const key = `${this.svgUrl}|${this.pageIndex}`
				let page = svgCache.get(key)
				if (!page) {
					const res = await axios.get(this.svgUrl, { responseType: 'text' })
					// Der Praefix macht die Glyph-Kennungen dieser Seite im
					// Dokument eindeutig - ohne ihn greift die zweite Seite auf
					// die Glyphen der ersten zu, solange beide geladen sind
					// (siehe namespaceIds()).
					const { markup, source } = sanitizeSvgPage(res.data, `p${this.pageIndex}-`)
					page = {
						viewBox: parseViewBox(res.data),
						sizeMm: parseSvgSizeMm(res.data),
						markup,
						source,
					}
					svgCache.set(key, page)
					// Sanitizing was one long stretch; a tap or a frame goes
					// first before the page is put in.
					await yieldToMain()
					if (!this.svgRoot) {
						return
					}
				}
				this.viewBox = page.viewBox
				this.sizeMm = page.sizeMm
				this.svgMarkup = page.markup
				this.svgSource = page.source
				this.renderSvg()
				// Für die Zoom-Presets ("Seitenbreite/ganze Seite/100%") -
				// ScoreViewer.vue kennt die Seitengeometrie selbst nicht, nur die
				// jeweils geladene ScorePage.
				this.$emit('loaded', { index: this.pageIndex, viewBox: this.viewBox, sizeMm: this.sizeMm })
				// Erst jetzt steht das SVG - vorher gaebe es keine Notenlinien
				// zu zaehlen.
				// A page without a single staff (title page, text page) has
				// nothing to say about the mapping. Its "no" would override
				// the music pages, and the page that happened to load last
				// would decide whether "my part" can be marked at all.
				if (this.staffSystems.length > 0) {
					this.$emit('staffMapping', this.staffMappingPossible)
				}
				// The SVG is in the document now. Indexing it is the next long
				// stretch, so the main thread is given back first; the overlays
				// have rendered by then. If the page was unloaded meanwhile,
				// there is nothing to index.
				await yieldToMain()
				if (this.svgMarkup === page.markup && this.svgRoot) {
					this.indexSegments()
				}
			} catch (err) {
				this.loadError = err.response?.status
					? `HTTP ${err.response.status}`
					: err.message
			} finally {
				this.loading = false
			}
		},

		/**
		 * The frame for the notation (see the template for why) with its own
		 * style sheet - neither the page's scoped CSS nor its custom
		 * properties reach in, the colours come through `svgVars`.
		 */
		attachSvgRoot() {
			this.frame = createScoreFrame(this.$refs.svgHost, {
				title: this.t('Score page {n}', { n: this.pageIndex + 1 }),
				onReset: () => {
					this.svgRoot = this.frame.root
					this.applyNoteTheme()
					this.renderSvg()
					if (this.svgMarkup) {
						this.indexSegments()
					}
				},
			})
			this.svgRoot = this.frame.root
			this.frame.setVars(this.svgVars)
			this.applyNoteTheme()
		},

		applyNoteTheme() {
			this.svgRoot?.classList.toggle('dark', this.noteTheme === 'dark')
		},

		/**
		 * Puts the page SVG into the frame, or empties it.
		 *
		 * This is the one place the notation enters a document. The source is
		 * a user upload - MuseScore renders title, lyrics and free text from
		 * the score into it - so what goes in has ALWAYS been through
		 * lib/svgSanitizer.js (DOMPurify), never raw response text: see load().
		 * The sanitized nodes are cloned in (`svgSource`); the sanitized text is
		 * parsed only where no nodes are kept. If that rule is ever relaxed,
		 * this method must stand out again.
		 */
		renderSvg() {
			if (!this.svgRoot) {
				return
			}
			if (this.svgMarkup && this.svgSource) {
				const copy = this.svgRoot.ownerDocument.importNode(this.svgSource, true)
				this.svgRoot.replaceChildren(...copy.childNodes)
			} else if (this.svgMarkup) {
				this.svgRoot.innerHTML = this.svgMarkup
			} else {
				this.svgRoot.replaceChildren()
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
			this.segmentIndex = buildSegmentIndex(this.svgRoot)
			this.highlighted = []
			this.noteIndex = buildNoteIndex(this.svgRoot)
			this.marked = []
			this.liveMarked = []
			this.indexSpellings()
			// Ob das SVG Kennungen traegt (M10) - eine Faehigkeit der Artefakte,
			// nach der der Viewer Liedtext und Tonnamen anbietet (E15).
			this.$emit('indexed', { segIds: (this.segmentIndex?.size ?? 0) > 0 })
			// Die Seite kann mitten in der Wiedergabe nachgeladen worden sein.
			this.applyHighlight()
			this.applyNoteMarks()
			this.applyLiveNoteMarks()
		},

		/**
		 * Die Intonation in die Notenkoepfe: alte Klassen ab, neue an.
		 * Eine Markierung, deren Segment nicht auf dieser Seite steht, findet
		 * hier schlicht keinen Knoten.
		 */
		applyNoteMarks() {
			this.marked = this.replaceMarks(this.marked, this.noteMarks, this.liveMarked)
		},

		/** Die Live-Nadel in den Notenkopf - hoechstens eine Note je Rahmen. */
		applyLiveNoteMarks() {
			this.liveMarked = this.replaceMarks(this.liveMarked, this.liveNoteMarks, this.marked)
		},

		/**
		 * Nimmt die Klassen aus `previous` ab und setzt die aus `marks`.
		 * `keep` sind die Markierungen der anderen Quelle: Traegt ein Knoten
		 * dieselbe Klasse auch von dort, bleibt sie stehen - sonst loeschte der
		 * naechste Live-Rahmen die Farbe einer ausgewerteten Note.
		 *
		 * @param {Array<{node: Element, cls: string}>} previous
		 * @param {Array} marks
		 * @param {Array<{node: Element, cls: string}>} keep
		 * @return {Array<{node: Element, cls: string}>}
		 */
		replaceMarks(previous, marks, keep) {
			for (const { node, cls } of previous) {
				if (!keep.some((k) => k.node === node && k.cls === cls)) {
					node.classList?.remove(cls)
				}
			}
			const next = []
			if (!this.noteIndex || this.noteIndex.size === 0) {
				return next
			}
			const yOf = (node) => node.getBoundingClientRect?.().top ?? 0
			for (const mark of marks) {
				const nodes = pickNoteheads(this.noteIndex.get(`${mark.elid}:${mark.staff}`), mark.rank, mark.size, yOf)
				const cls = `scoreview-intonation-${mark.cls}`
				for (const node of nodes) {
					node.classList?.add(cls)
					next.push({ node, cls })
				}
			}
			return next
		},

		/** Haengt die Hervorhebung auf das gerade klingende Segment um. */
		applyHighlight() {
			if (!this.segmentIndex) {
				return
			}
			// Nur die Seite, auf der der Cursor steht, faerbt - dieselbe elid
			// kann bei einer Wiederholung (M7) sonst auf zwei Seiten leuchten.
			// Im Band-Modus faerbt gar nichts: dann uebernimmt das Overlay,
			// und `notesHighlighted` bleibt falsch, womit es sichtbar wird
			// (siehe .score-page-cursor--hidden).
			const aufDieserSeite = this.highlightMode === 'notes' && this.cursorRect?.page === this.pageIndex
			const aktiv = aufDieserSeite ? this.cursorElid : null
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
			if (!this.svgMarkup || this.printSheet) {
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
			this.svgSource = null
			this.renderSvg()
			// Die Karte zeigt auf Knoten, die es gleich nicht mehr gibt.
			this.segmentIndex = null
			this.highlighted = []
			this.notesHighlighted = false
			this.noteIndex = null
			this.marked = []
			this.liveMarked = []
			this.noteItems = []
			this.noteItemsMeasured = false
			this.noteLabels = []
			this.countLabels = []
			this.labelObstacles = null
		},

		// Umkehrung von M4 (Koordinate -> elid: "Klick auf eine Note springt
		// dorthin"): rechnet die Klickposition in SVG-Einheiten dieser Seite
		// um und reicht sie an ScoreViewer.vue weiter, die dort per
		// findElementAtPoint()/findNearestOccurrenceTimeMs() (scoreLayout.js)
		// aufgelöst wird - diese Komponente kennt die Notenkoordinaten selbst
		// nicht (nur ihre eigene viewBox).
		onPointerDown(event) {
			if (this.printSheet) {
				return
			}
			this.pointerDownAt = { x: event.clientX, y: event.clientY }
		},

		/**
		 * A finished stroke, with what the page alone knows: its staves and
		 * whether they map to parts - the anchor is computed from them when
		 * the drawing is saved (lib/drawingLayout.js encodeDrawing).
		 *
		 * @param {Array<{x:number, y:number}>} points
		 */
		onStroke(points) {
			this.$emit('stroke', {
				page: this.pageIndex,
				points,
				systems: this.staffSystems,
				mappable: this.staffMappingPossible,
			})
		},

		onClick(event) {
			if (!this.viewBox || this.printSheet || this.drawMode) {
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
			const x = this.viewBox.minX + fracX * this.viewBox.width
			const y = this.viewBox.minY + fracY * this.viewBox.height
			this.$emit('noteClick', {
				page: this.pageIndex,
				x,
				y,
				// Der getroffene Kopf mit Tonhoehe, wenn die Artefakte sie tragen
				// - der Viewer spielt ihn an (D13).
				note: this.hitNote(x, y),
			})
		},

		/**
		 * Where the cursor stands on this page, as fractions of the page box -
		 * for the autoscroll (useAutoScroll.js), which places it with the
		 * page boxes it keeps. Computed from the cursor bands and the viewBox,
		 * which the cursor layer maps exactly onto the page (inset 0,
		 * preserveAspectRatio none): no DOM read, so no forced layout per note
		 * change. The hull over all bands, not the first: autoscroll keeps the
		 * whole system in view, otherwise the lower staves ran off the bottom
		 * edge. null while this page shows no cursor (see cursorRects).
		 *
		 * @return {?{top:number,left:number,width:number,height:number}}
		 */
		getCursorBox() {
			const box = this.viewBox
			const bands = this.cursorRects
			if (!box || bands.length === 0) {
				return null
			}
			const top = Math.min(...bands.map((b) => b.y))
			const bottom = Math.max(...bands.map((b) => b.y + b.h))
			const left = Math.min(...bands.map((b) => b.x))
			const right = Math.max(...bands.map((b) => b.x + b.w))
			return {
				top: (top - box.minY) / box.height,
				left: (left - box.minX) / box.width,
				width: (right - left) / box.width,
				height: (bottom - top) / box.height,
			}
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
	/* Das Papier - im Dunkelmodus der dunkle Grund (lib/noteTheme.js). */
	background: var(--scoreview-page, #fff);
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
	cursor: pointer;
}

/* A printed sheet: nothing to click, nothing between the sheets. */
.score-page--static {
	margin: 0;
	box-shadow: none;
	cursor: default;
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
	/*
	 * A compositor layer of its own. During playback the cursor, the seek
	 * slider and the progress line repaint every frame; sharing a layer with
	 * the notation, each frame re-layerized all its paint chunks - 8,100 of
	 * 14,100 SVG elements carry a transform. Measured during playback:
	 * main thread 490-560 ms/s, with the layer 177 ms/s. Opacity rather
	 * than transform, which measured the same but lets Chrome keep the
	 * layer's raster scale - the notation could stay blurry after a zoom.
	 */
	will-change: opacity;
}

/*
 * The frame with the notation (scorePageFrame.js) covers the page. No
 * pointer events: clicks, taps, pinches and the wheel belong to the page
 * element behind it. `color-scheme` must equal the one inside the frame,
 * otherwise Chrome paints an opaque backdrop over the cursor and the page
 * colour.
 */
.score-page-svg :deep(.score-page-frame) {
	position: absolute;
	inset: 0;
	display: block;
	width: 100%;
	height: 100%;
	border: 0;
	background: transparent;
	color-scheme: normal;
	pointer-events: none;
}

/* Printing composites nothing, and a sheet layer per page buys nothing. */
.score-page--static .score-page-svg {
	will-change: auto;
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
 * den Untergrund der klingenden Noten ein, statt sie zu ueberdecken. Eine
 * weiche Flaeche mit leichter Rundung, kein Rahmen: Der Rahmen der frueheren
 * Fassung zog auf jeder Zeile eine zweite Linie ins Bild und konkurrierte mit
 * den Notenlinien. Weil er nichts verdeckt, darf er kraeftig sein - die
 * fruehere Deckkraft war auf einem hellen Tabletbildschirm kaum noch zu
 * sehen (Nutzerrueckmeldung).
 */
/* Liegt wie zuvor das Cursor-Band hinter dem Notenbild: absolut
   positioniert ohne z-index, das Notenbild hat z-index 1 (.score-page-svg). */
.score-page-cursor-layer {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
	overflow: visible;
}

.score-page-cursor {
	/* Farbe und Deckkraft kommen aus der Nutzereinstellung (siehe
	   lib/highlightStyle.js); der Rueckfallwert traegt nur, solange die
	   Variable noch nicht gesetzt ist. Kein Uebergang: Geometrie-Attribute
	   gleiten nicht per CSS, und ein Gleiten ueber den Stil kostete genau die
	   Neuberechnung, die die SVG-Ebene vermeidet. */
	fill: var(--scoreview-highlight-band, rgba(211, 47, 47, 0.32));
}

/*
 * Leuchten die Notenkoepfe selbst (M10), malt das Band nichts mehr - eine
 * Anzeige der klingenden Stelle genuegt. Genau das ist der Umschalter:
 * `highlightMode` entscheidet, ob ueberhaupt eingefaerbt wird, und damit,
 * welche der beiden Anzeigen uebrig bleibt. Ausgeblendet wird durch die
 * Fuellung, nicht durch display:none oder v-if: Das Band behaelt so seine
 * Groesse und seinen Platz in der Stapelfolge.
 */
.score-page-cursor--hidden {
	fill: transparent;
}

.score-page-note-name {
	/* Linke obere Ecke und Zeilenhoehe kommen aus lib/noteLabelLayout.js,
	   das den Platz neben dem Kopf schon gewaehlt hat. */
	position: absolute;
	pointer-events: none;
	font-weight: 600;
	white-space: nowrap;
	color: var(--color-primary-element, #00679e);
	text-shadow: 0 0 2px var(--color-main-background, #fff), 0 0 2px var(--color-main-background, #fff);
}

.score-page-tap-bubble {
	position: absolute;
	transform: translate(-50%, calc(-100% - 6px));
	pointer-events: none;
	padding: 2px 8px;
	border-radius: var(--border-radius-large, 10px);
	background: var(--color-primary-element, #00679e);
	color: var(--color-primary-element-text, #fff);
	font-weight: 600;
	font-size: 16px;
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}

.score-page-needle {
	position: absolute;
	z-index: 4;
	display: flex;
	flex-direction: column;
	align-items: center;
	inline-size: 64px;
	padding: 2px 4px;
	border-radius: var(--border-radius, 4px);
	background: var(--color-main-background);
	box-shadow: 0 0 4px var(--color-box-shadow, rgba(0, 0, 0, 0.3));
	font-size: 12px;
	font-weight: bold;
	pointer-events: none;
	transform: translate(-50%, -100%);
}

.score-page-needle-track {
	position: relative;
	inline-size: 100%;
	block-size: 6px;
	border-radius: 3px;
	background: linear-gradient(to right, #d32f2f 0 25%, #2e7d32 25% 75%, #d32f2f 75% 100%);
}

.score-page-needle-pointer {
	position: absolute;
	inset-block: -3px;
	inline-size: 3px;
	background: var(--color-main-text);
	transform: translateX(-50%);
}

.score-page-needle--green .score-page-needle-text {
	color: #2e7d32;
}

.score-page-needle--yellow .score-page-needle-text {
	color: #b26a00;
}

.score-page-needle--red .score-page-needle-text {
	color: #d32f2f;
}

.score-page-needle--na .score-page-needle-text,
.score-page-needle--rest .score-page-needle-text {
	color: var(--color-text-maxcontrast);
}

/*
 * „Meine Stimme": ein durchgehender, blasser Streifen unter der eigenen
 * Notenzeile - das digitale Gegenstueck zum Buntstiftstrich, mit dem
 * Singende ihre Zeile markieren. Bewusst blass: Er soll beim Blaettern ins
 * Auge fallen, aber beim Lesen der Noten nicht mithalten.
 */
.score-page-mystaff {
	position: absolute;
	/* Im Dunkeln etwas kraeftiger, sonst verschwaende er im Grund (lib/noteTheme.js). */
	background: var(--scoreview-mystaff, rgba(255, 193, 7, 0.18));
	border-inline-start: 3px solid var(--scoreview-mystaff-edge, rgba(255, 152, 0, 0.75));
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
	/* Die Farbe des Papiers, nicht der Oberflaeche: Im Dunkelmodus der Noten
	   bei hellem Nextcloud-Theme laege sonst ein weisser Schleier auf dunklem
	   Grund. */
	background: var(--scoreview-page, var(--color-main-background, #fff));
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

.score-page-note--parts {
	background: var(--color-warning-hover, #fdefd4);
}

/* Stimmnotizen ohne gewaehlte Stimme: da, aber zurueckgenommen. */
.score-page-note--dimmed,
.score-page-marker--dimmed {
	opacity: 0.45;
}

/* Beat numbers: over the notation (z-index above .score-page-svg), never
   in the way of a tap. */
.score-page-count-layer {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
	overflow: visible;
	z-index: 2;
}

.score-page-count {
	fill: var(--scoreview-count, #1565c0);
	font-family: sans-serif;
	font-weight: bold;
}

/* The veil over measures outside the loop: paper colour, mostly opaque, so
   the notes there stay legible but step back. Above the notation and the
   numbers, below markers and stamps. */
.score-page-loopdim-layer {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
	overflow: visible;
	z-index: 2;
}

.score-page-loopdim {
	fill: var(--scoreview-page, #fff);
	fill-opacity: 0.7;
}

.score-page-loop-marker {
	position: absolute;
	width: 3px;
	pointer-events: none;
	z-index: 2;
}

.score-page-loop-marker--start {
	/* Eigene Farben je Notenmodus statt der Nextcloud-Statusfarben - warum,
	   steht in lib/noteTheme.js. */
	background: var(--scoreview-loop-start, #2e7d32);
	box-shadow: 2px 0 0 rgba(46, 125, 50, 0.3);
}

.score-page-loop-marker--end {
	background: var(--scoreview-loop-end, #c62828);
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
	/* Eigene Farbe je Notenmodus statt `--color-warning` - warum, steht in
	   lib/noteTheme.js. */
	background: var(--scoreview-marker, #bf7900);
	/* Der Rand in Papierfarbe hebt den Punkt von den Noten ab - auf dunklem
	   Grund waere ein weisser Ring heller als die Noten selbst. */
	border: 2px solid var(--scoreview-page, #fff);
	border-radius: 50%;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
	cursor: pointer;
	z-index: 2;
}

/*
 * Geteilte Notizen bekommen eine eigene Farbe ("eigene und geteilte
 * Notizen unterscheidbar, Markerfarbe") - bei Standard-Theme dieselbe
 * Primaerfarbe wie der linke Akzentbalken in ScoreAnnotations.vue, damit
 * Notenbild und Liste dieselbe Sprache sprechen.
 */
.score-page-marker--shared {
	/* Je Notenmodus, nicht die Primaerfarbe des Themes - warum, steht in
	   lib/noteTheme.js. */
	background: var(--scoreview-marker-shared, #00679e);
}

/* Stimmnotizen: die Farbe der Leitung, bei Standard-Theme dieselbe wie ihr
   Abzeichen in ScoreAnnotations.vue - hier aber an das Papier gebunden. */
.score-page-marker--parts {
	background: var(--scoreview-marker-parts, #664700);
}
</style>
