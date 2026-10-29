<template>
	<!--
		The needle of the tuner: -50 … +50 cents on a scale, the pointer as
		an SVG line whose position is an ATTRIBUTE. A style change in Files
		costs a style recalculation over the whole page (ScorePage.vue,
		cursor layer, measured); a geometry attribute of an SVG element does
		not.
	-->
	<svg
		class="scoreview-tuner-needle"
		:class="`scoreview-tuner-needle--${cls}`"
		viewBox="0 0 220 44"
		role="img"
		:aria-label="label">
		<line
			class="scoreview-tuner-needle-axis"
			x1="10"
			y1="30"
			x2="210"
			y2="30" />
		<line
			v-for="tick in ticks"
			:key="tick.cents"
			class="scoreview-tuner-needle-tick"
			:x1="tick.x"
			:y1="tick.major ? 22 : 26"
			:x2="tick.x"
			y2="34" />
		<line
			class="scoreview-tuner-needle-zero"
			x1="110"
			y1="16"
			x2="110"
			y2="38" />
		<line
			v-if="cents !== null"
			class="scoreview-tuner-needle-pointer"
			:x1="pointerX"
			y1="6"
			:x2="pointerX"
			y2="40" />
	</svg>
</template>

<script>
import { translate } from '../l10n.js'
import { formatCents } from '../lib/intonation.js'

export default {
	name: 'TunerNeedle',

	props: {
		// null = nothing to show (silence)
		cents: {
			type: Number,
			default: null,
		},

		// green | yellow | red | na (lib/intonation.js classify)
		cls: {
			type: String,
			default: 'na',
		},
	},

	computed: {
		ticks() {
			const out = []
			for (let c = -50; c <= 50; c += 10) {
				out.push({ cents: c, x: 110 + c * 2, major: c % 50 === 0 || c === 0 })
			}
			return out
		},

		pointerX() {
			const c = Math.max(-50, Math.min(50, this.cents ?? 0))
			return 110 + c * 2
		},

		label() {
			return this.cents === null ? this.t('No tone') : this.t('{cents} cents', { cents: formatCents(this.cents) })
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped>
.scoreview-tuner-needle {
	inline-size: 100%;
	max-inline-size: 320px;
	block-size: auto;
	display: block;
}

.scoreview-tuner-needle-axis,
.scoreview-tuner-needle-tick {
	stroke: var(--color-border-maxcontrast, #949494);
	stroke-width: 1;
}

.scoreview-tuner-needle-zero {
	stroke: var(--color-main-text);
	stroke-width: 2;
}

.scoreview-tuner-needle-pointer {
	stroke: var(--scoreview-tuner-color, var(--color-main-text));
	stroke-width: 3;
	stroke-linecap: round;
}

.scoreview-tuner-needle--green {
	--scoreview-tuner-color: var(--scoreview-intonation-green, #2e7d32);
}

.scoreview-tuner-needle--yellow {
	--scoreview-tuner-color: var(--scoreview-intonation-yellow, #f9a825);
}

.scoreview-tuner-needle--red {
	--scoreview-tuner-color: var(--scoreview-intonation-red, #c62828);
}
</style>
