<template>
	<!--
		Colours: how the sounding place is marked and how the notes are
		coloured. What set the pages and what this device measured is on a
		page of its own (ScoreInfoControls.vue).
	-->
	<div class="scoreview-controls">
		<fieldset class="scoreview-popover-group">
			<legend>{{ t('Playback highlight') }}</legend>
			<NcCheckboxRadioSwitch
				v-model="mode"
				type="radio"
				value="notes"
				name="scoreview-highlight-mode">
				{{ t('Colour the sounding notes') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch
				v-model="mode"
				type="radio"
				value="bar"
				name="scoreview-highlight-mode">
				{{ t('Bar at the sounding position') }}
			</NcCheckboxRadioSwitch>
		</fieldset>
		<!--
			Vorschlaege UND freie Wahl: Eine Farbe, die auf
			weissem Papier neben schwarzer Druckfarbe wirklich
			traegt, ist im Farbwaehler nicht in zwei Klicks
			gefunden.
		-->
		<div class="scoreview-swatches" role="group" :aria-label="t('Highlight colour')">
			<button
				v-for="preset in highlightPresets"
				:key="preset.id"
				type="button"
				class="scoreview-swatch"
				:class="{ 'scoreview-swatch--active': preset.color === highlightColor }"
				:style="{ background: preset.color }"
				:aria-pressed="preset.color === highlightColor"
				:aria-label="presetLabel(preset.id)"
				:title="presetLabel(preset.id)"
				@click="$emit('update:highlightColor', preset.color)" />
		</div>
		<label class="scoreview-popover-label">
			{{ t('Own colour') }}
			<input
				type="color"
				class="scoreview-color-input"
				:value="highlightColor"
				:aria-label="t('Own colour')"
				@input="onColorInput">
		</label>
		<!--
			Dunkelmodus der Noten. „Automatisch" folgt
			dem Nextcloud-Theme; die feste Wahl uebersteuert
			es, und beides bleibt am Konto gemerkt.
		-->
		<fieldset class="scoreview-popover-group">
			<legend>{{ t('Score colours') }}</legend>
			<NcCheckboxRadioSwitch
				v-model="theme"
				type="radio"
				value="auto"
				name="scoreview-note-theme">
				{{ t('Follow the Nextcloud theme') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch
				v-model="theme"
				type="radio"
				value="light"
				name="scoreview-note-theme">
				{{ t('Dark notes on white') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch
				v-model="theme"
				type="radio"
				value="dark"
				name="scoreview-note-theme">
				{{ t('Light notes on dark') }}
			</NcCheckboxRadioSwitch>
		</fieldset>
	</div>
</template>

<script>
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import { translate } from '../l10n.js'
import { HIGHLIGHT_PRESETS, normalizeHighlightColor } from '../lib/highlightStyle.js'

export default {
	name: 'AppearanceControls',

	components: {
		NcCheckboxRadioSwitch,
	},

	props: {
		// Die drei Anzeigeeinstellungen (useViewerPreferences.js), je als
		// v-model: 'notes' | 'bar', eine Farbe, 'auto' | 'light' | 'dark'.
		highlightMode: {
			type: String,
			required: true,
		},

		highlightColor: {
			type: String,
			required: true,
		},

		noteTheme: {
			type: String,
			required: true,
		},
	},

	emits: ['update:highlightMode', 'update:highlightColor', 'update:noteTheme'],

	computed: {
		mode: {
			get() {
				return this.highlightMode
			},

			set(value) {
				this.$emit('update:highlightMode', value)
			},
		},

		theme: {
			get() {
				return this.noteTheme
			},

			set(value) {
				this.$emit('update:noteTheme', value)
			},
		},

		/** Die Farbvorschlaege - der Name dazu wird erst hier uebersetzt (E4). */
		highlightPresets() {
			return HIGHLIGHT_PRESETS
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		/**
		 * Der Name einer Farbvorschlags-Kachel, fuer Vorlesewerkzeuge.
		 *
		 * @param {string} id Kennung aus HIGHLIGHT_PRESETS
		 * @return {string}
		 */
		presetLabel(id) {
			const names = {
				red: this.t('Red'),
				orange: this.t('Orange'),
				magenta: this.t('Magenta'),
				violet: this.t('Violet'),
				green: this.t('Green'),
				blue: this.t('Blue'),
			}
			return names[id] ?? id
		},

		// Der Farbwaehler feuert waehrend des Ziehens laufend - das Speichern
		// ist deshalb verzoegert (useViewerPreferences), die Anzeige nicht:
		// die Partitur faerbt sich beim Ziehen mit.
		onColorInput(event) {
			this.$emit('update:highlightColor', normalizeHighlightColor(event.target.value))
		},
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>

<style scoped>
/*
 * Die Farbvorschlaege als Kacheln. Gross genug fuer einen Finger auf Glas
 * (das Tablet am Notenstaender ist der Hauptfall) und quadratisch statt rund
 * - eine Farbflaeche liest sich als Farbprobe, ein Punkt als Schalter.
 */
.scoreview-swatches {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.scoreview-swatch {
	inline-size: 34px;
	block-size: 34px;
	border: 2px solid transparent;
	border-radius: 6px;
	padding: 0;
	cursor: pointer;
	/* Der Rahmen der Auswahl liegt AUSSERHALB der Farbflaeche (box-shadow
	   statt eines dickeren border): ein hineinwachsender Rahmen wuerde die
	   Farbprobe selbst verkleinern, und ausgerechnet bei der gewaehlten
	   Farbe. */
	box-shadow: none;
}

.scoreview-swatch--active {
	border-color: var(--color-main-background);
	box-shadow: 0 0 0 2px var(--color-main-text);
}

/*
 * Der freie Farbwaehler. Feste Hoehe, damit er neben den Kacheln nicht
 * unterschiedlich hoch ausfaellt - Browser bemassen `input[type=color]`
 * jeweils eigen.
 */
.scoreview-color-input {
	inline-size: 100%;
	block-size: 34px;
	padding: 2px;
	cursor: pointer;
}
</style>
