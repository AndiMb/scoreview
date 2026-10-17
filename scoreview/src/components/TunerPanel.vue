<!--
	The tuner (B3): the sounding note, its octave and frequency, and how far
	it is from the equal-tempered pitch. The name follows the person's
	note-name system and the key of the score at the current position - a
	tuner in F major says B♭, not A♯.

	Reference a' = 440 Hz, fixed (docs/limits.md): adjustable together with
	the intonation check later, both share the constant (lib/intonation.js).
-->
<template>
	<div class="scoreview-tuner">
		<p v-if="error || micError" class="scoreview-tuner-error">
			{{ error || micErrorText }}
		</p>
		<div class="scoreview-tuner-reading" aria-live="polite">
			<span class="scoreview-tuner-name" :class="{ 'scoreview-tuner-name--idle': !reading }">{{ noteName }}</span>
			<span v-if="reading" class="scoreview-tuner-detail">
				{{ t('Octave {octave}', { octave: octave }) }} · {{ hzText }} · {{ centsText }}
			</span>
			<span v-else class="scoreview-tuner-detail">{{ active ? t('Listening…') : t('Off') }}</span>
		</div>
		<TunerNeedle :cents="reading ? reading.cents : null" :cls="cls" />
		<div class="scoreview-tuner-actions">
			<NcButton :variant="active ? 'secondary' : 'primary'" @click="$emit('toggle')">
				<template #icon>
					<MicrophoneOff v-if="active" :size="20" />
					<Microphone v-else :size="20" />
				</template>
				{{ active ? t('Stop') : t('Start tuner') }}
			</NcButton>
		</div>
		<p class="scoreview-tuner-hint">
			{{ t('Reference a′ = {hz} Hz', { hz: referenceHz }) }}
		</p>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import Microphone from 'vue-material-design-icons/Microphone.vue'
import MicrophoneOff from 'vue-material-design-icons/MicrophoneOff.vue'
import TunerNeedle from './TunerNeedle.vue'
import { A4_HZ, classify, formatCents } from '../lib/intonation.js'
import { nameOf } from '../lib/noteNames.js'
import { octaveOf, tpcForPitch } from '../lib/tuner.js'

export default {
	name: 'TunerPanel',

	components: {
		Microphone,
		MicrophoneOff,
		NcButton,
		TunerNeedle,
	},

	props: {
		// {midi, cents, hz} or null (useTuner.reading)
		reading: {
			type: Object,
			default: null,
		},

		active: {
			type: Boolean,
			default: false,
		},

		error: {
			type: String,
			default: '',
		},

		// useMicrophone.error - {kind, name} or null
		micError: {
			type: Object,
			default: null,
		},

		// 'de' | 'en' | 'solfa-fixed' | 'solfa-movable' (lib/noteNames.js)
		nameSystem: {
			type: String,
			default: 'en',
		},

		// Key signature at the current position, -7 … 7
		concertKey: {
			type: Number,
			default: 0,
		},
	},

	emits: ['toggle'],

	computed: {
		referenceHz() {
			return A4_HZ
		},

		noteName() {
			if (!this.reading) {
				return '–'
			}
			return nameOf({ tpc: tpcForPitch(this.reading.midi, this.concertKey), system: this.nameSystem, concertKey: this.concertKey })
		},

		octave() {
			return this.reading ? octaveOf(this.reading.midi) : ''
		},

		hzText() {
			return this.reading ? this.t('{hz} Hz', { hz: this.reading.hz.toFixed(1) }) : ''
		},

		centsText() {
			return this.reading ? this.t('{cents} cents', { cents: formatCents(this.reading.cents) }) : ''
		},

		cls() {
			return this.reading ? classify(this.reading.cents) : 'na'
		},

		micErrorText() {
			switch (this.micError?.kind) {
				case 'blocked':
					return this.t('The microphone is blocked. Allow it in the browser to use the tuner.')
				case 'noDevice':
					return this.t('No microphone found.')
				case 'busy':
					return this.t('The microphone is in use by another application.')
				default:
					return this.micError ? this.t('The microphone could not be started.') : ''
			}
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped>
.scoreview-tuner {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	min-inline-size: 260px;
}

.scoreview-tuner-reading {
	display: flex;
	flex-direction: column;
	align-items: center;
}

.scoreview-tuner-name {
	font-size: 2.6rem;
	font-weight: bold;
	line-height: 1.1;
}

.scoreview-tuner-name--idle {
	color: var(--color-text-maxcontrast);
}

.scoreview-tuner-detail,
.scoreview-tuner-hint {
	color: var(--color-text-maxcontrast);
	margin: 0;
}

.scoreview-tuner-error {
	color: var(--color-error-text, #c62828);
	margin: 0;
}
</style>
