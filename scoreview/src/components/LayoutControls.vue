<template>
	<!--
		Die Darstellung (H2/H8): Seiten, Systemband oder Liedtext. Was die
		Artefakte nicht hergeben, steht ausgegraut da und sagt warum (N3) -
		statt still zu fehlen oder still auf Seiten zurueckzufallen.
	-->
	<div class="scoreview-controls">
		<fieldset class="scoreview-popover-group">
			<legend>{{ t('Layout') }}</legend>
			<template v-for="option in options" :key="option.value">
				<NcCheckboxRadioSwitch
					:modelValue="layout"
					type="radio"
					:value="option.value"
					name="scoreview-layout"
					:disabled="option.reason !== ''"
					@update:modelValue="$emit('update:layout', $event)">
					{{ option.label }}
				</NcCheckboxRadioSwitch>
				<p v-if="option.reason" class="scoreview-popover-hint">
					{{ option.reason }}
				</p>
			</template>
		</fieldset>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'

export default {
	name: 'LayoutControls',

	components: {
		NcCheckboxRadioSwitch,
	},

	props: {
		// 'pages' | 'band' | 'lyrics'
		layout: {
			type: String,
			required: true,
		},

		// Warum es die Liedtext-Ansicht nicht gibt, sonst leer
		lyricsUnavailable: {
			type: String,
			default: '',
		},
	},

	emits: ['update:layout'],

	computed: {
		options() {
			return [
				{ value: 'pages', label: this.t('Pages'), reason: '' },
				{ value: 'band', label: this.t('System band (staves side by side, for phones)'), reason: '' },
				{ value: 'lyrics', label: this.t('Lyrics only'), reason: this.lyricsUnavailable },
			]
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>
