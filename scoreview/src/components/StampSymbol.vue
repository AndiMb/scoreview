<template>
	<!--
		Ein Stempel als Zeichnung in Linienabstaenden: 1 Einheit = 1
		Linienabstand, Bezugspunkt (0,0) unten in der Mitte, das Symbol reicht
		nach oben. Wer es einsetzt, skaliert mit dem Linienabstand der Stelle
		(ScoreStamps.vue) oder mit einer festen Groesse (Palette) - dieselbe
		Zeichnung an beiden Orten, damit die Palette zeigt, was im Notenbild
		erscheint.
	-->
	<g class="stamp-symbol">
		<template v-if="stamp === 'breath'">
			<!-- Atemkomma -->
			<circle
				cx="0"
				cy="-1.85"
				r="0.42"
				class="stamp-fill" />
			<path d="M0.38,-1.8 Q0.55,-1.05 -0.3,-0.65" class="stamp-stroke" stroke-width="0.2" />
		</template>
		<template v-else-if="stamp === 'caesura'">
			<!-- Zaesur: zwei schraege Striche -->
			<path d="M-0.9,-0.2 L-0.15,-2.4 M0,-0.2 L0.75,-2.4" class="stamp-stroke" stroke-width="0.28" />
		</template>
		<template v-else-if="stamp === 'fermata'">
			<path d="M-1.3,-0.3 A1.3,1.3 0 0 1 1.3,-0.3" class="stamp-stroke" stroke-width="0.24" />
			<circle
				cx="0"
				cy="-0.55"
				r="0.26"
				class="stamp-fill" />
		</template>
		<template v-else-if="stamp === 'cue'">
			<!-- Einsatz: Pfeil nach unten auf die Note -->
			<path d="M0,-2.6 L0,-0.3 M-0.6,-1 L0,-0.25 L0.6,-1" class="stamp-stroke" stroke-width="0.24" />
		</template>
		<template v-else-if="stamp === 'attention'">
			<!-- Achtung: die Brille, das uebliche Bleistiftzeichen „schau hin" -->
			<circle
				cx="-0.75"
				cy="-0.95"
				r="0.58"
				class="stamp-stroke"
				stroke-width="0.2" />
			<circle
				cx="0.75"
				cy="-0.95"
				r="0.58"
				class="stamp-stroke"
				stroke-width="0.2" />
			<path d="M-0.18,-1.05 Q0,-1.3 0.18,-1.05" class="stamp-stroke" stroke-width="0.16" />
		</template>
		<!-- Dynamik und Tempo als kursiver Text, wie gedruckt. -->
		<text
			v-else-if="text"
			x="0"
			y="-0.35"
			text-anchor="middle"
			class="stamp-text"
			:class="{ 'stamp-text--dynamic': dynamic }"
			:font-size="fontSize">
			{{ text }}
		</text>
	</g>
</template>

<script>
/**
 * Was als Text erscheint. Das ist Notation, keine Oberflaeche: "mf" und
 * "rit." stehen in jeder Sprache so in den Noten - deshalb unuebersetzt
 * (wie Stimmennamen aus der Partitur, CLAUDE.md).
 */
const TEXTS = {
	pp: 'pp',
	p: 'p',
	mp: 'mp',
	mf: 'mf',
	f: 'f',
	ff: 'ff',
	cresc: 'cresc.',
	dim: 'dim.',
	rit: 'rit.',
	a_tempo: 'a tempo',
}

const DYNAMICS = new Set(['pp', 'p', 'mp', 'mf', 'f', 'ff'])

export default {
	name: 'StampSymbol',

	props: {
		// Code aus stampLayout.STAMP_CODES
		stamp: {
			type: String,
			required: true,
		},
	},

	computed: {
		text() {
			return TEXTS[this.stamp] ?? ''
		},

		dynamic() {
			return DYNAMICS.has(this.stamp)
		},

		// „a tempo" ist doppelt so lang wie „rit." - in derselben Groesse
		// ragte es ueber die Nachbarn hinaus.
		fontSize() {
			if (this.dynamic) {
				return 2.3
			}
			return this.text.length > 6 ? 1.2 : 1.6
		},
	},
}
</script>

<style scoped>
.stamp-fill {
	fill: currentcolor;
}

.stamp-stroke {
	fill: none;
	stroke: currentcolor;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.stamp-text {
	fill: currentcolor;
	font-family: Georgia, 'Times New Roman', serif;
	font-style: italic;
}

.stamp-text--dynamic {
	font-weight: bold;
}
</style>
