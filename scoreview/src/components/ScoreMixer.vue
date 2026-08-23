<template>
	<div class="scoreview-mixer">
		<div v-for="ch in channels" :key="ch.channel" class="scoreview-mixer-channel">
			<span class="scoreview-mixer-name">{{ ch.name || ch.instrumentId }}</span>
			<input
				type="range"
				min="0"
				max="127"
				:value="states[ch.channel].volume"
				:disabled="states[ch.channel].muted"
				:aria-label="t('Volume: {name}', { name: ch.name || ch.instrumentId })"
				@input="onVolumeInput(ch.channel, $event)">
			<NcButton
				class="scoreview-mixer-toggle"
				:pressed="states[ch.channel].muted"
				:aria-label="t('Mute: {name}', { name: ch.name || ch.instrumentId })"
				@click="toggleMute(ch.channel)">
				<template #icon>
					<VolumeOff :size="20" />
				</template>
			</NcButton>
			<NcButton
				class="scoreview-mixer-toggle"
				:pressed="states[ch.channel].solo"
				:aria-label="t('Solo: {name}', { name: ch.name || ch.instrumentId })"
				@click="toggleSolo(ch.channel)">
				<template #icon>
					<Headphones :size="20" />
				</template>
			</NcButton>
			<NcSelect
				v-if="presetList && presetList.length > 0"
				class="scoreview-mixer-program"
				:model-value="selectedPreset(ch.channel)"
				:options="presetList"
				label="name"
				:clearable="false"
				@update:model-value="(preset) => onProgramChange(ch.channel, preset.program)" />
		</div>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import VolumeOff from 'vue-material-design-icons/VolumeOff.vue'
import Headphones from 'vue-material-design-icons/Headphones.vue'
import { computeEffectiveVolumes } from '../lib/mixerLayout.js'

/**
 * UI + Zustand für Lautstärke/Mute/Solo/Instrument pro Kanal (Phase 9).
 * Die eigentliche Solo/Mute-Auflösung ist rein und lebt in mixerLayout.js -
 * diese Komponente hält nur den UI-Zustand und ruft player.js über die vom
 * Elternteil (ScoreViewer.vue) durchgereichten Callbacks an.
 */
export default {
	name: 'ScoreMixer',

	components: { NcButton, NcSelect, VolumeOff, Headphones },

	props: {
		// Aus lib/mixerLayout.js resolveMixerChannels(metadata.tracks).
		channels: {
			type: Array,
			required: true,
		},
		// player.getPresetList() - undefined/leer, solange der Player noch
		// nicht bereit ist.
		presetList: {
			type: Array,
			default: () => [],
		},
	},

	emits: ['volumes-changed', 'program-changed'],

	data() {
		return {
			// channel -> { volume, muted, solo, program }
			states: Object.fromEntries(
				// program aus dem Kanal, nicht pauschal 0: MuseScore hat fuer
				// jede Stimme bereits ein Instrument gewaehlt (bei SATB 52 =
				// Choir Aahs). Mit festem 0 zeigte das Auswahlfeld immer
				// "Acoustic Grand Piano" an, obwohl etwas anderes klang.
				this.channels.map((ch) => [ch.channel, { volume: 127, muted: false, solo: false, program: ch.program ?? 0 }]),
			),
		}
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		emitVolumes() {
			const channelStates = this.channels.map((ch) => ({ channel: ch.channel, ...this.states[ch.channel] }))
			this.$emit('volumes-changed', computeEffectiveVolumes(channelStates))
		},

		onVolumeInput(channel, event) {
			this.states[channel].volume = Number(event.target.value)
			this.emitVolumes()
		},

		toggleMute(channel) {
			this.states[channel].muted = !this.states[channel].muted
			this.emitVolumes()
		},

		toggleSolo(channel) {
			this.states[channel].solo = !this.states[channel].solo
			this.emitVolumes()
		},

		onProgramChange(channel, program) {
			this.states[channel].program = program
			this.$emit('program-changed', { channel, program })
		},

		// NcSelect (vue-select) bekommt hier bewusst das volle Preset-Objekt aus
		// presetList statt nur states[channel].program als modelValue: mehrere
		// GM-Presets teilen sich denselben program-Wert über verschiedene Banks
		// hinweg (z.B. mehrere Bank-Varianten von Programm 52), ein reiner
		// Zahlen-modelValue mit :reduce="preset => preset.program" lässt sich
		// dann nicht eindeutig zu einem Options-Objekt zurückauflösen -
		// vue-select zeigt in dem Fall den rohen Wert ("52") statt eines Namens
		// an. Nur der Program-Kanal geht an setProgram() (player.js kennt
		// ohnehin keine Bank-Auswahl), die Anzeige braucht trotzdem ein
		// eindeutiges Objekt.
		selectedPreset(channel) {
			const program = this.states[channel].program
			return this.presetList.find((preset) => preset.program === program) ?? null
		},
	},
}
</script>

<style scoped>
.scoreview-mixer {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 8px 0;
}

.scoreview-mixer-channel {
	display: flex;
	align-items: center;
	gap: 8px;
}

.scoreview-mixer-name {
	flex: 0 0 100px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.scoreview-mixer-channel input[type="range"] {
	flex: 1 1 auto;
}

.scoreview-mixer-toggle {
	flex: 0 0 auto;
}

.scoreview-mixer-program {
	flex: 0 0 160px;
}
</style>
