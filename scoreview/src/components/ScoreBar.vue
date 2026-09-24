<template>
	<!--
		Eingefahrene Leiste: Im Vollbild zieht sie sich waehrend der
		Wiedergabe auf eine Fortschrittslinie zusammen (useBarLayout.js) - auf
		dem Notenstaender zaehlt jede Zeile Noten. Bewusst NICHT ganz
		ausgeblendet mit "Tippen holt sie zurueck": Ein Tipp auf die Partitur
		springt bereits an die getippte Note (onNoteClick im Viewer), zwei
		Bedeutungen fuer dieselbe Geste waeren ein Fehler. Die Linie ist
		eindeutig anzutippen und verraet weiter die Position.
	-->
	<button
		v-if="collapsed"
		type="button"
		class="scoreview-bar-line"
		:aria-label="t('Show playback controls')"
		:title="t('Show playback controls')"
		@click="$emit('show')">
		<LiveValue v-slot="{ value }" :get="readProgress">
			<span class="scoreview-bar-line-fill" :style="{ inlineSize: value + '%' }" />
		</LiveValue>
	</button>
	<!--
		EINE Leiste, und zwar ausserhalb des Scroll-Bereichs. Als
		Geschwister eines eigenen Scroll-Elements ist "wegscrollen"
		strukturell unmoeglich - und der z-index-Wettlauf gegen die
		SVG-Seiten entfaellt.

		Zwei Streifen statt einer Knopfreihe: Auf Telefonbreite
		brauchte die volle Reihe rechnerisch ~780px (14 Bedienelemente
		bei 44px Touch-Zielgroesse) und brach damit auf drei Zeilen um -
		dauerhaft rund 18% der Bildschirmhoehe, auch im Vollbild.
		Draussen bleibt jetzt nur, was waehrend des Singens gebraucht
		wird; die Werkzeuge kommen auf Abruf. Auf breiten Schirmen
		stehen beide Streifen nebeneinander, dort aendert sich nichts.

		Die Knoepfe selbst kommen als Slots aus dem Viewer - dort sind sie
		verdrahtet. Hier steht nur, WIE die Leiste steht.

		Ob breit oder kompakt, entscheidet der Platz im Transport
		(lib/barFit.js): Laeuft sein Inhalt ueber, meldet die Leiste das
		(`overflow`) und wird kompakt - noch bevor der Ueberlauf gezeichnet
		wird, der sonst unter den Werkzeugen laege.
	-->
	<div
		v-else
		class="scoreview-bar"
		:class="{ 'scoreview-bar--compact': compact }"
		@pointerdown="$emit('activity')">
		<div :ref="setTransportEl" class="scoreview-bar-transport">
			<slot name="transport" />
			<!--
				Der Zugang zu den Werkzeugen auf schmalen Schirmen. Der
				Punkt daran ist nicht Zierde: Laeuft das Metronom oder
				ist ein Loop aktiv, muss das sichtbar bleiben, ohne das
				Menue zu oeffnen - sonst sucht jemand mitten in der
				Probe nach einem Klick, den er nicht abstellen kann.
			-->
			<NcButton
				v-if="compact"
				class="scoreview-more"
				:pressed="toolsOpen"
				:aria-label="t('Tools')"
				:title="t('Tools')"
				@click="$emit('update:toolsOpen', !toolsOpen)">
				<template #icon>
					<span class="scoreview-more-icon">
						<DotsHorizontal :size="20" />
						<span v-if="anyToolActive && !toolsOpen" class="scoreview-more-dot" />
					</span>
				</template>
			</NcButton>
		</div>
		<div v-if="!compact || toolsOpen" class="scoreview-bar-tools">
			<slot name="tools" />
		</div>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import DotsHorizontal from 'vue-material-design-icons/DotsHorizontal.vue'
import LiveValue from './LiveValue.vue'

