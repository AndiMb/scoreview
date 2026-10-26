<template>
	<div class="scoreview-mixer">
		<div v-for="group in groups" :key="group.key" class="scoreview-mixer-channel">
			<span class="scoreview-mixer-name">{{ label(group) }}</span>
			<input
				type="range"
				min="0"
				max="100"
				:value="groupLevel(group)"
				:disabled="groupMuted(group)"
				:aria-label="t('Volume: {name}', { name: label(group) })"
				@input="onVolumeInput(group, $event)">
			<NcButton
				class="scoreview-mixer-toggle"
				:pressed="groupMuted(group)"
				:aria-label="t('Mute: {name}', { name: label(group) })"
				@click="$emit('mute', group.channels)">
				<template #icon>
					<VolumeOff :size="20" />
				</template>
			</NcButton>
			<NcButton
				class="scoreview-mixer-toggle"
				:pressed="groupSolo(group)"
				:aria-label="t('Solo: {name}', { name: label(group) })"
				@click="$emit('solo', group.channels)">
				<template #icon>
					<Headphones :size="20" />
				</template>
			</NcButton>
			<NcButton
				v-if="group.harmonyOf === undefined"
				class="scoreview-mixer-toggle"
				:pressed="mix.focusKey === group.key"
				:aria-label="t('My voice: {name}', { name: label(group) })"
				:title="t('Boost this voice, keep the others audible but quiet')"
				@click="$emit('focus', group)">
				<template #icon>
					<AccountVoice :size="20" />
				</template>
			</NcButton>
			<NcSelect
				v-if="presetList && presetList.length > 0 && group.voices === 1"
				class="scoreview-mixer-program"
				:modelValue="selectedPreset(group.channels[0])"
				:options="presetList"
				label="name"
				:clearable="false"
				:appendToBody="!inFullscreen"
				@update:modelValue="(preset) => $emit('program', { channel: group.channels[0], program: preset.program })" />
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
import { useFullscreenContainer } from '../composables/useFullscreenContainer.js'
import { resolveMixerGroups } from '../lib/mixerLayout.js'

/**
 * Volume, mute, solo, instrument and "my part" per voice group - as a view.
 * The state lives in useMix.js for as long as the player does, so closing and
 * opening this panel changes nothing that is heard; the panel says what it
 * would like changed, the viewer decides (issue #17).
 *
 * A group can bundle several channels (divisi, an instrument's further
 * sounds, see resolveMixerGroups()). A row shows its first channel and
 * changes all members alike. Chord symbols have a row of their own, without
 * "my voice": they are no voice anyone sings.
 *
 * The slider runs from 0 to 100 % of the score's own mix (mixState.js) -
 * 100 % is what MuseScore's mixer set, not the synthesizer's maximum.
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

		// useMix.js state: {channels: {[channel]: {level, muted, solo, program}}, focusKey}
		mix: {
			type: Object,
			required: true,
		},
	},

	emits: ['level', 'mute', 'solo', 'focus', 'program'],

	// Popovers into the viewer while it is fullscreen (useFullscreenContainer.js).
	setup() {
		return useFullscreenContainer()
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

		/**
		 * A row's name. Chord symbols carry their part's name only when
		 * several parts have them - one row "Chord symbols" says enough.
		 *
		 * @param {object} group see resolveMixerGroups()
		 * @return {string}
		 */
		label(group) {
			if (group.harmonyOf === undefined) {
				return group.name || group.partId
			}
			const several = this.groups.filter((other) => other.harmonyOf !== undefined).length > 1
			return several ? this.t('Chord symbols ({name})', { name: group.name }) : this.t('Chord symbols')
		},

		channelMix(group) {
			return this.mix.channels[group.channels[0]] ?? { level: 1, muted: false, solo: false, program: 0 }
		},

		groupLevel(group) {
			return Math.round(this.channelMix(group).level * 100)
		},

		groupMuted(group) {
			return this.channelMix(group).muted
		},

		groupSolo(group) {
			return this.channelMix(group).solo
		},

		onVolumeInput(group, event) {
			this.$emit('level', { channels: group.channels, level: Number(event.target.value) / 100 })
		},

		// NcSelect (vue-select) bekommt hier bewusst das volle Preset-Objekt aus
		// presetList statt nur die Programmnummer als modelValue: mehrere
		// GM-Presets teilen sich denselben program-Wert über verschiedene Banks
		// hinweg (z.B. mehrere Bank-Varianten von Programm 52), ein reiner
		// Zahlen-modelValue mit :reduce="preset => preset.program" lässt sich
		// dann nicht eindeutig zu einem Options-Objekt zurückauflösen -
		// vue-select zeigt in dem Fall den rohen Wert ("52") statt eines Namens
		// an. Nur der Program-Kanal geht an setProgram() (player.js kennt
		// ohnehin keine Bank-Auswahl), die Anzeige braucht trotzdem ein
		// eindeutiges Objekt.
		selectedPreset(channel) {
			const program = this.mix.channels[channel]?.program
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
 * Umbruchfähig: der Mixer steht in einer Karte von
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
