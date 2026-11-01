<template>
	<!--
		Freehand drawings (E22) as an SVG layer with the page's viewBox, like
		the stamps: they scale with the notes without knowing the zoom.

		While drawing, the same layer takes the pointer: one stroke per press,
		in page units, and the strokes not yet saved are shown as they are
		drawn. Outside drawing mode only the strokes themselves take clicks -
		between them a tap still goes to the notes.
	-->
	<svg
		v-if="viewBox && (placed.length > 0 || drawMode)"
		ref="layer"
		class="score-drawings"
		:class="{ 'score-drawings--active': drawMode }"
		:viewBox="`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`"
		preserveAspectRatio="none"
		@pointerdown="onDown"
		@pointermove="onMove"
		@pointerup="onUp"
		@pointercancel="onCancel">
		<g
			v-for="d in placed"
			:key="d.id"
			class="score-drawing"
			:class="{ 'score-drawing--dimmed': d.dimmed }"
			:data-id="d.id"
			@click.stop="!drawMode && $emit('drawingClick', d.id)">
			<title>{{ d.title }}</title>
			<!-- A wider, invisible trace to hit: a pencil line alone is thin. -->
			<path :d="d.d" class="score-drawing-hit" :stroke-width="d.width * 6" />
			<path :d="d.d" class="score-drawing-line" :stroke-width="d.width" />
		</g>
		<path
			v-for="(s, i) in pendingPaths"
			:key="`pending-${i}`"
			class="score-drawing-line score-drawing-line--pending"
			:d="s"
			:stroke-width="penWidth" />
		<!-- The stroke under the pen: its `d` is written by the pen itself
			(paintLive), not bound - see onMove. -->
		<path
			v-if="drawing"
			ref="livePath"
			class="score-drawing-line score-drawing-line--pending"
			:stroke-width="penWidth" />
	</svg>
</template>

<script>
import { markRaw } from 'vue'
import { translate } from '../l10n.js'
import { layoutDrawings, pathOf, pathStep, PEN_SPACES } from '../lib/drawingLayout.js'
import { DEFAULT_SPACE } from '../lib/stampLayout.js'

const t = (text, vars) => translate('scoreview', text, vars)

/**
 * The drawings of one page, and the pen while drawing. The geometry is in
 * lib/drawingLayout.js; here it is drawn and the pointer is read.
 */
