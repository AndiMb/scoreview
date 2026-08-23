<template>
	<div class="scoreview-mixer">
		<div v-for="group in groups" :key="group.key" class="scoreview-mixer-channel">
			<span class="scoreview-mixer-name">{{ group.name || group.partId }}</span>
			<input
				type="range"
				min="0"
				max="127"
				:value="groupVolume(group)"
				:disabled="groupMuted(group)"
				:aria-label="t('Volume: {name}', { name: group.name || group.partId })"
				@input="onVolumeInput(group, $event)">
			<NcButton
				class="scoreview-mixer-toggle"
				:pressed="groupMuted(group)"
				:aria-label="t('Mute: {name}', { name: group.name || group.partId })"
				@click="toggleMute(group)">
				<template #icon>
					<VolumeOff :size="20" />
				</template>
			</NcButton>
			<NcButton
				class="scoreview-mixer-toggle"
				:pressed="groupSolo(group)"
				:aria-label="t('Solo: {name}', { name: group.name || group.partId })"
				@click="toggleSolo(group)">
				<template #icon>
					<Headphones :size="20" />
				</template>
			</NcButton>
			<NcButton
				class="scoreview-mixer-toggle"
				:pressed="focusedGroupKey === group.key"
				:aria-label="t('My voice: {name}', { name: group.name || group.partId })"
				:title="t('Boost this voice, keep the others audible but quiet')"
				@click="toggleFocus(group)">
				<template #icon>
					<AccountVoice :size="20" />
				</template>
			</NcButton>
			<NcSelect
				v-if="presetList && presetList.length > 0 && group.channels.length === 1"
				class="scoreview-mixer-program"
				:modelValue="selectedPreset(group.channels[0])"
				:options="presetList"
				label="name"
				:clearable="false"
				@update:modelValue="(preset) => onProgramChange(group.channels[0], preset.program)" />
		</div>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import AccountVoice from 'vue-material-design-icons/AccountVoice.vue'
import Headphones from 'vue-material-design-icons/Headphones.vue'
import VolumeOff from 'vue-material-design-icons/VolumeOff.vue'
import { computeEffectiveVolumes, computeVoiceFocusVolumes, resolveMixerGroups } from '../lib/mixerLayout.js'

/**
 * UI + Zustand für Lautstärke/Mute/Solo/Instrument pro Kanal (Phase 9,
 * Stimmgruppen + "meine Stimme"-Preset seit Phase 17). Die eigentliche
 * Solo/Mute/Fokus-Auflösung ist rein und lebt in mixerLayout.js - diese
 * Komponente hält nur den UI-Zustand (je MIDI-Kanal, siehe `states`) und
 * ruft player.js über die vom Elternteil (ScoreViewer.vue) durchgereichten
 * Callbacks an.
 *
 * Zustand bleibt bewusst pro rohem MIDI-Kanal (`states`), nicht pro Gruppe:
 * eine Gruppe kann mehrere Kanäle bündeln (Divisi, siehe
 * resolveMixerGroups()), Lautstärke/Mute/Solo sind aber pro Kanal an
 * player.js zu melden. Die Bedienzeile selbst zeigt/ändert nur den ersten
 * Kanal einer Gruppe stellvertretend und wendet Änderungen auf alle
 * Mitglieder gleich an.
 */
export default {
	name: 'ScoreMixer',

	components: { NcButton, NcSelect, VolumeOff, Headphones, AccountVoice },

	props: {
		// Aus lib/mixerLayout.js resolveMixerChannels(metadata.tracks, metadata.parts).
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

	emits: ['volumesChanged', 'programChanged'],

	data() {
		return {
			// channel -> { volume, muted, solo, program }
			//
			// program aus dem Kanal, nicht pauschal 0: MuseScore hat fuer jede
			// Stimme bereits ein Instrument gewaehlt (bei SATB 52 = Choir
			// Aahs). Mit festem 0 zeigte das Auswahlfeld immer "Acoustic Grand
			// Piano" an, obwohl etwas anderes klang.
			states: Object.fromEntries(this.channels.map((ch) => [
				ch.channel,
				{ volume: 127, muted: false, solo: false, program: ch.program ?? 0 },
			])),

			// key der Gruppe mit aktivem "meine Stimme"-Preset, oder null.
			focusedGroupKey: null,
		}
	},

	computed: {
		groups() {
			return resolveMixerGroups(this.channels)
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		emitVolumes() {
			const channelStates = this.channels.map((ch) => ({ channel: ch.channel, ...this.states[ch.channel] }))
			this.$emit('volumesChanged', computeEffectiveVolumes(channelStates))
		},

		groupVolume(group) {
			return this.states[group.channels[0]].volume
		},

		groupMuted(group) {
			return this.states[group.channels[0]].muted
		},

		groupSolo(group) {
			return this.states[group.channels[0]].solo
		},

		onVolumeInput(group, event) {
			const volume = Number(event.target.value)
			for (const channel of group.channels) {
				this.states[channel].volume = volume
			}
			this.emitVolumes()
		},

		toggleMute(group) {
			const muted = !this.groupMuted(group)
			for (const channel of group.channels) {
				this.states[channel].muted = muted
			}
			this.emitVolumes()
		},

		toggleSolo(group) {
			const solo = !this.groupSolo(group)
			for (const channel of group.channels) {
				this.states[channel].solo = solo
			}
			this.emitVolumes()
		},

		// "Meine Stimme"-Preset (Phase 17): anders als Solo werden die übrigen
		// Kanäle nur gedämpft, nicht stumm geschaltet (siehe mixerLayout.js
		// computeVoiceFocusVolumes) - der Probenfall ist "meine Stimme klar
		// heraushören", nicht "die anderen ausblenden".
		toggleFocus(group) {
			const allChannels = this.channels.map((ch) => ch.channel)
			if (this.focusedGroupKey === group.key) {
				this.focusedGroupKey = null
				for (const channel of allChannels) {
					this.states[channel].volume = 127
				}
			} else {
				this.focusedGroupKey = group.key
				const volumes = computeVoiceFocusVolumes(allChannels, group.channels)
				for (const [channel, volume] of volumes) {
					this.states[channel].volume = volume
				}
			}
			this.emitVolumes()
		},

		onProgramChange(channel, program) {
			this.states[channel].program = program
			this.$emit('programChanged', { channel, program })
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

/*
 * Umbruchfähig seit Phase 22: der Mixer steht jetzt in einer Karte von
 * höchstens 420px über dem Notenbild, nicht mehr über die volle Breite des
 * Viewers. Ohne Umbruch würde die Instrumentenauswahl den Lautstärkeregler
 * auf wenige Pixel zusammenquetschen.
 */
.scoreview-mixer-channel {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
}

.scoreview-mixer-name {
	flex: 0 0 90px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.scoreview-mixer-channel input[type="range"] {
	flex: 1 1 60px;
	min-width: 60px;
}

.scoreview-mixer-toggle {
	flex: 0 0 auto;
}

/* Eigene Zeile innerhalb der Stimme: das Auswahlfeld braucht Breite für
   GM-Namen wie "Choir Aahs", die Regler-Zeile darüber ebenso. */
.scoreview-mixer-program {
	flex: 1 0 100%;
}
</style>
