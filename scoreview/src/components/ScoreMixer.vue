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
				@input="onVolumeInput(ch.channel, $event)">
			<button
				type="button"
				class="scoreview-mixer-toggle"
				:class="{ active: states[ch.channel].muted }"
				:title="t('Mute: {name}', { name: ch.name || ch.instrumentId })"
				@click="toggleMute(ch.channel)">
				M
			</button>
			<button
				type="button"
				class="scoreview-mixer-toggle"
				:class="{ active: states[ch.channel].solo }"
				:title="t('Solo: {name}', { name: ch.name || ch.instrumentId })"
				@click="toggleSolo(ch.channel)">
				S
			</button>
			<select
				v-if="presetList && presetList.length > 0"
				class="scoreview-mixer-program"
				:value="states[ch.channel].program"
				@change="onProgramChange(ch.channel, $event)">
				<option v-for="preset in presetList" :key="`${preset.bank}-${preset.program}`" :value="preset.program">
					{{ preset.name }}
				</option>
			</select>
		</div>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import { computeEffectiveVolumes } from '../lib/mixerLayout.js'

/**
 * UI + Zustand für Lautstärke/Mute/Solo/Instrument pro Kanal (Phase 9).
 * Die eigentliche Solo/Mute-Auflösung ist rein und lebt in mixerLayout.js -
 * diese Komponente hält nur den UI-Zustand und ruft player.js über die vom
 * Elternteil (ScoreViewer.vue) durchgereichten Callbacks an.
 */
export default {
	name: 'ScoreMixer',

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

		onProgramChange(channel, event) {
			const program = Number(event.target.value)
			this.states[channel].program = program
			this.$emit('program-changed', { channel, program })
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
	width: 24px;
}

.scoreview-mixer-toggle.active {
	background: var(--color-primary-element);
	color: var(--color-primary-element-text);
}

.scoreview-mixer-program {
	flex: 0 0 160px;
}
</style>
