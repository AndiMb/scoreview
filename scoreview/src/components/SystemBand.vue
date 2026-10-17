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
	<div ref="scroller" class="scoreview-band" @scroll.passive="onScroll">
		<p v-if="crops.length === 0" class="scoreview-band-empty">
			{{ loading ? t('Preparing the system band…') : t('No staves found on these pages.') }}
		</p>
		<div
			v-for="(crop, i) in crops"
			:key="crop.index"
			class="scoreview-band-system"
			:style="layouts[i].frame">
			<div
				v-if="rendered(crop.index)"
				class="scoreview-band-shift"
				:style="layouts[i].shift">
				<ScorePage
					v-bind="pageProps"
					:svgUrl="pageUrls[crop.page]"
					:pageIndex="crop.page"
					:zoom="layouts[i].zoom"
					:systemRects="systemRectsByPage[crop.page] ?? NO_RECTS"
					:cursorRect="crop.index === cursorCrop ? cursorRect : null"
					:cursorElid="crop.index === cursorCrop ? cursorElid : null"
					:needle="crop.index === cursorCrop ? needle : null"
					@noteClick="(e) => $emit('noteClick', e)"
					@markerClick="(e) => $emit('markerClick', e)"
					@indexed="(e) => $emit('indexed', e)" />
			</div>
		</div>
	</div>
</template>

<script>
import axios from '@nextcloud/axios'
import { translate } from '@nextcloud/l10n'
import ScorePage from './ScorePage.vue'
import { BASE_PAGE_WIDTH_PX, parseViewBox } from '../lib/scoreLayout.js'
import { spanInView } from '../lib/scrollPlan.js'
import { findStaffBands, groupBandsIntoSystems } from '../lib/staffBands.js'
import { bandWindow, cropIndexAt, cropScale, frameAt, lyricBaselines, lyricBottomsFor, systemCrops } from '../lib/systemBand.js'

/**
 * Vorlauf beim Mitscrollen: das System steht nicht ganz am Rand. Er steckt
 * in `scroll-padding` (siehe Stil) - ein Ziel neben einem Einrastpunkt
 * verwirft das Scroll-Snapping sonst stillschweigend (gemessen: scrollTo auf
 * 436 px blieb bei 8 px stehen).
 */
const LEAD = 0.08

const NO_RECTS = Object.freeze([])

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

		// Whether a new system scrolls into view by itself - off when the
		// user switched autoscroll off (issue #12), on again for a jump.
		follow: {
			type: Boolean,
			required: true,
		},
	},

	emits: ['noteClick', 'markerClick', 'indexed', 'cursorVisible'],

	data() {
		return {
			crops: [],
			viewBoxes: [],
			heightPx: 300,
			current: 0,
			// Frames in reach of the screen (bandWindow), kept apart from
			// `current` - see rendered().
			windowFrom: 0,
			windowTo: 1,
			loading: false,
		}
	},

	computed: {
		NO_RECTS: () => NO_RECTS,

		/** The frame showing the cursor, or -1. */
		cursorCrop() {
			const rect = this.cursorRect
			if (!rect || this.crops.length === 0) {
				return -1
			}
			return cropIndexAt(this.crops, rect.page, rect.y + rect.h / 2)
		},

		/** Size, shift and zoom of every frame - once per layout, not per render. */
		layouts() {
			return this.crops.map((crop) => {
				const vb = this.viewBoxes[crop.page]
				const scale = cropScale(crop, vb, this.heightPx)
				const px = scale.pageWidthPx / vb.width
				return {
					frame: { width: `${scale.cropWidthPx}px`, height: `${this.heightPx}px` },
					shift: { transform: `translate(${-(crop.x - vb.minX) * px}px, ${-(crop.y - vb.minY) * px}px)` },
					zoom: scale.pageWidthPx / BASE_PAGE_WIDTH_PX,
				}
			})
		},
	},

	watch: {
		// Every note, not only on a new frame: after scrolling away by hand,
		// the next note brings the band back to the cursor.
		cursorRect() {
			const index = this.cursorCrop
			if (this.follow && index >= 0 && index !== this.current) {
				this.goTo(index)
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
		// Last visibility reported (reportVisibility) - an event per change,
		// not per note.
		this.cursorShown = true
		// Both change together on a piece change (useScoreSession.load) - one
		// load for both, not one each.
		this.$watch(() => [this.pageUrls, this.systemRectsByPage], () => this.load(), { immediate: true })
	},

	mounted() {
		this.resize = new ResizeObserver(() => {
			this.heightPx = Math.max(120, this.$refs.scroller?.clientHeight ?? 300)
			// The frame widths follow the height - measure after they changed.
			this.$nextTick(() => this.measureFrames())
		})
		this.resize.observe(this.$refs.scroller)
	},

	beforeUnmount() {
		this.resize?.disconnect()
		cancelAnimationFrame(this.scrollPending)
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
			try {
				const texts = await Promise.all(this.pageUrls.map((url) => axios.get(url, { responseType: 'text' }).then((r) => r.data)))
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
				this.crops = systemCrops(pages)
				this.$nextTick(() => this.measureFrames())
			} catch (err) {
				if (generation !== this.loadGeneration) {
					return
				}
				// eslint-disable-next-line no-console
				console.error('ScoreView: could not build the system band.', err)
				this.crops = []
			} finally {
				if (generation === this.loadGeneration) {
					this.loading = false
				}
			}
		},

		/**
		 * @param {number} index
		 */
		goTo(index) {
			const target = Math.max(0, Math.min(this.crops.length - 1, index))
			this.current = target
			const el = this.$refs.scroller?.children[target]
			el?.scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'smooth' })
		},

		/** To the system that is playing - the button back to it, and switching autoscroll on again. */
		reveal() {
			if (this.cursorCrop >= 0) {
				this.goTo(this.cursorCrop)
			}
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
				visible = spanInView({
					start: this.frameLefts[index],
					size: this.frameWidths[index],
					viewStart: scroller.scrollLeft,
					viewSize: this.viewWidth,
				})
			}
			if (visible !== this.cursorShown) {
				this.cursorShown = visible
				this.$emit('cursorVisible', visible)
			}
		},

		/** Pedal, Bild↓ und Wischen: ein System weiter. */
		next() {
			this.goTo(this.current + 1)
		},

		previous() {
			this.goTo(this.current - 1)
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
				|| (index >= this.windowFrom && index <= this.windowTo)
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
			const frames = this.frameLefts.map((left, i) => ({ left, width: this.frameWidths[i] }))
			const range = bandWindow(frames, scroller.scrollLeft, this.viewWidth)
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
	overflow-x: auto;
	overflow-y: hidden;
	scroll-snap-type: x proximity;
	scroll-padding-inline-start: 8%;
	padding: 0 8px;
	box-sizing: border-box;
	/* An own scroll container: without this, a pinch on the band enlarged
	   the whole page in iOS Safari (see .scoreview-viewer, issue #13). */
	touch-action: pan-x pan-y;
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
