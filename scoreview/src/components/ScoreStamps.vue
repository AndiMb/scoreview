<template>
	<!--
		Eine SVG-Ebene mit der viewBox der Seite, deckungsgleich ueber dem
		Notenbild. Die Stempel liegen damit in denselben Einheiten wie die
		Noten und skalieren beim Zoomen mit ihnen - ohne dass hier
		jemand einen Zoomfaktor kennt.
	-->
	<svg
		v-if="viewBox && placed.length > 0"
		class="score-stamps"
		:viewBox="`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`"
		aria-hidden="false">
		<g
			v-for="(s, i) in placed"
			:key="`${s.id}-${i}`"
			class="score-stamp"
			:class="{ 'score-stamp--dimmed': s.dimmed }"
			:transform="`translate(${s.x} ${s.y}) scale(${s.space})`"
			:data-stamp="s.stamp"
			:data-id="s.id"
			@click.stop="$emit('stampClick', s.id)">
			<title>{{ titleOf(s) }}</title>
			<!-- Trefferflaeche: duenne Striche allein waeren kaum zu treffen. -->
			<rect
				x="-1.5"
				y="-2.8"
				width="3"
				height="3"
				class="score-stamp-hit" />
			<StampSymbol :stamp="s.stamp" />
			<!--
				Ohne gewaehlte Stimme steht der Name der Zielstimme dabei -
				sonst saehe man einen Stempel und wuesste nicht, ob er einen
				betrifft.
			-->
			<text
				v-if="s.dimmed && s.voices && s.voices.length"
				x="1.6"
				y="-0.4"
				font-size="1.1"
				class="score-stamp-voices">{{ s.voices.join(', ') }}</text>
		</g>
	</svg>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import StampSymbol from './StampSymbol.vue'
import { layoutStamps } from '../lib/stampLayout.js'

const t = (text, vars) => translate('scoreview', text, vars)

/**
 * Die Stempel einer Seite als Zeichnungen im Notenbild. Die Lage
 * rechnet lib/stampLayout.js; hier wird nur gezeichnet.
 */
export default {
	name: 'ScoreStamps',

	components: { StampSymbol },

	props: {
		// Stempel dieser Seite aus useAnnotations (stamps), noch ohne Lage.
		stamps: {
			type: Array,
			default: () => [],
		},

		// staffBands.groupBandsIntoSystems dieser Seite
		systems: {
			type: Array,
			default: () => [],
		},

		// Ob Notenzeilen Stimmen zugeordnet werden duerfen
		// (staffBands.canMapStavesToParts) - sonst steht ein Stempel fuer den
		// Tenor ueber dem System statt womoeglich ueber dem Bass.
		mappable: {
			type: Boolean,
			default: false,
		},

		viewBox: {
			type: Object,
			default: null,
		},
	},

	emits: ['stampClick'],

	computed: {
		placed() {
			return layoutStamps(this.stamps, this.systems, this.mappable)
		},
	},

	methods: {
		titleOf(s) {
			const name = stampName(s.stamp)
			const parts = [name]
			if (s.voices && s.voices.length > 0) {
				parts.push(t('for {voices}', { voices: s.voices.join(', ') }))
			}
			if (s.content) {
				parts.push(s.content)
			}
			return parts.join(' – ')
		},
	},
}

/**
 * Der Name eines Stempels zum Vorlesen und fuer den Tooltip - anders als das
 * Symbol selbst ist er Oberflaeche und wird uebersetzt.
 *
 * @param {string} code
 * @return {string}
 */
export function stampName(code) {
	const names = {
		breath: t('Breath mark'),
		caesura: t('Caesura'),
		pp: t('Pianissimo'),
		p: t('Piano'),
		mp: t('Mezzo piano'),
		mf: t('Mezzo forte'),
		f: t('Forte'),
		ff: t('Fortissimo'),
		cresc: t('Crescendo'),
		dim: t('Diminuendo'),
		cue: t('Cue'),
		attention: t('Attention'),
		fermata: t('Fermata'),
		rit: t('Ritardando'),
		a_tempo: t('A tempo'),
	}
	return names[code] ?? code
}
</script>

<style scoped>
.score-stamps {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	overflow: visible;
	/* Nur die Stempel selbst nehmen Klicks an - dazwischen geht der Tipp an
	   die Seite (Note anklicken, naechsten Stempel setzen). */
	pointer-events: none;
	z-index: 3;
}

.score-stamp {
	/* Ein Blaustift, wie in gedruckten Noten: vom Druck unterscheidbar, im
	   Hellen wie im Dunklen lesbar (lib/noteTheme.js setzt die Variable). */
	color: var(--scoreview-stamp, #1565c0);
	pointer-events: all;
	cursor: pointer;
}

.score-stamp--dimmed {
	opacity: 0.4;
}

.score-stamp-hit {
	fill: transparent;
}

.score-stamp-voices {
	fill: currentcolor;
	font-family: var(--font-face, sans-serif);
}
</style>
