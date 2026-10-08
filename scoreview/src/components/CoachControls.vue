<template>
	<!--
		Coach (H4): die eigene Stimme als Klavier, laut und rechts, die
		anderen leise und links - die Mischung aus der Chorprobe. Der Regler
		„andere Stimmen" gilt auch ohne Coach fuer „Meine Stimme" (F4.2).
	-->
	<div class="scoreview-controls">
		<p v-if="!hasMyPart" class="scoreview-popover-hint">
			{{ t('Choose your part first – the coach plays it on the piano.') }}
		</p>
		<NcCheckboxRadioSwitch
			:modelValue="coach"
			type="switch"
			:disabled="!hasMyPart"
			@update:modelValue="$emit('update:coach', $event)">
			{{ t('My part on the piano, on the right') }}
		</NcCheckboxRadioSwitch>
		<label class="scoreview-popover-label">
			{{ t('Other parts') }}: {{ percent }} %
			<input
				type="range"
				min="0"
				max="127"
				step="1"
				:value="othersLevel"
				:aria-label="t('Other parts')"
				@change="$emit('update:othersLevel', Number($event.target.value))">
		</label>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'

export default {
	name: 'CoachControls',

	components: {
		NcCheckboxRadioSwitch,
	},

	props: {
		coach: {
			type: Boolean,
			required: true,
		},

		// 0..127, wie CC7
		othersLevel: {
			type: Number,
			required: true,
		},

		hasMyPart: {
			type: Boolean,
			required: true,
		},
	},

	// `change` statt `input` am Regler: Jede Aenderung wird gespeichert
	// (useMyPart.setPractice) - beim Ziehen waeren das Dutzende Anfragen.
	emits: ['update:coach', 'update:othersLevel'],

	computed: {
		percent() {
			return Math.round(this.othersLevel / 127 * 100)
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
