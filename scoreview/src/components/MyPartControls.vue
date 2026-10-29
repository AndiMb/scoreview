<template>
	<!--
		„Meine Stimme" waehlen, wechseln oder aufheben (issue #18), neben dem
		Stimmensymbol im Mixer. Den Mixer gibt es ohne Ton nicht, Hervorhebung,
		Tonnamen, Zaehlzeiten und Druck benutzen die Wahl aber ebenso - die
		Stimmen kommen deshalb aus der Partitur (meta.parts), nicht aus den
		Mixerkanaelen.
	-->
	<fieldset class="scoreview-popover-group">
		<!-- The card says it already (ScorePanel title); the legend is for screen readers. -->
		<legend class="hidden-visually">
			{{ t('My part') }}
		</legend>
		<NcCheckboxRadioSwitch
			v-for="part in options"
			:key="part.value"
			:modelValue="selected"
			type="radio"
			name="scoreview-my-part"
			:value="part.value"
			@update:modelValue="choose">
			{{ part.label }}
		</NcCheckboxRadioSwitch>
	</fieldset>
</template>

<script>
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import { translate } from '../l10n.js'

// Radio values are text; "none" cannot clash with a part id, which is a number
// in meta.json and its text on the server.
const NONE = ''

export default {
	name: 'MyPartControls',

	components: { NcCheckboxRadioSwitch },

	props: {
		// meta.parts: [{id, name}] in score order
		parts: {
			type: Array,
			required: true,
		},

		partId: {
			type: [String, Number],
			default: null,
		},
	},

	emits: ['update:partId'],

	computed: {
		options() {
			return [
				...this.parts.map((part) => ({ value: String(part.id), label: part.name || String(part.id) })),
				{ value: NONE, label: this.t('None') },
			]
		},

		selected() {
			return this.partId === null || this.partId === undefined ? NONE : String(this.partId)
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		/**
		 * @param {string} value
		 */
		choose(value) {
			this.$emit('update:partId', value === NONE ? null : value)
		},
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>