export default {
	name: 'ScoreBar',

	components: {
		DotsHorizontal,
		LiveValue,
		NcButton,
	},

	props: {
		// Die Gestalt der Leiste - gerechnet in useBarLayout.js.
		collapsed: {
			type: Boolean,
			required: true,
		},

		compact: {
			type: Boolean,
			required: true,
		},

		// Werkzeuge auf schmalen Schirmen ausgeklappt, als v-model:toolsOpen.
		toolsOpen: {
			type: Boolean,
			required: true,
		},

		// Ob irgendein Werkzeug aktiv ist - der Punkt am „Mehr"-Knopf.
		anyToolActive: {
			type: Boolean,
			required: true,
		},

		// Die Position in Prozent als FUNKTION: Sie aendert sich in jedem
		// Frame und wird nur von LiveValue gelesen (siehe dort).
		readProgress: {
			type: Function,
			required: true,
		},
	},

	// `show`: die eingefahrene Linie wurde angetippt. `activity`: in der
	// Leiste wurde bedient - die Ruhefrist bis zum Einfahren beginnt neu.
	// `overflow`: ob der Transport der BREITEN Leiste ueberlaeuft
	// (useBarLayout.reportOverflow).
	emits: ['show', 'activity', 'update:toolsOpen', 'overflow'],

	// Neu gerendert heisst oft: anderer Inhalt (Mikrofonanzeige,
	// Auffuehrungsmodus, der Versuch in breiter Gestalt). Die Slots rendern
	// hier, ihre Abhaengigkeiten zaehlen also zu dieser Komponente - und der
	// ResizeObserver meldet sich nur, wenn sich die GROESSE des Streifens
	// aendert, nicht sein Inhalt. Gemessen wird nach dem Rendern und vor dem
	// Zeichnen.
	updated() {
		this.reportOverflow()
	},

	beforeUnmount() {
		this.setTransportEl(null)
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		/**
		 * Den Transport beobachten, solange er steht - als Funktions-Ref,
		 * weil er mit dem Einfahren im Vollbild verschwindet und wiederkommt.
		 *
		 * @param {?Element} el
		 */
		setTransportEl(el) {
			if (el === this.transportEl) {
				return
			}
			this.overflowObserver?.disconnect()
			this.overflowObserver = null
			this.transportEl = el
			if (!el || typeof ResizeObserver === 'undefined') {
				return
			}
			this.overflowObserver = new ResizeObserver(() => this.reportOverflow())
			this.overflowObserver.observe(el)
		},

		/**
		 * Ueberlauf statt Umbruch: Der Transport ist ein Container
		 * (`container-type: inline-size`, fuer die Abfragen im Viewer), und
		 * ein solcher hat fuer Flexbox keine Eigenbreite - er wird beliebig
		 * zusammengedrueckt, statt die Leiste umbrechen zu lassen, und sein
		 * Inhalt ragt dann unter die Werkzeuge. Genau das zeigt scrollWidth.
		 * Der Suchlauf gibt vorher bis auf seine Mindestbreite nach,
		 * ueberlaufen heisst also wirklich: kein Platz mehr.
		 */
		reportOverflow() {
			const el = this.transportEl
			if (!el) {
				return
			}
			this.$emit('overflow', !this.compact && el.scrollWidth > el.clientWidth + 1)
		},
	},
}
</script>

<style scoped>
/*
 * Zwei Streifen: Transport (immer) und Werkzeuge (auf schmalen Schirmen nur
 * auf Abruf). Auf breiten Schirmen stehen beide nebeneinander und ergeben
 * dieselbe eine Zeile wie zuvor.
 */
.scoreview-bar {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 8px;
	border-bottom: 1px solid var(--color-border);
	background: var(--color-main-background);
}

.scoreview-bar-transport,
.scoreview-bar-tools {
	display: flex;
	align-items: center;
	gap: 6px;
}

/* Der Transport bekommt den Platz, den der Suchlauf braucht; die Werkzeuge
   sind so breit, wie sie sind. */
.scoreview-bar-transport {
	flex: 1 1 auto;
	min-width: 0;
}

.scoreview-bar-tools {
	flex: 0 0 auto;
}

/*
 * Schmal: die Werkzeuge unter den Transport, und nur, wenn sie geholt wurden.
 * Sie duerfen dann umbrechen - im aufgeklappten Zustand ist Hoehe kein
 * Problem, dauerhaft war sie es.
 */
.scoreview-bar--compact {
	flex-direction: column;
	align-items: stretch;
}

.scoreview-bar--compact .scoreview-bar-tools {
	flex-wrap: wrap;
	justify-content: flex-start;
	padding-block-start: 4px;
	border-block-start: 1px solid var(--color-border);
}

/* Der Punkt am „Mehr"-Knopf: ein aktives Werkzeug muss sichtbar bleiben,
   auch wenn sein Schalter im Menue steckt. */
.scoreview-more-icon {
	position: relative;
	display: inline-flex;
}

.scoreview-more-dot {
	position: absolute;
	inset-block-start: -2px;
	inset-inline-end: -2px;
	inline-size: 8px;
	block-size: 8px;
	border-radius: 50%;
	background: var(--color-primary-element);
}

/*
 * Die eingefahrene Leiste im Vollbild. Bewusst als Knopf und nicht als reine
 * Linie: Sie ist anzutippen, und Vorlesewerkzeuge sollen das auch so
 * ankuendigen.
 */
.scoreview-bar-line {
	flex: 0 0 auto;
	display: block;
	inline-size: 100%;
	block-size: 8px;
	padding: 0;
	border: none;
	border-radius: 0;
	background: var(--color-background-dark);
	cursor: pointer;
}

.scoreview-bar-line-fill {
	display: block;
	block-size: 100%;
	background: var(--color-primary-element);
}

/*
 * Die Breite des Transportstreifens ist der Bezug fuer die Container-Abfrage
 * im Viewer (Suchlauf und Taktsumme weichen auf den schmalsten Telefonen) -
 * an der Breite des Streifens statt an der des Fensters, weil der Viewer
 * auch in einem schmalen Rahmen stecken kann.
 */
.scoreview-bar-transport {
	container-type: inline-size;
}

.scoreview-bar--compact .scoreview-bar-transport {
	gap: 4px;
}
</style>
