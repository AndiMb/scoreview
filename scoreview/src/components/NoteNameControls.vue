<template>
	<!--
		Tonnamen (H3): an den Notenkoepfen, auf Wunsch nur an der eigenen
		Stimme. Genannt wird die geschriebene Note (D12) - bei einer
		Transposition des Klangs steht das hier dabei.
	-->
	<div class="scoreview-controls">
		<NcNoteCard v-if="unavailable" type="info">
			{{ unavailable }}
		</NcNoteCard>
		<template v-else>
			<fieldset class="scoreview-popover-group">
				<legend>{{ t('Note names') }}</legend>
				<NcCheckboxRadioSwitch
					v-for="option in options"
					:key="option.value"
					:modelValue="system"
					type="radio"
					:value="option.value"
					name="scoreview-note-names"
					@update:modelValue="$emit('update:system', $event)">
					{{ option.label }}
				</NcCheckboxRadioSwitch>
			</fieldset>
			<NcCheckboxRadioSwitch
				:modelValue="onlyMine"
				type="switch"
				:disabled="system === 'off' || !hasMyPart"
				@update:modelValue="$emit('update:onlyMine', $event)">
				{{ t('Only my part') }}
			</NcCheckboxRadioSwitch>
			<p v-if="transpose !== 0 && system !== 'off'" class="scoreview-popover-hint">
				{{ t('The names show the written notes; the sound is transposed.') }}
			</p>
			<p class="scoreview-popover-hint">
				{{ t('Tap a note to hear it while playback is stopped.') }}
			</p>
		</template>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'

export default {
	name: 'NoteNameControls',

	components: {
		NcCheckboxRadioSwitch,
		NcNoteCard,
	},

	props: {
		// 'off' | 'de' | 'en' | 'solfa-fixed' | 'solfa-movable'
		system: {
			type: String,
			required: true,
		},

		onlyMine: {
			type: Boolean,
			required: true,
		},

		hasMyPart: {
			type: Boolean,
			required: true,
		},

		transpose: {
			type: Number,
			default: 0,
		},

		// Warum es keine Tonnamen gibt (lib/capabilities.js), sonst leer
		unavailable: {
			type: String,
			default: '',
		},
	},

	emits: ['update:system', 'update:onlyMine'],

	computed: {
		options() {
			return [
				{ value: 'off', label: this.t('Off') },
				{ value: 'de', label: this.t('German (C D E F G A H)') },
				{ value: 'en', label: this.t('English (C D E F G A B)') },
				{ value: 'solfa-fixed', label: this.t('Fixed do (do = C)') },
				{ value: 'solfa-movable', label: this.t('Movable do (do = key note)') },
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
