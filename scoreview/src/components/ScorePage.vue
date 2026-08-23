<template>
	<div ref="root" class="score-page" :style="pageStyle" @click="onClick">
		<div v-if="svgMarkup" class="score-page-svg" v-html="svgMarkup" />
		<div v-if="cursorStyle" class="score-page-cursor" :style="cursorStyle" />
		<div
			v-for="marker in pageMarkers"
			:key="marker.id"
			class="score-page-marker"
			:style="marker.style"
			:title="'Notiz'"
			@click.stop="$emit('marker-click', marker.id)" />
	</div>
</template>

<script>
import axios from '@nextcloud/axios'
import { parseViewBox, sanitizeSvg } from '../lib/scoreLayout.js'

/**
 * Eine Seite als eingebettetes SVG (E2: MuseScore-eigenes Rendering statt
 * OSMD-Neusatz - siehe PLAN.md). Lädt lazy per IntersectionObserver
 * ("sichtbare Seiten bevorzugt laden, nicht alle auf einmal", Phase 8),
 * nicht alle Seiten sofort beim Öffnen.
 *
 * Der Cursor ist ein reines CSS-Overlay in Prozent-Koordinaten relativ zur
 * eigenen viewBox (siehe scoreLayout.js/parseViewBox) - kein
 * Renderer-interner Zustand (PLAN.md Abschnitt 2).
 */
export default {
	name: 'ScorePage',

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
		// Stufenloser Zoom (Phase 10, "über die SVG-Skalierung") - 1 =
		// Standardbreite, skaliert die max-width linear.
		zoom: {
			type: Number,
			default: 1,
		},
		// Notiz-Marker (Phase 11): {id, page, x, y, w, h} in SVG-Einheiten,
		// unabhängig von der Seite gefiltert - siehe pageMarkers.
		markers: {
			type: Array,
			default: () => [],
		},
	},

	emits: ['note-click', 'marker-click'],

	data() {
		return {
			svgMarkup: null,
			viewBox: null,
		}
	},

	computed: {
		pageStyle() {
			// Reserviert die Seitenhöhe schon vor dem Laden (A4-Hochformat als
			// grobe Näherung, siehe PLAN.md E2 - "A4 ist das native
			// Seitenformat") - verhindert Scroll-Sprünge beim Nachladen weiter
			// unten liegender Seiten.
			const box = this.viewBox
			return {
				aspectRatio: box ? `${box.width} / ${box.height}` : '210 / 297',
				maxWidth: `${900 * this.zoom}px`,
			}
		},

		cursorStyle() {
			const rect = this.cursorRect
			const box = this.viewBox
			if (!rect || !box || rect.page !== this.pageIndex) {
				return null
			}
			return {
				left: `${((rect.x - box.minX) / box.width) * 100}%`,
				top: `${((rect.y - box.minY) / box.height) * 100}%`,
				width: `${(rect.w / box.width) * 100}%`,
				height: `${(rect.h / box.height) * 100}%`,
			}
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
					style: {
						left: `${((m.x - box.minX) / box.width) * 100}%`,
						top: `${((m.y - box.minY) / box.height) * 100}%`,
					},
				}))
		},
	},

	mounted() {
		this.observer = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) {
				this.load()
			}
		}, { rootMargin: '600px 0px' })
		this.observer.observe(this.$refs.root)
	},

	beforeUnmount() {
		this.observer?.disconnect()
	},

	methods: {
		async load() {
			if (this.svgMarkup) {
				return
			}
			this.observer?.disconnect()
			const res = await axios.get(this.svgUrl, { responseType: 'text' })
			this.viewBox = parseViewBox(res.data)
			this.svgMarkup = sanitizeSvg(res.data)
		},

		// Umkehrung von M4 (Koordinate -> elid, Phase 10 "Klick auf eine Note
		// springt dorthin"): rechnet die Klickposition in SVG-Einheiten dieser
		// Seite um und reicht sie an ScoreViewer.vue weiter, die dort per
		// findElementAtPoint()/findNearestOccurrenceTimeMs() (scoreLayout.js)
		// aufgelöst wird - diese Komponente kennt die Notenkoordinaten selbst
		// nicht (nur ihre eigene viewBox).
		onClick(event) {
			if (!this.viewBox) {
				return
			}
			const rect = this.$refs.root.getBoundingClientRect()
			const fracX = (event.clientX - rect.left) / rect.width
			const fracY = (event.clientY - rect.top) / rect.height
			this.$emit('note-click', {
				page: this.pageIndex,
				x: this.viewBox.minX + fracX * this.viewBox.width,
				y: this.viewBox.minY + fracY * this.viewBox.height,
			})
		},
	},
}
</script>

<style scoped>
.score-page {
	position: relative;
	width: 100%;
	margin: 0 auto 16px auto;
	background: #fff;
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
	cursor: pointer;
}

.score-page-svg {
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

.score-page-cursor {
	position: absolute;
	background: rgba(0, 130, 201, 0.25);
	border: 1px solid rgba(0, 130, 201, 0.7);
	border-radius: 2px;
	pointer-events: none;
	transition: left 0.08s linear, top 0.08s linear;
}

.score-page-marker {
	position: absolute;
	width: 14px;
	height: 14px;
	margin-left: -7px;
	margin-top: -7px;
	background: var(--color-warning, orange);
	border: 2px solid #fff;
	border-radius: 50%;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
	cursor: pointer;
	z-index: 2;
}
</style>
