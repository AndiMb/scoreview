<template>
	<!--
		Der Wrapper traegt den Grund, warum der Knopf nicht geht: Ein
		deaktivierter Knopf bekommt in manchen Browsern keine Zeigerereignisse
		und zeigt dann auch seinen eigenen Tooltip nicht.
	-->
	<span class="scoreview-tone" :title="unavailableReason || label">
		<button
			type="button"
			class="scoreview-tone-button"
			:class="{ 'scoreview-tone-button--sounding': sounding }"
			:disabled="unavailableReason !== ''"
			:aria-label="unavailableReason ? label + ' – ' + unavailableReason : label"
			:aria-pressed="sounding"
			@pointerdown="onPointerDown"
			@pointerup="onPointerUp"
			@pointercancel="onPointerUp"
			@lostpointercapture="onPointerUp"
			@keydown="onKeydown"
			@keyup="onKeyup"
			@contextmenu.prevent>
			<MusicNoteWhole v-if="mode === 'tonic'" :size="20" />
			<MusicNote v-else :size="20" />
			<span v-if="toneName" class="scoreview-tone-name">{{ toneName }}</span>
		</button>
	</span>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import MusicNote from 'vue-material-design-icons/MusicNote.vue'
import MusicNoteWhole from 'vue-material-design-icons/MusicNoteWhole.vue'

/**
 * Der Knopf fuer den Anfangston: klingt, solange er gedrueckt ist.
 * Nur die Geste steht hier - welcher Ton, entscheidet
 * useStartTone.js.
 *
 * Pointer-Ereignisse statt click: Ein Klick meldet erst das Loslassen, der
 * Ton soll aber beim Aufsetzen des Fingers kommen und beim Abheben enden.
 * Mit Pointer-Capture kommt das Abheben auch an, wenn der Finger dabei vom
 * Knopf rutscht - sonst klaenge der Ton bis zur Obergrenze in player.js.
 */
export default {
	name: 'ScoreStartTone',

	components: { MusicNote, MusicNoteWhole },

	props: {
		mode: {
			type: String,
			default: 'voice',
		},

		sounding: {
			type: Boolean,
			default: false,
		},

		// Der zuletzt gespielte Ton ("E♭4"), leer vor dem ersten Druck.
		toneName: {
			type: String,
			default: '',
		},

		// Leer = der Knopf geht; sonst der Grund in Klartext.
		unavailableReason: {
			type: String,
			default: '',
		},
	},

	emits: ['press', 'release'],

	computed: {
		label() {
			return this.mode === 'tonic'
				? this.t('Key note – sounds while held')
				: this.t('Starting note of my voice – sounds while held')
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		onPointerDown(event) {
			if (event.button !== undefined && event.button !== 0) {
				return
			}
			event.currentTarget.setPointerCapture?.(event.pointerId)
			this.$emit('press')
		},

		onPointerUp() {
			this.$emit('release')
		},

		/**
		 * Tastatur: gedrueckt halten wie den Finger. `stopPropagation`, weil
		 * die Leertaste im Viewer sonst zusaetzlich die Wiedergabe startete.
		 *
		 * @param {KeyboardEvent} event
		 */
		onKeydown(event) {
			if (event.key !== 'Enter' && event.key !== ' ') {
				return
			}
			event.preventDefault()
			event.stopPropagation()
			if (!event.repeat) {
				this.$emit('press')
			}
		},

		onKeyup(event) {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault()
				event.stopPropagation()
				this.$emit('release')
			}
		},
	},
}
</script>

<style scoped>
.scoreview-tone {
	flex: 0 0 auto;
	display: inline-flex;
}

/*
 * Eigener Knopf statt NcButton: NcButton meldet nur click, gebraucht werden
 * Aufsetzen und Abheben. Die Masse folgen trotzdem NcButton, damit die Leiste
 * einheitlich bleibt (siehe --default-clickable-area in ScoreViewer.vue).
 */
.scoreview-tone-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	min-inline-size: var(--default-clickable-area, 34px);
	block-size: var(--default-clickable-area, 34px);
	margin: 0;
	padding: 0 8px;
	border: none;
	border-radius: var(--border-radius-element, 16px);
	background: var(--color-primary-element-light);
	color: var(--color-primary-element-light-text);
	cursor: pointer;
	/* Kein Markieren, kein Kontextmenue, kein Scrollen beim Halten. */
	user-select: none;
	-webkit-user-select: none;
	touch-action: none;
}

.scoreview-tone-button:disabled {
	opacity: 0.5;
	cursor: default;
}

.scoreview-tone-button--sounding {
	background: var(--color-primary-element);
	color: var(--color-primary-element-text);
}

.scoreview-tone-name {
	font-variant-numeric: tabular-nums;
	font-weight: bold;
}
</style>
