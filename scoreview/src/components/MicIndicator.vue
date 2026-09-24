<template>
	<!--
		Der rote Punkt: Solange das Mikrofon laeuft, steht hier,
		wofuer - und ein Tipp schaltet es aus. Bewusst ein eigener Knopf in der
		Leiste und nicht im Aufklapper: Er muss auch im Aufführungsmodus und
		bei eingefahrenen Werkzeugen sichtbar bleiben.
	-->
	<button
		type="button"
		class="scoreview-mic"
		:aria-label="label"
		:title="label"
		@click="$emit('off')">
		<span class="scoreview-mic-dot" aria-hidden="true" />
		<MicrophoneOff :size="18" />
		<span class="scoreview-mic-text">{{ purpose }}</span>
	</button>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import MicrophoneOff from 'vue-material-design-icons/MicrophoneOff.vue'

export default {
	name: 'MicIndicator',

	components: { MicrophoneOff },

	props: {
		// Wer das Mikrofon gerade nutzt (useMicrophone.consumers).
		consumers: {
			type: Array,
			required: true,
		},
	},

	emits: ['off'],

	computed: {
		purpose() {
			const names = {
				recorder: this.t('Recording'),
				intonation: this.t('Intonation'),
				follower: this.t('Score following'),
			}
			return this.consumers.map((c) => names[c] ?? c).join(', ')
		},

		label() {
			return this.t('Microphone on for: {purpose}. Tap to turn it off.', { purpose: this.purpose })
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
.scoreview-mic {
	flex: 0 0 auto;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	min-block-size: var(--default-clickable-area, 34px);
	margin: 0;
	padding: 0 10px 0 8px;
	border: 2px solid var(--color-error, #d32f2f);
	border-radius: var(--border-radius-pill, 18px);
	background: var(--color-main-background);
	color: var(--color-error-text, #c62828);
	font-weight: bold;
	cursor: pointer;
}

.scoreview-mic:hover {
	background: var(--color-background-hover);
}

.scoreview-mic-dot {
	inline-size: 10px;
	block-size: 10px;
	border-radius: 50%;
	background: var(--color-error, #d32f2f);
	animation: scoreview-mic-pulse 1.4s ease-in-out infinite;
}

/* Auf Telefonbreite nur Punkt und Symbol - die Aufschrift steht im Titel. */
@container (max-width: 400px) {
	.scoreview-mic-text {
		display: none;
	}
}

@keyframes scoreview-mic-pulse {
	50% {
		opacity: 0.35;
	}
}

@media (prefers-reduced-motion: reduce) {
	.scoreview-mic-dot {
		animation: none;
	}
}
</style>