export default {
	name: 'ScoreDrawings',

	props: {
		// useAnnotations().drawings of this page, not yet placed
		drawings: {
			type: Array,
			default: () => [],
		},

		systems: {
			type: Array,
			default: () => [],
		},

		mappable: {
			type: Boolean,
			default: false,
		},

		viewBox: {
			type: Object,
			default: null,
		},

		// The pen is down: pointer input draws instead of reaching the page.
		drawMode: {
			type: Boolean,
			default: false,
		},

		// Strokes of this page not yet saved: arrays of {x, y} in page units.
		pendingStrokes: {
			type: Array,
			default: () => [],
		},
	},

	emits: ['drawingClick', 'stroke'],

	data() {
		return {
			// Whether a stroke is under the pen right now. Only this bit is
			// reactive; the stroke itself lives outside data() (created()).
			drawing: false,
		}
	},

	computed: {
		placed() {
			const byId = new Map(this.drawings.map((d) => [d.id, d]))
			return layoutDrawings(this.drawings, this.systems, this.mappable).map((d) => {
				const voices = byId.get(d.id)?.voices ?? []
				return { ...d, title: voices.length > 0 ? t('Drawing for {voices}', { voices: voices.join(', ') }) : t('Drawing') }
			})
		},

		/** The pen as wide as it will be once saved - one staff space as the measure. */
		penWidth() {
			const staff = this.systems?.[0]?.staves?.[0]
			const space = staff ? (staff.bottom - staff.top) / 4 : DEFAULT_SPACE
			return PEN_SPACES * space
		},

		pendingPaths() {
			return this.pendingStrokes.map((points) => pathOf(points))
		},
	},

	watch: {
		drawMode(on) {
			if (!on) {
				this.dropLive()
			}
		},
	},

	created() {
		/*
		 * The stroke being drawn: {pointerId, points, rect, d}. Not in data():
		 * a pointer sends up to 240 moves a second, and as reactive state each
		 * one copied the whole point array and re-serialised the whole path -
		 * quadratic in the length of the stroke. Here a move pushes a point,
		 * appends one path step and sets one attribute. `rect` is the layer's
		 * box from the pointerdown: reading it on every move forced a layout
		 * right after the previous frame's write.
		 */
		this.live = null
	},

	methods: {
		/**
		 * @param {{clientX:number, clientY:number}} event
		 * @param {DOMRect} rect the layer's box
		 * @return {{x:number, y:number}}
		 */
		toPage(event, rect) {
			return {
				x: this.viewBox.minX + ((event.clientX - rect.left) / rect.width) * this.viewBox.width,
				y: this.viewBox.minY + ((event.clientY - rect.top) / rect.height) * this.viewBox.height,
			}
		},

		onDown(event) {
			if (!this.drawMode || (event.pointerType === 'mouse' && event.button !== 0)) {
				return
			}
			// One finger draws; a second one is a pinch, not a stroke.
			if (this.live) {
				this.dropLive()
				return
			}
			const layer = this.$refs.layer
			if (!layer || !this.viewBox) {
				return
			}
			const rect = layer.getBoundingClientRect()
			if (!(rect.width > 0 && rect.height > 0)) {
				return
			}
			event.preventDefault()
			event.stopPropagation()
			layer.setPointerCapture?.(event.pointerId)
			const p = this.toPage(event, rect)
			this.live = { pointerId: event.pointerId, points: markRaw([p]), rect, d: pathStep(p, true) }
			this.drawing = true
			this.$nextTick(() => this.paintLive())
		},

		onMove(event) {
			const live = this.live
			if (!live || event.pointerId !== live.pointerId) {
				return
			}
			// The moves the browser merged into this event: a fast stroke
			// keeps its curve instead of turning into a polygon at frame rate.
			const coalesced = event.getCoalescedEvents?.()
			for (const e of coalesced?.length > 0 ? coalesced : [event]) {
				const p = this.toPage(e, live.rect)
				live.points.push(p)
				live.d += pathStep(p, false)
			}
			this.paintLive()
		},

		/** Writes the stroke so far into its path - one attribute, no patch. */
		paintLive() {
			if (this.live) {
				this.$refs.livePath?.setAttribute('d', this.live.d)
			}
		},

		onUp(event) {
			if (!this.live || event.pointerId !== this.live.pointerId) {
				return
			}
			event.stopPropagation()
			const points = this.live.points
			this.dropLive()
			this.$emit('stroke', points)
		},

		onCancel() {
			this.dropLive()
		},

		dropLive() {
			this.live = null
			this.drawing = false
		},
	},
}
</script>

<style scoped>
.score-drawings {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	overflow: visible;
	pointer-events: none;
	/* Over the stamps: a drawing is the last thing put on the page. */
	z-index: 4;
}

/* Drawing: the whole page takes the pen, and a finger draws instead of
   scrolling. */
.score-drawings--active {
	pointer-events: all;
	touch-action: none;
	cursor: crosshair;
}

.score-drawing {
	/* The same blue pencil as the stamps (lib/noteTheme.js sets it). */
	color: var(--scoreview-stamp, #1565c0);
	pointer-events: all;
	cursor: pointer;
}

.score-drawings--active .score-drawing {
	pointer-events: none;
}

.score-drawing--dimmed {
	opacity: 0.4;
}

.score-drawing-hit {
	fill: none;
	stroke: transparent;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.score-drawing-line {
	fill: none;
	stroke: currentcolor;
	stroke-linecap: round;
	stroke-linejoin: round;
	pointer-events: none;
}

.score-drawing-line--pending {
	color: var(--scoreview-stamp, #1565c0);
	opacity: 0.8;
}
</style>
