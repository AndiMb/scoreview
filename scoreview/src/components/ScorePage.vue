<template>
	<div ref="root" class="score-page" :style="pageStyle" @click="onClick">
		<!--
			Overlay HINTER dem Notenbild (siehe PLAN.md M9): das SVG hat keine
			id-Attribute, mit denen sich der Notenkopf selbst einfärben ließe,
			daher bleibt es beim Cursor-Overlay - jetzt aber hinter statt vor dem
			Notenbild, damit es keinen Notenkopf verdeckt. Die Stapelreihenfolge
			kommt aus dem CSS (.score-page-svg bekommt ein explizites z-index),
			nicht aus dieser Template-Reihenfolge - siehe Kommentar dort. Nur
			messbar/anfassbar über ref="cursor" (siehe getCursorClientRect()).
		-->
		<div v-if="cursorStyle" ref="cursor" class="score-page-cursor" :style="cursorStyle" />
		<div v-if="svgMarkup" class="score-page-svg" v-html="svgMarkup" />
		<div
			v-for="marker in pageMarkers"
			:key="marker.id"
			class="score-page-marker"
			:class="{ 'score-page-marker--shared': marker.visibility === 'shared' }"
			:style="marker.style"
			:title="t('Note')"
			@click.stop="$emit('marker-click', marker.id)" />
		<!--
			Sichtbare Loop-Bereichsmarkierung (Phase 17) - zwei schmale, farbige
			Flaggen an Start-/Ende-Takt statt eines vollflächigen Bereichs:
			measures.json liefert nur Punktkoordinaten je Takt (M4), keine
			Taktbreite, ein Vollbereich wäre also erfunden.
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
import { BASE_PAGE_WIDTH_PX, parseSvgSizeMm, parseViewBox } from '../lib/scoreLayout.js'
import { sanitizeSvg } from '../lib/svgSanitizer.js'

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
		// Loop-Bereichsmarkierung (Phase 17): {id, kind:'start'|'end', page, x,
		// y, w, h}, siehe pageLoopMarkers.
		loopMarkers: {
			type: Array,
			default: () => [],
		},
	},

	emits: ['note-click', 'marker-click', 'loaded'],

	data() {
		return {
			svgMarkup: null,
			viewBox: null,
			sizeMm: null,
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
				// Echte Breite statt `width: 100%` + `max-width` (Phase 22):
				// mit der alten Fassung war die Containerbreite eine harte
				// Obergrenze - `900 * zoom` wirkte nur, solange es KLEINER als
				// der Container war. Hineinzoomen und schieben (der Normalfall
				// am Tablet) ging damit gar nicht. Die Zoomstufe legt die
				// Breite jetzt allein fest; der Scroll-Container in
				// ScoreViewer.vue erlaubt dafür waagerechtes Scrollen, und
				// "Seitenbreite" ist dort der Startwert, damit sich nichts
				// ändert, solange niemand selbst zoomt.
				width: `${BASE_PAGE_WIDTH_PX * this.zoom}px`,
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
					visibility: m.visibility,
					style: {
						left: `${((m.x - box.minX) / box.width) * 100}%`,
						top: `${((m.y - box.minY) / box.height) * 100}%`,
					},
				}))
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
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		async load() {
			if (this.svgMarkup) {
				return
			}
			this.observer?.disconnect()
			const res = await axios.get(this.svgUrl, { responseType: 'text' })
			this.viewBox = parseViewBox(res.data)
			this.sizeMm = parseSvgSizeMm(res.data)
			this.svgMarkup = sanitizeSvg(res.data)
			// Für die Zoom-Presets (Phase 16, "Seitenbreite/ganze Seite/100%") -
			// ScoreViewer.vue kennt die Seitengeometrie selbst nicht, nur die
			// jeweils geladene ScorePage.
			this.$emit('loaded', { index: this.pageIndex, viewBox: this.viewBox, sizeMm: this.sizeMm })
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

		// Für den Autoscroll (Phase 16, src/lib/scrollPlan.js): der Aufrufer
		// (ScoreViewer.vue) kennt nur ein SVG-Rechteck (page/x/y/w/h), nicht die
		// tatsächliche Bildschirmposition des gerenderten Cursor-Overlays -
		// getBoundingClientRect() liefert genau die, inklusive Zoom/Scroll, ohne
		// dass ScoreViewer.vue selbst rechnen müsste. null, solange kein Cursor
		// auf dieser Seite gerendert ist (siehe cursorStyle).
		getCursorClientRect() {
			return this.$refs.cursor?.getBoundingClientRect() ?? null
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

.score-page-svg {
	/*
	 * position+z-index (nicht die DOM-Reihenfolge im Template) entscheidet
	 * hier über die Stapelreihenfolge: ein absolut positioniertes Element
	 * (score-page-cursor) malt CSS-spezifikationsgemäß immer NACH
	 * nicht-positionierten Elementen, unabhängig von der DOM-Reihenfolge -
	 * ohne dieses z-index läge der Cursor also trotz der Template-Reihenfolge
	 * weiter oben, nicht hinter dem Notenbild (PLAN.md Phase 16/M9).
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
 * Hintergrundrechteck über die volle viewBox (siehe PLAN.md M9) - ohne
 * diese Regel würde es den dahinterliegenden Cursor vollständig verdecken.
 * path[class=""] ist laut M9 im ganzen Dokument eindeutig nur dieses eine
 * Element (kein id-Attribut vorhanden, das sich sonst anbieten würde).
 * :deep() aus demselben Grund wie oben (v-html, kein Scoped-Attribut).
 */
.score-page-svg :deep(path[class=""]) {
	fill: none;
}

/*
 * Rechteck statt Ellipse (Nutzer-Feedback nach Phase 16: eine hochskalierte
 * Ellipse ragte deutlich über das eigentliche System hinaus). Das Overlay
 * liegt hinter dem Notenbild (siehe .score-page-svg oben) und darf den
 * Notenkopf deshalb ohne Weichzeichnung markieren - die Notenlinien werden
 * ohnehin vom SVG darüber gezeichnet, kein Scale-Trick nötig.
 */
.score-page-cursor {
	position: absolute;
	background: rgba(0, 130, 201, 0.25);
	border: 1px solid rgba(0, 130, 201, 0.7);
	border-radius: 2px;
	pointer-events: none;
	transition: left 0.08s linear, top 0.08s linear;
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
 * Geteilte Notizen bekommen eine eigene Farbe (Phase 18: "eigene und
 * geteilte Notizen unterscheidbar, Markerfarbe") - dieselbe Primärfarbe wie
 * der linke Akzentbalken in ScoreAnnotations.vue, damit Notenbild und Liste
 * dieselbe Sprache sprechen.
 */
.score-page-marker--shared {
	background: var(--color-primary-element, #0082c9);
}
</style>
