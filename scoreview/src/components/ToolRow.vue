<template>
	<!--
		Eine Zeile in einer Werkzeuggruppe (ToolGroup.vue): Symbol, Name, rechts
		der aktuelle Wert („♩ 80", „12–16") und bei Unterseiten ein Pfeil.
		Der Wert steht in der Zeile, weil er vorher auf dem Knopf in der
		Leiste stand - wer die Gruppe oeffnet, sieht ihn ohne weiteren Tipp.
		The pin (E23) sits next to the row, not inside it: a button inside a
		button is not allowed, and it is a second, separate target.
	-->
	<div class="scoreview-tool-row-wrap">
		<button
			type="button"
			class="scoreview-tool-row"
			:class="{ 'scoreview-tool-row--pressed': pressed }"
			:aria-pressed="page ? undefined : String(pressed)"
			@click="$emit('click', $event)">
			<span class="scoreview-tool-row-icon"><slot name="icon" /></span>
			<span class="scoreview-tool-row-label">{{ label }}</span>
			<span v-if="value" class="scoreview-tool-row-value">{{ value }}</span>
			<ChevronRight v-if="page" class="scoreview-tool-row-chevron" :size="20" />
		</button>
		<ToolPin
			v-if="pinnable"
			:label="label"
			:pinned="pinned"
			:disabled="pinDisabled"
			@pin="$emit('pin')" />
	</div>
</template>

<script>
import ChevronRight from 'vue-material-design-icons/ChevronRight.vue'
import ToolPin from './ToolPin.vue'

export default {
	name: 'ToolRow',

	components: {
		ChevronRight,
		ToolPin,
	},

	props: {
		label: {
			type: String,
			required: true,
		},

		value: {
			type: String,
			default: '',
		},

		// Fuehrt auf eine Unterseite (Pfeil) statt direkt etwas zu tun.
		page: {
			type: Boolean,
			default: false,
		},

		// Fuer Zeilen, die ein Panel auf- und zumachen: ob es offen ist.
		// Zeilen mit Unterseite sind kein Schalter und tragen kein aria-pressed.
		pressed: {
			type: Boolean,
			default: false,
		},

		// The pin (ToolPin.vue): whether the row offers one, its state, and
		// whether the limit is reached.
		pinnable: {
			type: Boolean,
			default: false,
		},

		pinned: {
			type: Boolean,
			default: false,
		},

		pinDisabled: {
			type: Boolean,
			default: false,
		},
	},

	emits: ['click', 'pin'],
}
</script>

<style scoped>
.scoreview-tool-row-wrap {
	display: flex;
	align-items: center;
	gap: 2px;
}

.scoreview-tool-row {
	display: flex;
	align-items: center;
	gap: 10px;
	flex: 1 1 auto;
	min-inline-size: 0;
	min-block-size: var(--default-clickable-area);
	margin: 0;
	padding: 0 8px;
	border: none;
	border-radius: var(--border-radius-element, 8px);
	background: transparent;
	color: var(--color-main-text);
	font: inherit;
	text-align: start;
	cursor: pointer;
}

.scoreview-tool-row:hover,
.scoreview-tool-row:focus-visible {
	background: var(--color-background-hover);
}

.scoreview-tool-row:focus-visible {
	outline: 2px solid var(--color-main-text);
	outline-offset: -2px;
}

.scoreview-tool-row--pressed {
	background: var(--color-primary-element-light);
}

.scoreview-tool-row-icon {
	display: inline-flex;
	flex: 0 0 auto;
}

.scoreview-tool-row-label {
	flex: 1 1 auto;
}

.scoreview-tool-row-value {
	flex: 0 0 auto;
	color: var(--color-text-maxcontrast);
	font-variant-numeric: tabular-nums;
}

.scoreview-tool-row-chevron {
	flex: 0 0 auto;
	color: var(--color-text-maxcontrast);
}
</style>
