<template>
	<!--
		The pin at the end of a tool row (E23): pins the tool to the bar or
		takes it off again. Right in the row and not on a settings page of its
		own - it stands where someone is using the tool and notices they need
		it all the time.
	-->
	<button
		type="button"
		class="scoreview-tool-pin"
		:class="{ 'scoreview-tool-pin--pinned': pinned }"
		:disabled="disabled && !pinned"
		:aria-pressed="String(pinned)"
		:aria-label="title"
		:title="title"
		@click.stop="$emit('pin')">
		<Pin v-if="pinned" :size="18" />
		<PinOutline v-else :size="18" />
	</button>
</template>

<script>
import Pin from 'vue-material-design-icons/Pin.vue'
import PinOutline from 'vue-material-design-icons/PinOutline.vue'
import { translate } from '../l10n.js'
import { MAX_PINS } from '../lib/barGroups.js'

export default {
	name: 'ToolPin',

	components: {
		Pin,
		PinOutline,
	},

	props: {
		// The tool's name, for the screen reader: "Pin Mixer to the bar".
		label: {
			type: String,
			required: true,
		},

		pinned: {
			type: Boolean,
			default: false,
		},

		// The limit is reached (lib/barGroups.js pinLimitReached); a pinned
		// tool can still be taken off.
		disabled: {
			type: Boolean,
			default: false,
		},
	},

	emits: ['pin'],

	computed: {
		title() {
			if (this.pinned) {
				return this.t('Unpin {tool} from the bar', { tool: this.label })
			}
			if (this.disabled) {
				return this.t('At most {n} tools can be pinned to the bar', { n: MAX_PINS })
			}
			return this.t('Pin {tool} to the bar', { tool: this.label })
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
.scoreview-tool-pin {
	display: inline-flex;
	flex: 0 0 auto;
	align-items: center;
	justify-content: center;
	inline-size: var(--default-clickable-area);
	block-size: var(--default-clickable-area);
	margin: 0;
	padding: 0;
	border: none;
	border-radius: var(--border-radius-element, 8px);
	background: transparent;
	color: var(--color-text-maxcontrast);
	cursor: pointer;
}

.scoreview-tool-pin:hover,
.scoreview-tool-pin:focus-visible {
	background: var(--color-background-hover);
	color: var(--color-main-text);
}

.scoreview-tool-pin:focus-visible {
	outline: 2px solid var(--color-main-text);
	outline-offset: -2px;
}

.scoreview-tool-pin--pinned {
	color: var(--color-primary-element);
}

.scoreview-tool-pin:disabled {
	opacity: 0.4;
	cursor: default;
}
</style>
