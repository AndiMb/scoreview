<template>
	<!--
		Systemband (H8): die Notensysteme nebeneinander, jedes so hoch wie der
		Platz. Ausgeschnitten wird aus dem Seitenbild (E2 bleibt): Jedes System
		ist eine gewoehnliche ScorePage mit passendem Zoom in einem Rahmen, der
		nur den Ausschnitt zeigt. Cursor, Stempel, Notizen und Tonnamen
		funktionieren dadurch unveraendert - sie liegen in Prozent der Seite.

		Gerendert werden nur die sichtbaren Systeme und ihre Nachbarn: jede
		ScorePage traegt das ganze Seiten-SVG (see rendered()).
	-->
	<div
		ref="scroller"
		class="scoreview-band"
		:class="{ 'scoreview-band--paging': paging }"
		@scroll.passive="onScroll"
		@scrollend.passive="paging = false"
		@pointerdown.passive="onGesture"
		@wheel.passive="onGesture">
		<p v-if="crops.length === 0" class="scoreview-band-empty">
			{{ loading ? t('Preparing the system band…') : t('No staves found on these pages.') }}
		</p>
		<!-- Keyed by the page too: a new picture (variant, piece, version)
			brings new pages under the same indices, and a ScorePage keeps the
			SVG it loaded first - it has to be built anew, as in the page view. -->
		<div
			v-for="(crop, i) in crops"
			:key="`${loadedUrls[crop.page]}#${crop.index}`"
			class="scoreview-band-system"
			:style="layouts[i].frame">
			<div
				v-if="rendered(crop.index)"
				class="scoreview-band-shift"
				:style="layouts[i].shift">
				<ScorePage
					v-bind="pageProps"
					:svgUrl="loadedUrls[crop.page]"
					:pageIndex="crop.page"
					:zoom="layouts[i].zoom"
					:systemRects="systemRectsByPage[crop.page] ?? NO_RECTS"
					:loopDimRects="loopDimRectsByPage[crop.page] ?? NO_RECTS"
					:cursorRect="crop.index === cursorCrop ? cursorRect : null"
					:cursorElid="crop.index === cursorCrop ? cursorElid : null"
					:needle="crop.index === cursorCrop ? needle : null"
					:liveNoteMarks="crop.index === cursorCrop ? liveNoteMarks : NO_MARKS"
					@noteClick="(e) => $emit('noteClick', e)"
					@markerClick="(e) => $emit('markerClick', e)"
					@indexed="(e) => $emit('indexed', e)"
					@staffMapping="(ok, page) => $emit('staffMapping', ok, page)" />
			</div>
		</div>
	</div>
</template>

<script>
import axios from '@nextcloud/axios'
import ScorePage from './ScorePage.vue'
import { translate } from '../l10n.js'
import { pageForCursor, pageStep, planBandPage } from '../lib/bandPaging.js'
import { cropsInLoop } from '../lib/loopFocus.js'
import { BASE_PAGE_WIDTH_PX, parseViewBox } from '../lib/scoreLayout.js'
import { shouldSuppressAutoScroll, spanInView } from '../lib/scrollPlan.js'
import { findStaffBands, groupBandsIntoSystems } from '../lib/staffBands.js'
import { bandAnchor, bandScale, bandWindow, cropIndexAt, frameAt, lyricBaselines, lyricBottomsFor, scrollForAnchor, systemCrops } from '../lib/systemBand.js'

/**
 * Vorlauf beim Mitscrollen: das System steht nicht ganz am Rand. Er steckt
 * in `scroll-padding` (siehe Stil) - ein Ziel neben einem Einrastpunkt
 * verwirft das Scroll-Snapping sonst stillschweigend (gemessen: scrollTo auf
 * 436 px blieb bei 8 px stehen).
 */
const LEAD = 0.08

const NO_RECTS = Object.freeze([])
// One empty list for every frame without the cursor: a new [] each render
// would count as a changed prop.
const NO_MARKS = Object.freeze([])

