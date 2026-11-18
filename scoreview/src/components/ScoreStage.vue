<template>
	<!--
		Manuelles Scrollen wird an der GESTE erkannt, nicht an
		scroll-Ereignissen (Begruendung ausfuehrlich in
		useAutoScroll.js): Mobile Browser blenden ihre
		Adressleiste beim Scrollen ein und aus und erzeugen dabei
		scroll-Ereignisse, die von keinem Finger stammen - die
		fruehere Zeitfenster-Heuristik deutete daraufhin das
		eigene Nachfuehren als Nutzereingriff. Pointer- UND
		Touch-Ereignisse, weil eine Pinch-Geste (die
		preventDefault ruft) den Pointer-Strom abbrechen kann.
		`scrollend` kennt nicht jeder Browser; wo es fehlt, feuert
		es nie und die Frist laeuft wie zuvor ab dem Loslassen. Es
		feuert auch nach dem eigenen Nachfuehren - das zaehlt nicht
		als Eingriff (useAutoScroll.js#onScrollEnd).

		The element is the viewer's `scroll` (view.scrollRef): zoom, paging,
		autoscroll and the pages' load observers all measure against it.
	-->
	<div
		:ref="view.scrollRef"
		class="scoreview-scroll"
		:class="{ 'scoreview-scroll--band': display.activeLayout === 'band' }"
		@pointerdown.passive="autoScroller.onUserGestureStart"
		@pointerup.passive="autoScroller.onUserGestureEnd"
		@pointercancel.passive="autoScroller.onUserGestureEnd"
		@touchstart.passive="autoScroller.onUserGestureStart"
		@touchend.passive="autoScroller.onUserGestureEnd"
		@touchcancel.passive="autoScroller.onUserGestureEnd"
		@scrollend.passive="onViewerScrollEnd"
		@wheel="onViewerWheel">
		<!--
			Pinch-Zoom: eigene, zweifingrige Geste statt der nativen
			Browser-Seiten-Zoom (die waere fuer die ganze
			Nextcloud-Oberflaeche, nicht nur die Partitur) - siehe
			onTouchMove(), das den Browser-Zoom waehrend der Geste bewusst
			unterdrueckt (preventDefault). Einfingriges Scrollen bleibt
			unangetastet (kein preventDefault dafuer), "Wischen zum
			Blaettern" ist deshalb bewusst NICHT als zusaetzliche
			Horizontal-Geste umgesetzt: das vertikale Scrollen deckt das
			Blaettern in diesem fortlaufenden Einspaltenlayout bereits ab,
			eine eigene Wischgeste haette zudem mit Nextcloud Viewers
			eigener Wisch-zum-naechsten-Datei-Geste auf Mobilgeraeten
			kollidieren koennen.
		-->
		<ViewerHints :viewerWidth="viewerWidth" />
		<LyricsView
			v-if="display.activeLayout === 'lyrics' && session.timeline"
			ref="lyrics"
			:follow="followCursor"
			:syllables="session.pictureMeta?.lyricSyllables ?? []"
			:staves="view.myStaves"
			:partNames="lyricsPartNames"
			:timeline="session.timeline"
			:measureRectsByPage="session.systemRectsByPage"
			:focusKeys="loopFocusKeys"
			:readTimeMs="readDisplayTimeMs"
			:subscribeFrame="session.onFrame"
			:canSeek="performance.can('seek')"
			@seek="onLyricsSeek"
			@loop="onLyricsLoop"
			@cursorVisible="$emit('cursorVisible', $event)" />
		<!--
			The cursor, the sounding element and the intonation
			needle change with every note. Read in the template of the
			viewer, each change re-rendered all of it - toolbar,
			panels, a hundred t() calls. LiveValue reads them itself
			(readLive()), so a note change re-renders only the band or
			the page list.
		-->
		<LiveValue
			v-else-if="display.activeLayout === 'band'"
			v-slot="{ value: live }"
			:get="readLive">
			<SystemBand
				ref="band"
				:pageUrls="session.pageUrls"
				:systemRectsByPage="session.systemRectsByPage"
				:pageProps="sharedPageProps"
				:loopRects="loopMeasureRects"
				:loopDimRectsByPage="loopDimRectsByPage"
				:cursorRect="live.cursorRect"
				:cursorElid="live.cursorElid"
				:needle="live.needle"
				:liveNoteMarks="live.liveNoteMarks"
				:follow="followCursor"
				:forced="session.cursorForced"
				:zoom="bandZoom.zoom"
				@touchstart.passive="bandZoom.onTouchStart"
				@touchmove.passive="bandZoom.onTouchMove"
				@touchend.passive="bandZoom.onTouchEnd"
				@touchcancel.passive="bandZoom.onTouchEnd"
				@noteClick="onNoteClick"
				@markerClick="onMarkerClick"
				@indexed="onPageIndexed"
				@staffMapping="onStaffMapping"
				@cursorVisible="$emit('cursorVisible', $event)" />
		</LiveValue>
		<LiveValue
			v-else
			v-slot="{ value: live }"
			:get="readLive">
			<div
				class="scoreview-pages"
				:class="spreadClasses"
				@touchstart.passive="zoom.onTouchStart"
				@touchmove.passive="zoom.onTouchMove"
				@touchend.passive="zoom.onTouchEnd">
				<ScorePage
					v-for="(url, i) in session.pageUrls"
					:key="url"
					:ref="autoScroller.pageRef(i)"
					:svgUrl="url"
					:pageIndex="i"
					v-bind="sharedPageProps"
					:cursorRect="onCursorPage(i, live.cursorRect, live.cursorRect)"
					:cursorElid="onCursorPage(i, live.cursorElid, live.cursorRect)"
					:zoom="zoom.zoom"
					:drawMode="annotations.drawSpec !== null"
					:pendingStrokes="annotations.drawStrokes"
					:systemRects="session.systemRectsByPage[i] ?? NO_RECTS"
					:loopDimRects="loopDimRectsByPage[i] ?? NO_RECTS"
					:liveNoteMarks="onCursorPage(i, live.liveNoteMarks, live.cursorRect) ?? NO_MARKS"
					:needle="onCursorPage(i, live.needle, live.cursorRect)"
					@indexed="onPageIndexed"
					@noteClick="onNoteClick"
					@markerClick="onMarkerClick"
					@staffMapping="onStaffMapping"
					@stroke="annotations.addStroke"
					@loaded="zoom.onPageLoaded" />
			</div>
		</LiveValue>
	</div>
</template>

<script>
import LiveValue from './LiveValue.vue'
import LyricsView from './LyricsView.vue'
import ScorePage from './ScorePage.vue'
import SystemBand from './SystemBand.vue'
import ViewerHints from './ViewerHints.vue'
import { NO_RECTS } from '../composables/useScoreSession.js'
import { loopDimRects, loopMeasureRects, loopSystemKeys } from '../lib/loopFocus.js'
import { staffPartNames } from '../lib/lyricsLayout.js'
import { nameOf } from '../lib/noteNames.js'
import { findElementAtPoint, findNearestOccurrenceTimeMs } from '../lib/scoreLayout.js'
import { VIEWER_CONTEXT } from './viewerContext.js'

// The live intonation marks of every page off the cursor: one empty list, so
// that those pages see no changed prop while someone sings (B3).
const NO_MARKS = Object.freeze([])

// What the template reads straight from the viewer's context (viewerContext.js).
const CONTEXT_KEYS = [
	'annotations',
	'autoScroller',
	'bandZoom',
	'display',
	'intonation',
	'loop',
	'paging',
	'performance',
	'playback',
	'prefs',
	'session',
	'view',
	'zoom',
]

/**
 * The score itself (#67, from ScoreViewer.vue): the scrolling element with
 * the hints above the music, and the lyrics, the system band or the pages -
 * with what a tap, a wheel or a scroll on them does. It works on the
 * viewer's composables through its context (viewerContext.js); the viewer
 * asks it for the layout on screen (activeView()) when a key or the button
 * back to the playing position wants to move it.
 */
export default {
	name: 'ScoreStage',

	components: {
		LiveValue,
		LyricsView,
		ScorePage,
		SystemBand,
		ViewerHints,
	},

	inject: {
		ctx: { from: VIEWER_CONTEXT },
	},

	props: {
		// Window width when the viewer opened (ViewerHints.vue, D9).
		viewerWidth: {
			type: Number,
			default: 0,
		},
	},

	// Band and lyrics report whether the playing position is on screen -
	// for the viewer's button back to it.
	emits: ['cursorVisible'],

	setup() {
		return { NO_RECTS, NO_MARKS }
	},

	computed: {
		...Object.fromEntries(CONTEXT_KEYS.map((key) => [key, function() {
			return this.ctx[key]
		}])),

		// Band and lyrics scroll along when the user wants it, and for an own
		// jump or one of the leader even when not (useScoreSession.cursorForced).
		followCursor() {
			return this.prefs.autoScroll || this.session.cursorForced
		},

		partCount() {
			return this.session.pictureParts.length
		},

		spreadClasses() {
			return {
				'scoreview-pages--spread': this.display.spreadMode !== 'off',
				'scoreview-pages--first-right': this.display.spreadMode === 'right',
			}
		},

		/** Part names for the rows of the all-parts lyrics (lyricsLayout.staffPartNames). */
		lyricsPartNames() {
			const meta = this.session.pictureMeta
			return staffPartNames(this.session.pictureParts, [...(meta?.noteSpellings ?? []), ...(meta?.lyricSyllables ?? [])])
		},

		/**
		 * The props every ScorePage gets, in the band and in the page list -
		 * one list, so the two cannot drift apart. Not in it: what changes
		 * with every note (cursor, note, needle, live marks - the band passes
		 * them only to the system with the cursor) and drawing, which only
		 * the page list offers.
		 */
		sharedPageProps() {
			return {
				markers: this.annotations.markers,
				stamps: this.annotations.stamps,
				drawings: this.annotations.drawings,
				loopMarkers: this.loop.markers,
				myPartIndex: this.view.myPartIndex,
				focusMyPart: this.view.focusMyPart,
				partCount: this.partCount,
				showNoteText: this.view.showNoteText,
				highlightMode: this.prefs.highlightMode,
				noteTheme: this.prefs.resolvedNoteTheme,
				svgVars: this.prefs.highlightStyle,
				noteMarks: this.intonation.marks,
				spellings: this.view.spellings,
				noteNameSystem: this.display.noteNameSystem,
				noteNameStaves: this.display.noteNameStaves,
				keyOfElid: this.keyOfElid,
				countOfElid: this.display.countOfElid,
				countStaves: this.display.countStaves,
			}
		},

		/** The looped measures' rectangles while the focus is on (lib/loopFocus.js). */
		loopMeasureRects() {
			const range = this.loop.range
			if (!this.view.loopFocus || !range || !this.session.measuresTimeline) {
				return null
			}
			return loopMeasureRects(this.session.measuresTimeline.elements, range.from, range.to)
		},

		loopDimRectsByPage() {
			return this.loopMeasureRects ? loopDimRects(this.session.measuresTimeline.elements, this.loop.range.from, this.loop.range.to) : []
		},

		loopFocusKeys() {
			return this.loopMeasureRects ? loopSystemKeys(this.loopMeasureRects) : null
		},
	},

	methods: {
		/**
		 * What changes with every note, read by LiveValue around the band
		 * and the page list instead of by this template (see there).
		 *
		 * @return {{cursorRect: ?object, cursorElid: ?number, needle: ?object, liveNoteMarks: Array}}
		 */
		readLive() {
			return {
				cursorRect: this.session.cursorRect,
				cursorElid: this.session.currentElid,
				needle: this.intonation.needle,
				liveNoteMarks: this.intonation.liveMarks,
			}
		},

		/**
		 * A value that only the page under the cursor needs (cursor, sounding
		 * elid, live needle and live intonation marks) - every other page
		 * gets null. Vue re-renders a
		 * child whenever one of its props changes, so handing the cursor to
		 * all pages re-rendered every mounted page on every note step; this
		 * way only the page the cursor enters or leaves updates.
		 *
		 * @param {number} pageIndex
		 * @param {?(object|number)} value
		 * @param {?object} [cursorRect] the cursor to compare against - the
		 *   one LiveValue read (see readLive())
		 * @return {?(object|number)}
		 */
		onCursorPage(pageIndex, value, cursorRect = this.session.cursorRect) {
			return cursorRect?.page === pageIndex ? value : null
		},

		/**
		 * Vorzeichen an einem Segment - fuer das bewegliche Do
		 * (scoreFacts.keyByElid, einmal je Partitur gebaut).
		 *
		 * @param {number} elid
		 * @return {number}
		 */
		keyOfElid(elid) {
			return this.view.elidKeys(elid)
		},

		/** Die gehoerte Zeit als Funktion - fuer Ansichten, die je Rahmen lesen. */
		readDisplayTimeMs() {
			return this.playback.displayTimeMs
		},

		/**
		 * Klick auf einen Notizmarker springt an dessen Stelle - im
		 * Aufführungsmodus also gesperrt wie jeder andere Sprung.
		 *
		 * @param {number} id
		 */
		onMarkerClick(id) {
			if (this.performance.can('seek')) {
				this.view.followNavigation('annotationJump')
				this.annotations.jumpToById(id)
			}
		},

		/**
		 * Meldung der Seiten, ob sich Notenzeilen ueberhaupt Stimmen zuordnen
		 * lassen (siehe lib/staffBands.js).
		 *
		 * @param {boolean} moeglich
		 * @param {number} page index of the reporting page
		 */
		onStaffMapping(moeglich, page) {
			this.view.staffMappingOk = this.view.staffMappingReports.report(page, moeglich)
			if (!this.view.staffMappingOk) {
				this.view.focusMyPart = false
			}
		},

		/** @param {{segIds: boolean}} info aus ScorePage.indexSegments */
		onPageIndexed({ segIds }) {
			if (segIds) {
				this.view.svgHasSegIds = true
			}
		},

		/** @param {number} ms aus der Liedtext-Ansicht */
		onLyricsSeek(ms) {
			if (!this.session.clock || !this.performance.can('seek')) {
				return
			}
			this.view.followNavigation('seek')
			this.session.clock.seek(ms)
		},

		/**
		 * Ueber Woerter gezogen: ein Loop ueber die Takte dazwischen.
		 *
		 * @param {{fromMs: number, toMs: number}} range
		 */
		onLyricsLoop({ fromMs, toMs }) {
			if (!this.performance.can('loop')) {
				return
			}
			const from = this.view.measureAtMs(fromMs)
			const to = this.view.measureAtMs(toMs)
			if (!from || !to) {
				return
			}
			this.loop.fromMeasure = Math.min(from, to)
			this.loop.toMeasure = Math.max(from, to)
			if (!this.loop.active) {
				this.view.toggleLoop()
			}
		},

		/**
		 * „Note antippen = Ton hoeren" (D13): bei stehender Wiedergabe den
		 * getroffenen Kopf anspielen und seinen Namen zeigen. Der Synthesizer
		 * transponiert den Ton selbst (player.js), der Name bleibt die
		 * geschriebene Note.
		 *
		 * @param {{pitch: number, tpc: number, elid: number, left: number, top: number}} note
		 * @param {?function(string): void} showName from the tapped ScorePage
		 */
		async playTappedNote(note, showName) {
			if (this.playback.isPlaying || !this.performance.can('tone') || !this.session.clock?.startTone) {
				return
			}
			showName?.(nameOf({ tpc: note.tpc, system: this.display.nameSystem, concertKey: this.keyOfElid(note.elid) }))
			await this.view.briefTone.sound(note.pitch)
		},

		// Umkehrung von M4: Klick auf eine Note springt dorthin -
		// ScorePage.vue liefert nur die Klickposition in SVG-Einheiten, die
		// eigentliche Element-/Zeit-Auflösung passiert hier mit der vollen
		// timeline (scoreLayout.js).
		onNoteClick({ page, x, y, note, showName }) {
			// Liegt ein Stempel bereit, setzt der Tipp ihn - und springt nicht
			// zusaetzlich dorthin.
			if (this.annotations.armedStamp) {
				if (this.performance.can('annotate')) {
					this.annotations.placeArmedStamp({ page, x, y })
				}
				return
			}
			// Im Aufführungsmodus der haeufigste Fehlgriff ueberhaupt: ein Tipp
			// auf die Noten, um zu blaettern.
			if (!this.session.timeline || !this.session.clock || !this.performance.can('noteClick')) {
				return
			}
			const elid = findElementAtPoint(this.session.timeline.elements, page, x, y)
			if (elid === null) {
				return
			}
			// Bezugspunkt ist die gehörte Stelle: Getippt wird auf das, was
			// gerade klingt, nicht auf das, was schon im Ausgabepuffer steht.
			const timeMs = findNearestOccurrenceTimeMs(this.session.timeline.events, elid, this.playback.displayTimeMs)
			if (timeMs !== null) {
				this.view.followNavigation('noteClick')
				this.session.clock.seek(timeMs)
			}
			if (note) {
				this.playTappedNote(note, showName)
			}
		},

		/**
		 * Das Mausrad hat zwei Bedeutungen: mit Strg zoomt es (useZoom), ohne
		 * ist es gewoehnliches Scrollen - und damit ein Nutzereingriff, der
		 * das automatische Nachfuehren pausieren muss.
		 *
		 * @param {WheelEvent} event
		 */
		onViewerWheel(event) {
			if (!event.ctrlKey) {
				this.autoScroller.noteManualScroll()
				return
			}
			// The score zooms, not the Nextcloud page around it.
			event.preventDefault()
			this.display.activeZoom.wheel(event)
		},

		/**
		 * The lyrics view scrolls the viewer's element, so only it learns
		 * here that its syllable may have left the screen. Pages measure in
		 * useAutoScroll, the band in its own scroller.
		 */
		onViewerScrollEnd() {
			this.autoScroller.onScrollEnd()
			if (!this.prefs.autoScroll && this.display.activeLayout === 'lyrics') {
				this.$refs.lyrics?.reportVisibility()
			}
		},

		/**
		 * The layout on screen behind one shape: back to the playing
		 * position, one step on and back. The band steps by system (H8),
		 * pages and lyrics scroll by a screen.
		 *
		 * @return {{reveal: () => void, next: () => void, previous: () => void}}
		 */
		activeView() {
			const pages = { next: () => this.paging.page(1), previous: () => this.paging.page(-1) }
			switch (this.display.activeLayout) {
				case 'band': return {
					reveal: () => this.$refs.band?.reveal(),
					next: () => this.$refs.band?.next(),
					previous: () => this.$refs.band?.previous(),
				}
				case 'lyrics': return { ...pages, reveal: () => this.$refs.lyrics?.reveal() }
				default: return { ...pages, reveal: () => this.autoScroller.update(this.session.cursorRect, true) }
			}
		},
	},
}
</script>

<style scoped>
.scoreview-scroll {
	height: 100%;
	/* Senkrecht IMMER mit Balken: sonst ändert sich die verfügbare Breite in
	   dem Moment, in dem der Inhalt hoch genug wird - und der an die Breite
	   gekoppelte Zoom (setUpViewportObserver) würde sich selbst anstoßen. */
	overflow-y: scroll;
	overflow-x: auto;
	box-sizing: border-box;
	padding: 12px;
	/* See .scoreview-viewer - also covers the lyrics view, which scrolls here. */
	touch-action: pan-x pan-y;
}

.scoreview-scroll--band {
	display: flex;
	flex-direction: column;
	overflow-y: hidden;
}

/* :deep - the hints are ViewerHints' elements, the band SystemBand's. */
.scoreview-scroll--band > :deep(.scoreview-hint) {
	flex: 0 0 auto;
}

.scoreview-scroll--band > :deep(.scoreview-band) {
	flex: 1 1 0;
	height: auto;
	min-height: 0;
}

/*
 * Block statt Flex-Spalte: eine Seite kann breiter als der Container sein
 * (Zoom, siehe ScorePage.vue). In einer zentrierenden Flex-Spalte wäre der
 * überstehende linke Teil nicht mehr erreichbar - bei einem Blockelement
 * mit `margin: 0 auto` fällt die Zentrierung im Überlauf einfach weg, und
 * der Scrollbereich deckt die ganze Seite ab.
 */
.scoreview-pages {
	display: block;
	/* The browser's own pinch zoom would enlarge the whole Nextcloud page;
	 * here two fingers zoom the score (useZoom.js). Declared in CSS instead
	 * of preventDefault() so the touch listeners can be passive - a
	 * non-passive touchmove made every one-finger scroll over the score wait
	 * for the main thread. The rest of the viewer has the same rule (see
	 * .scoreview-viewer); here it is the one that matters, because two
	 * fingers on the pages are the app's own zoom gesture. */
	touch-action: pan-x pan-y;
}

/*
 * Two pages side by side (A2, lib/spreadLayout.js): a grid of two
 * columns as wide as the pages. `safe center` for the same reason the
 * single column is a block - zoomed beyond the pair, the row overflows,
 * and plain centring would push its left part out of reach. ScorePage
 * keeps its width and aspect ratio; only its margin goes, the grid gap
 * (SPREAD_GAP_PX) takes over.
 */
.scoreview-pages--spread {
	display: grid;
	grid-template-columns: repeat(2, max-content);
	justify-content: safe center;
	gap: 16px;
}

.scoreview-pages--spread > :deep(.score-page) {
	margin: 0;
}

/* Page 1 alone on the right, like the first page of a booklet. */
.scoreview-pages--first-right > :deep(.score-page:first-child) {
	grid-column: 2;
}
</style>
