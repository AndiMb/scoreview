<template>
	<!--
		Systemband (H8): die Notensysteme nebeneinander, jedes so hoch wie der
		Platz. Ausgeschnitten wird aus dem Seitenbild (E2 bleibt): Jedes System
		ist eine gewoehnliche ScorePage mit passendem Zoom in einem Rahmen, der
		nur den Ausschnitt zeigt. Cursor, Stempel, Notizen und Tonnamen
		funktionieren dadurch unveraendert - sie liegen in Prozent der Seite.

		Gerendert werden nur das sichtbare System und seine Nachbarn: jede
		ScorePage traegt das ganze Seiten-SVG.
	-->
	<div ref="scroller" class="scoreview-band" @scroll.passive="onScroll">
		<p v-if="crops.length === 0" class="scoreview-band-empty">
			{{ loading ? t('Preparing the system band…') : t('No staves found on these pages.') }}
		</p>
		<div
			v-for="crop in crops"
			:key="crop.index"
			class="scoreview-band-system"
			:style="frameStyle(crop)">
			<div
				v-if="Math.abs(crop.index - current) <= 1"
				class="scoreview-band-shift"
				:style="shiftStyle(crop)">
				<ScorePage
					v-bind="pageProps"
					:svgUrl="pageUrls[crop.page]"
					:pageIndex="crop.page"
					:zoom="zoomFor(crop)"
					:systemRects="systemRectsByPage[crop.page] ?? []"
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
import { findStaffBands, groupBandsIntoSystems } from '../lib/staffBands.js'
import { cropIndexAt, cropScale, lyricBaselines, lyricBottomsFor, systemCrops } from '../lib/systemBand.js'

/**
 * Vorlauf beim Mitscrollen: das System steht nicht ganz am Rand. Er steckt
 * in `scroll-padding` (siehe Stil) - ein Ziel neben einem Einrastpunkt
 * verwirft das Scroll-Snapping sonst stillschweigend (gemessen: scrollTo auf
 * 436 px blieb bei 8 px stehen).
 */
const LEAD = 0.08

export default {
	name: 'SystemBand',

	components: {
		ScorePage,
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
	},

	emits: ['noteClick', 'markerClick', 'indexed'],

	data() {
		return {
			crops: [],
			viewBoxes: [],
			heightPx: 300,
			current: 0,
			loading: false,
		}
	},

	watch: {
		pageUrls: {
			handler() {
				this.load()
			},

			immediate: true,
		},

		systemRectsByPage() {
			this.load()
		},

		cursorRect(rect) {
			if (!rect || this.crops.length === 0) {
				return
			}
			const index = cropIndexAt(this.crops, rect.page, rect.y + rect.h / 2)
			if (index >= 0 && index !== this.current) {
				this.goTo(index)
			}
		},
	},

	mounted() {
		this.resize = new ResizeObserver(() => {
			this.heightPx = Math.max(120, this.$refs.scroller?.clientHeight ?? 300)
		})
		this.resize.observe(this.$refs.scroller)
	},

	beforeUnmount() {
		this.resize?.disconnect()
	},

	methods: {
		/**
		 * Alle Seiten einmal holen und ihre Systeme bestimmen. Die Antworten
		 * sind unveraenderlich gecacht (ConversionController) - der Browser
		 * liefert sie den ScorePages danach aus dem Cache.
		 */
		async load() {
			if (this.pageUrls.length === 0) {
				return
			}
			this.loading = true
			try {
				const texts = await Promise.all(this.pageUrls.map((url) => axios.get(url, { responseType: 'text' }).then((r) => r.data)))
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
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error('ScoreView: Systemband konnte nicht aufgebaut werden.', err)
				this.crops = []
			} finally {
				this.loading = false
			}
		},

		scale(crop) {
			return cropScale(crop, this.viewBoxes[crop.page], this.heightPx)
		},

		zoomFor(crop) {
			return this.scale(crop).pageWidthPx / BASE_PAGE_WIDTH_PX
		},

		frameStyle(crop) {
			return { width: `${this.scale(crop).cropWidthPx}px`, height: `${this.heightPx}px` }
		},

		shiftStyle(crop) {
			const vb = this.viewBoxes[crop.page]
			const px = this.scale(crop).pageWidthPx / vb.width
			return { transform: `translate(${-(crop.x - vb.minX) * px}px, ${-(crop.y - vb.minY) * px}px)` }
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

		/** Pedal, Bild↓ und Wischen: ein System weiter. */
		next() {
			this.goTo(this.current + 1)
		},

		previous() {
			this.goTo(this.current - 1)
		},

		onScroll() {
			const scroller = this.$refs.scroller
			const left = scroller.scrollLeft + scroller.clientWidth * LEAD
			let index = 0
			for (const [i, el] of [...scroller.children].entries()) {
				if (el.offsetLeft <= left + 1) {
					index = i
				}
			}
			this.current = index
		},

		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped>
.scoreview-band {
	display: flex;
	gap: 12px;
	height: 100%;
	overflow-x: auto;
	overflow-y: hidden;
	scroll-snap-type: x proximity;
	scroll-padding-inline-start: 8%;
	padding: 0 8px;
	box-sizing: border-box;
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
