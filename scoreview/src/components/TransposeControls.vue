<template>
	<!--
		Transposition des Klangs (H6). Das Notenbild bleibt stehen - das steht
		ausdruecklich daneben: Wer einen Ton tiefer singt, sieht weiter die
		Noten der Partitur, und Tonnamen nennen die geschriebene Note (D12).
		Die Zieltonart steht dabei, weil eine Chorleitung „wir singen es in C"
		sagt, nicht „minus zwei".
	-->
	<div class="scoreview-controls">
		<div class="scoreview-popover-row scoreview-transpose-row">
			<NcButton
				:aria-label="t('Lower by a semitone')"
				:disabled="semitones <= -12"
				@click="change(-1)">
				−
			</NcButton>
			<span class="scoreview-transpose-value" aria-live="polite">
				{{ valueLabel }}
			</span>
			<NcButton
				:aria-label="t('Raise by a semitone')"
				:disabled="semitones >= 12"
				@click="change(1)">
				+
			</NcButton>
		</div>
		<p v-if="keyLabel" class="scoreview-popover-hint">
			{{ keyLabel }}
		</p>
		<!--
			Where the server (or this browser) engraves display variants (E19),
			the notation can follow: MuseScore sets the score again a tone
			lower, spelled as its own transpose dialog would. One number for
			both - sound and notes never drift apart.
		-->
		<NcCheckboxRadioSwitch
			v-if="notationAvailable"
			:modelValue="transposeNotation"
			@update:modelValue="$emit('update:transposeNotation', $event)">
			{{ t('Transpose the notes too') }}
		</NcCheckboxRadioSwitch>
		<p v-else class="scoreview-popover-hint">
			{{ t('Only the sound is transposed. The notation is not.') }}
		</p>
		<p v-if="fromLeader" class="scoreview-popover-hint">
			{{ t('Set by the leader for everyone. Changing it stops following.') }}
		</p>
		<NcButton
			v-if="semitones !== 0"
			wide
			@click="$emit('update:semitones', 0)">
			{{ t('Original key') }}
		</NcButton>
	</div>
</template>

<script>
import { getLanguage } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import { translate } from '../l10n.js'
import { keyTonicName, transposeKey } from '../lib/noteNames.js'

export default {
	name: 'TransposeControls',

	components: {
		NcButton,
		NcCheckboxRadioSwitch,
	},

	props: {
		// Halbtoene, -12..12 (v-model:semitones)
		semitones: {
			type: Number,
			required: true,
		},

		// Tonart am Anfang der Partitur ({concertKey, mode}) oder null
		startKey: {
			type: Object,
			default: null,
		},

		// Die Leitung hat die Transposition gesetzt (H6, F6.3)
		fromLeader: {
			type: Boolean,
			default: false,
		},

		// Whether the notation can be transposed as well (E19)
		notationAvailable: {
			type: Boolean,
			default: false,
		},

		transposeNotation: {
			type: Boolean,
			default: false,
		},
	},

	emits: ['update:semitones', 'update:transposeNotation'],

	computed: {
		valueLabel() {
			if (this.semitones === 0) {
				return this.t('Original key')
			}
			const sign = this.semitones > 0 ? '+' : '−'
			return this.t('{value} semitones', { value: `${sign}${Math.abs(this.semitones)}` })
		},

		keyLabel() {
			if (!this.startKey || this.semitones === 0) {
				return ''
			}
			const system = getLanguage().startsWith('de') ? 'de' : 'en'
			const from = keyTonicName({ ...this.startKey, system })
			const to = keyTonicName({ ...this.startKey, concertKey: transposeKey(this.startKey.concertKey, this.semitones), system })
			return this.t('Sounds in {to} instead of {from}', { from, to })
		},
	},

	methods: {
		change(delta) {
			this.$emit('update:semitones', Math.max(-12, Math.min(12, this.semitones + delta)))
		},

		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>

<style scoped>
.scoreview-transpose-row {
	align-items: center;
	justify-content: space-between;
}

.scoreview-transpose-value {
	flex: 1;
	text-align: center;
	font-variant-numeric: tabular-nums;
}
</style>