export default {
	name: 'SystemBand',

	components: {
		ScorePage,
	},

	// The band scrolls in its own container - the pages' observers watch
	// that one, not the viewer's (ScorePage.vue).
	provide() {
		return {
			scoreviewScrollRoot: () => this.$refs.scroller ?? null,
		}
	},

	props: {
		pageUrls: {
			type: Array,
			required: true,
		},

		systemRectsByPage: {
			type: Array,
			default: () => [],
		},

		// Alle weiteren Props, die eine ScorePage auch auf Seiten bekommt
		pageProps: {
			type: Object,
			required: true,
		},

		// Das Cursor-Rechteck {page, x, y, w, h} - fuer das Mitscrollen
		cursorRect: {
			type: Object,
			default: null,
		},

		// Cursor, note and intonation needle go to the ONE frame showing the
		// cursor, not through `pageProps`: they change with every note, and
		// each mounted frame would re-render for it (a page holds several
		// systems, so several frames show the same page).
		cursorElid: {
			type: Number,
			default: null,
		},

		needle: {
			type: Object,
			default: null,
		},

		// The live intonation marks (B3), like the needle: they change with
		// every frame of singing.
		liveNoteMarks: {
			type: Array,
			default: () => NO_MARKS,
		},

		// Focus on the loop (B4): the looped measures' rectangles - only the
		// frames holding one are shown; null = all frames.
		loopRects: {
			type: Array,
			default: null,
		},

		// The dim rectangles per page for the pages inside the frames.
		loopDimRectsByPage: {
			type: Array,
			default: () => [],
		},

		// Whether a new system scrolls into view by itself - off when the
		// user switched autoscroll off (issue #12), on again for a jump.
		follow: {
			type: Boolean,
			required: true,
		},

		// A jump - a tapped note, the leader - goes to the cursor even right
		// after a gesture (useScoreSession.cursorForced).
		forced: {
			type: Boolean,
			default: false,
		},

		// The band's own zoom, a factor on bandScale (useBandZoom.js).
		zoom: {
			type: Number,
			default: 1,
		},
	},

	emits: ['noteClick', 'markerClick', 'indexed', 'cursorVisible', 'staffMapping'],

	data() {
		return {
			// Every system of every page; `crops` narrows it to the loop.
			allCrops: [],
			// The page URLs the crops were cut from - set together with them,
			// so that the frames never show one picture under the crops of
			// another while the next one loads (pageUrls changes first).
			loadedUrls: [],
			viewBoxes: [],
			heightPx: 300,
			current: 0,
			// Frames in reach of the screen (bandWindow), kept apart from
			// `current` - see rendered().
			windowFrom: 0,
			windowTo: 1,
			// The frame after the next one, mounted ahead in idle time - see
			// rendered().
			ahead: -1,
			loading: false,
			// The band turns a page itself: no snapping meanwhile, see pageTo().
			paging: false,
		}
	},

	computed: {
		NO_RECTS: () => NO_RECTS,
		NO_MARKS: () => NO_MARKS,

		/**
		 * The frames shown: all systems, or - focused on the loop (B4) - only
		 * those a looped measure lies in. The others are not dimmed but gone:
		 * side by side, a dimmed system would still cost a swipe.
		 */
		crops() {
			return this.loopRects ? cropsInLoop(this.allCrops, this.loopRects) : this.allCrops
		},

		/** The frame showing the cursor, or -1. */
		cursorCrop() {
			const rect = this.cursorRect
			// While a new picture loads, the cursor already belongs to it and
			// the crops still to the old one.
			if (!rect || this.crops.length === 0 || this.loading) {
				return -1
			}
			return cropIndexAt(this.crops, rect.page, rect.y + rect.h / 2)
		},

		/** Size, shift and zoom of every frame - once per layout, not per render. */
		layouts() {
			return this.crops.map((crop) => {
				const vb = this.viewBoxes[crop.page]
				const scale = bandScale(crop, vb, this.heightPx, { zoom: this.zoom })
				const px = scale.pageWidthPx / vb.width
				return {
					// Page units -> px in this frame, for the cursor's position
					// in the band (cursorSpan).
					px,
					frame: { width: `${scale.cropWidthPx}px`, height: `${scale.cropHeightPx}px` },
					shift: { transform: `translate(${-(crop.x - vb.minX) * px}px, ${-(crop.y - vb.minY) * px}px)` },
					zoom: scale.pageWidthPx / BASE_PAGE_WIDTH_PX,
				}
			})
		},
	},

	watch: {
		// After a turn, the frame after the next one is built while the band
		// rests - not at the next turn, where its page (fetch from cache,
		// sanitize, clone, index) took a frame of its own on a phone right
		// when the band jumps. Right away as well: the first turn needs it.
		current: {
			handler() {
				this.scheduleAhead()
			},

			immediate: true,
		},

		// A loop focus adds or removes frames: measure them again, like
		// after a load.
		crops() {
			this.$nextTick(() => this.measureFrames())
		},

		// Runs before the frames are laid out anew: the anchor still reads
		// the old positions.
		zoom() {
			this.relayout()
		},

		// Every note, not only on a new frame: after scrolling away by hand,
		// a note brings the band back to the cursor - once the hand has rested
		// a moment, as in the page view, so that looking back is not torn
		// away. Inside a frame wider than the screen it turns pages
		// (bandPaging.js, issue #21).
		//
		// Following the playing it turns at once, like a page, not in a
		// glide: measured on a Galaxy S23, a glide took 400-850 ms, and at the
		// end of a system the next note already stands right of the screen -
		// the cursor was out of view for that long at every system.
		cursorRect() {
			const index = this.cursorCrop
			if (this.follow && index >= 0 && (this.forced || !shouldSuppressAutoScroll(this.lastGestureAt, Date.now()))) {
				if (index !== this.current) {
					this.goTo(index, 'instant')
				} else {
					this.turnPage(index, 'instant')
				}
			}
			this.reportVisibility()
		},
	},

	created() {
		// Not part of the rendered state: positions of the frames, read once
		// per layout so that scrolling never forces a layout (onScroll).
		this.frameLefts = []
		this.frameWidths = []
		this.viewWidth = 0
		this.loadGeneration = 0
		this.scrollPending = 0
		// Last touch, click or wheel on the band - its own scrolling is none.
		this.lastGestureAt = null
		// Pending idle callback for `ahead` (scheduleAhead()).
		this.aheadHandle = null
		// Last visibility reported (reportVisibility) - an event per change,
		// not per note.
		this.cursorShown = true
		// Both change together on a piece change (useScoreSession.load) - one
		// load for both, not one each.
		this.$watch(() => [this.pageUrls, this.systemRectsByPage], () => this.load(), { immediate: true })
	},

	mounted() {
		this.resize = new ResizeObserver(() => {
			this.relayout(() => {
				this.heightPx = Math.max(120, this.$refs.scroller?.clientHeight ?? 300)
			})
		})
		this.resize.observe(this.$refs.scroller)
	},

	beforeUnmount() {
		this.resize?.disconnect()
		cancelAnimationFrame(this.scrollPending)
		clearTimeout(this.pagingTimer)
		this.cancelAhead()
		this.loadGeneration++
	},

	methods: {
		/**
		 * Alle Seiten einmal holen und ihre Systeme bestimmen. Die Antworten
		 * sind unveraenderlich gecacht (ConversionController) - der Browser
		 * liefert sie den ScorePages danach aus dem Cache.
		 */
		async load() {
			const generation = ++this.loadGeneration
			if (this.pageUrls.length === 0) {
				return
			}
			this.loading = true
			const urls = [...this.pageUrls]
			try {
				const texts = await Promise.all(urls.map((url) => axios.get(url, { responseType: 'text' }).then((r) => r.data)))
				if (generation !== this.loadGeneration) {
					return
				}
				const pages = texts.map((text, page) => {
					const viewBox = parseViewBox(text)
					const systems = groupBandsIntoSystems(findStaffBands(text), this.systemRectsByPage[page] ?? [])
					return { page, viewBox, systems, lyricBottoms: lyricBottomsFor(systems, lyricBaselines(text)) }
				}).filter((p) => p.viewBox)
				this.viewBoxes = []
				for (const p of pages) {
					this.viewBoxes[p.page] = p.viewBox
				}
				this.loadedUrls = urls
				this.allCrops = systemCrops(pages)
				this.$nextTick(() => {
					this.measureFrames()
					// The old scroll position means nothing in the new picture.
					if (this.follow) {
						this.reveal()
					}
				})
			} catch (err) {
				if (generation !== this.loadGeneration) {
					return
				}
				// eslint-disable-next-line no-console
				console.error('ScoreView: could not build the system band.', err)
				this.allCrops = []
			} finally {
				if (generation === this.loadGeneration) {
					this.loading = false
				}
			}
		},

		/**
		 * To a system: its start under the lead, its top at the top - a
		 * system zoomed taller than the band starts with its first staff.
		 *
		 * @param {number} index
		 * @param {ScrollBehavior} [behavior]
		 */
		goTo(index, behavior = 'smooth') {
			const target = Math.max(0, Math.min(this.crops.length - 1, index))
			this.current = target
			if (this.frameLefts.length > target) {
				// The spot scroll-padding (LEAD) snaps a frame to. Not
				// scrollIntoView: that also scrolls the viewer around the band
				// to the frame's top, past the hints above it.
				this.pageTo(Math.max(0, this.frameLefts[target] - this.viewWidth * LEAD), { top: 0, behavior })
				return
			}
			this.$refs.scroller?.children[target]?.scrollIntoView({ inline: 'start', block: 'nearest', behavior })
		},

		/**
		 * The cursor in band coordinates, from the cached frame positions.
		 *
		 * @param {number} index frame of the cursor
		 * @return {?{left: number, width: number}}
		 */
		cursorSpan(index) {
			const rect = this.cursorRect
			const crop = this.crops[index]
			const layout = this.layouts[index]
			if (!rect || !crop || !layout || this.frameLefts.length <= index) {
				return null
			}
			return { left: this.frameLefts[index] + (rect.x - crop.x) * layout.px, width: rect.w * layout.px }
		},

		/**
		 * Inside a frame wider than the screen: the next page when the cursor
		 * nears the right edge.
		 *
		 * @param {number} index
		 * @param {ScrollBehavior} [behavior]
		 */
		turnPage(index, behavior = 'smooth') {
			const scroller = this.$refs.scroller
			const span = this.cursorSpan(index)
			if (!scroller || !span) {
				return
			}
			const left = planBandPage({
				frameLeft: this.frameLefts[index],
				frameWidth: this.frameWidths[index],
				cursorLeft: span.left,
				cursorWidth: span.width,
				scrollLeft: scroller.scrollLeft,
				viewWidth: this.viewWidth,
				lead: LEAD,
			})
			if (left !== null) {
				this.pageTo(left, { behavior })
			}
		},

		/** To the system that is playing - the button back to it, and switching autoscroll on again. */
		reveal() {
			this.lastGestureAt = null
			this.showCursor('smooth')
		},

		/**
		 * @param {ScrollBehavior} behavior
		 */
		showCursor(behavior) {
			const index = this.cursorCrop
			if (index < 0) {
				return
			}
			const span = this.cursorSpan(index)
			if (span && this.frameWidths[index] > this.viewWidth) {
				this.current = index
				this.pageTo(pageForCursor({ frameLeft: this.frameLefts[index], frameWidth: this.frameWidths[index], cursorLeft: span.left, viewWidth: this.viewWidth, lead: LEAD }), { behavior })
				return
			}
			this.goTo(index, behavior)
		},

		/**
		 * The frames change size - a new band height (the bar retracts on a
		 * phone held sideways, a hint comes or goes, the phone turns) or a
		 * new zoom. Every position in px then points elsewhere, so the band
		 * keeps its place: on the cursor while it follows the playing, else
		 * on the spot that was at its left edge.
		 *
		 * @param {() => void} [change] applied after the old positions are read
		 */
		relayout(change) {
			const scroller = this.$refs.scroller
			const frames = this.frames()
			const anchor = scroller && frames.length > 0
				? {
						band: bandAnchor(frames, scroller.scrollLeft),
						top: scroller.scrollHeight > 0 ? scroller.scrollTop / scroller.scrollHeight : 0,
						cursor: this.follow && this.cursorCrop >= 0 && this.cursorShown,
					}
				: null
			change?.()
			this.$nextTick(() => {
				this.measureFrames()
				const after = this.$refs.scroller
				if (!anchor || !after) {
					return
				}
				if (anchor.cursor) {
					this.showCursor('instant')
					return
				}
				const left = scrollForAnchor(this.frames(), anchor.band)
				if (left !== null) {
					this.pageTo(left, { top: anchor.top * after.scrollHeight, behavior: 'instant' })
				}
			})
		},

		/** @return {Array<{left:number, width:number}>} the cached frame positions */
		frames() {
			return this.frameLefts.map((left, i) => ({ left, width: this.frameWidths[i] }))
		},

		/**
		 * Whether the playing system is on screen, from the cached frame
		 * positions - per note and per scrolled frame, never a layout read.
		 */
		reportVisibility() {
			const index = this.cursorCrop
			const scroller = this.$refs.scroller
			let visible = true
			if (index >= 0 && scroller && this.frameLefts.length > index) {
				// The cursor itself, not its frame: in a frame wider than the
				// screen the frame is "on screen" while the cursor is not.
				const span = this.cursorSpan(index) ?? { left: this.frameLefts[index], width: this.frameWidths[index] }
				visible = spanInView({
					start: span.left,
					size: span.width,
					viewStart: scroller.scrollLeft,
					viewSize: this.viewWidth,
				})
			}
			if (visible !== this.cursorShown) {
				this.cursorShown = visible
				this.$emit('cursorVisible', visible)
			}
		},

		/** Pedal, Bild↓ und Wischen: a page on in a wide system, else a system. */
		next() {
			if (!this.step(1)) {
				this.goTo(this.current + 1)
			}
		},

		previous() {
			if (!this.step(-1)) {
				this.goTo(this.current - 1)
			}
		},

		/**
		 * @param {1|-1} direction
		 * @return {boolean} whether there was a page to turn to
		 */
		step(direction) {
			const scroller = this.$refs.scroller
			const index = this.current
			if (!scroller || this.frameLefts.length <= index) {
				return false
			}
			const left = pageStep({ frameLeft: this.frameLefts[index], frameWidth: this.frameWidths[index], scrollLeft: scroller.scrollLeft, viewWidth: this.viewWidth, direction, lead: LEAD })
			if (left === null) {
				return false
			}
			this.pageTo(left)
			return true
		},

		/**
		 * Glide to a position inside a frame. Snapping is off until the glide
		 * ends: measured, a turn aimed at 988 px stopped at 745 px - the
		 * frames' snap points pull every target back that is not a frame's
		 * start. Manual swipes snap as before.
		 *
		 * @param {number} left
		 * @param {{top?: number, behavior?: ScrollBehavior}} [options] `top`
		 *   only when given - turning a page within a system keeps the height
		 */
		pageTo(left, { top, behavior = 'smooth' } = {}) {
			this.paging = true
			clearTimeout(this.pagingTimer)
			// scrollend is missing in older Safari - do not stay unsnapped.
			this.pagingTimer = setTimeout(() => {
				this.paging = false
			}, 1500)
			const to = top === undefined ? { left, behavior } : { left, top, behavior }
			this.$nextTick(() => this.$refs.scroller?.scrollTo(to))
		},

		onGesture() {
			this.lastGestureAt = Date.now()
		},

		/**
		 * Whether a frame carries its ScorePage. The neighbours of `current`
		 * stay in so that goTo() finds its target mounted before the glide
		 * starts; the rest comes from the geometry.
		 *
		 * @param {number} index
		 * @return {boolean}
		 */
		rendered(index) {
			return Math.abs(index - this.current) <= 1
				|| index === this.ahead
				|| (index >= this.windowFrom && index <= this.windowTo)
		},

		/** Mounts the frame after the next one once the main thread is idle. */
		scheduleAhead() {
			this.cancelAhead()
			const target = this.current + 2
			const run = () => {
				this.aheadHandle = null
				this.ahead = target
			}
			// At the latest after a second - a band that keeps playing has no
			// idle time on a slow phone, and then the frame is built anyway,
			// still well before the next turn.
			this.aheadHandle = typeof requestIdleCallback === 'function'
				? { idle: requestIdleCallback(run, { timeout: 1000 }) }
				: { timer: setTimeout(run, 200) }
		},

		cancelAhead() {
			if (this.aheadHandle?.idle !== undefined) {
				cancelIdleCallback(this.aheadHandle.idle)
			} else if (this.aheadHandle?.timer !== undefined) {
				clearTimeout(this.aheadHandle.timer)
			}
			this.aheadHandle = null
		},

		/** Reads the frames' positions - after a load or a resize only. */
		measureFrames() {
			const scroller = this.$refs.scroller
			if (!scroller) {
				return
			}
			// The empty-state paragraph is a child too, but only without frames.
			const frames = this.crops.length === 0 ? [] : [...scroller.children]
			this.frameLefts = frames.map((el) => el.offsetLeft)
			this.frameWidths = frames.map((el) => el.offsetWidth)
			this.viewWidth = scroller.clientWidth
			this.updateWindow()
		},

		updateWindow() {
			const scroller = this.$refs.scroller
			if (!scroller || this.frameLefts.length === 0) {
				return
			}
			const range = bandWindow(this.frames(), scroller.scrollLeft, this.viewWidth)
			if (range && (range.from !== this.windowFrom || range.to !== this.windowTo)) {
				this.windowFrom = range.from
				this.windowTo = range.to
			}
		},

		onScroll() {
			// One evaluation per frame, from cached positions: a smooth glide
			// fires many scroll events, and reading offsetLeft after Vue patched
			// the frames would force a layout each time.
			if (this.scrollPending) {
				return
			}
			this.scrollPending = requestAnimationFrame(() => {
				this.scrollPending = 0
				const scroller = this.$refs.scroller
				if (!scroller) {
					return
				}
				const index = frameAt(this.frameLefts, scroller.scrollLeft + this.viewWidth * LEAD)
				if (index !== this.current) {
					this.current = index
				}
				this.updateWindow()
				this.reportVisibility()
			})
		},

		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped>
.scoreview-band {
	/* Makes the band the offsetParent of its frames: their offsetLeft is
	   then in the same coordinates as scrollLeft (onScroll, updateWindow). */
	position: relative;
	display: flex;
	gap: 12px;
	height: 100%;
	/* A system shorter than the band stands at its top; one zoomed taller
	   scrolls up and down within the band (useBandZoom). */
	align-items: flex-start;
	overflow-x: auto;
	overflow-y: auto;
	scroll-snap-type: x proximity;
	scroll-padding-inline-start: 8%;
	padding: 0 8px;
	box-sizing: border-box;
	/* An own scroll container: without this, a pinch on the band enlarged
	   the whole page in iOS Safari (see .scoreview-viewer, issue #13). */
	touch-action: pan-x pan-y;
}

.scoreview-band--paging {
	scroll-snap-type: none;
}

.scoreview-band-system {
	flex: 0 0 auto;
	overflow: hidden;
	position: relative;
	scroll-snap-align: start;
	background: var(--scoreview-note-background, #fff);
	border-radius: 4px;
}

.scoreview-band-shift {
	position: absolute;
	/* Physisch statt logisch: Das Notenbild laeuft immer von links nach
	   rechts, auch in einer Oberflaeche mit Schreibrichtung rechts-links -
	   und die Verschiebung per transform rechnet von genau dieser Ecke aus. */
	/* stylelint-disable-next-line csstools/use-logical */
	top: 0;
	/* stylelint-disable-next-line csstools/use-logical */
	left: 0;
	transform-origin: 0 0;
}

.scoreview-band-empty {
	margin: auto;
	color: var(--color-text-maxcontrast, #767676);
}
</style>
