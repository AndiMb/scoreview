<template>
	<fieldset class="scoreview-trainer">
		<legend>{{ t('Speed trainer') }}</legend>
		<div class="scoreview-trainer-row">
			<NcTextField
				:modelValue="startBpm"
				type="number"
				:min="minBpm"
				:max="maxBpm"
				:label="t('Start (BPM)')"
				:disabled="active"
				@update:modelValue="$emit('update:startBpm', toNumber($event))" />
			<NcTextField
				:modelValue="targetBpm"
				type="number"
				:min="minBpm"
				:max="maxBpm"
				:label="t('Target (BPM)')"
				:disabled="active"
				@update:modelValue="$emit('update:targetBpm', toNumber($event))" />
			<NcTextField
				:modelValue="stepBpm"
				type="number"
				min="1"
				max="40"
				:label="t('Step')"
				:disabled="active"
				@update:modelValue="$emit('update:stepBpm', toNumber($event))" />
		</div>
		<NcButton wide :pressed="active" @click="$emit('toggle')">
			<template #icon>
				<Speedometer :size="20" />
			</template>
			{{ active ? t('Stop speed trainer') : t('Start speed trainer') }}
		</NcButton>
		<!--
			Das aktuelle Tempo steht ohnehin am Tempoknopf in der Leiste;
			hier dazu, in welchem Durchlauf man ist - das ist die
			Frage, die man sich nach dem dritten Mal stellt.
		-->
		<p v-if="active" class="scoreview-trainer-status" aria-live="polite">
			{{ t('Pass {n} at {bpm} BPM', { n: passes, bpm: currentBpm }) }}
		</p>
		<p v-else class="scoreview-trainer-status">
			{{ t('Each pass of the loop gets faster by one step until the target is reached. Moving the tempo slider ends the trainer.') }}
		</p>
	</fieldset>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import Speedometer from 'vue-material-design-icons/Speedometer.vue'

/**
 * Die Eingabe fuer den Speed-Trainer im Loop-Aufklapper. Nur
 * Darstellung - Zustand und Ablauf stehen in useSpeedTrainer.js.
 */
export default {
	name: 'ScoreSpeedTrainer',

	components: { NcButton, NcTextField, Speedometer },

	props: {
		startBpm: { type: [Number, String], default: '' },
		targetBpm: { type: [Number, String], default: '' },
		stepBpm: { type: [Number, String], default: 5 },
		minBpm: { type: Number, required: true },
		maxBpm: { type: Number, required: true },
		active: { type: Boolean, default: false },
		passes: { type: Number, default: 0 },
		currentBpm: { type: Number, default: 0 },
	},

	emits: ['update:startBpm', 'update:targetBpm', 'update:stepBpm', 'toggle'],

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		/**
		 * NcTextField liefert Text; ein leeres Feld bleibt leer, statt zu 0
		 * zu werden - sonst stuende nach dem Loeschen sofort „0" darin.
		 *
		 * @param {string} value
		 * @return {number|string}
		 */
		toNumber(value) {
			return value === '' ? '' : Number(value)
		},
	},
}
</script>

<style scoped>
.scoreview-trainer {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin: 0;
	padding: 8px 0 0 0;
	border: none;
	border-block-start: 1px solid var(--color-border);
}

.scoreview-trainer legend {
	color: var(--color-text-maxcontrast);
	padding: 0 0 4px 0;
}

.scoreview-trainer-row {
	display: flex;
	gap: 8px;
}

.scoreview-trainer-status {
	margin: 0;
	color: var(--color-text-maxcontrast);
	font-size: 0.85em;
	line-height: 1.3;
}
</style>
