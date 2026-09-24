<template>
	<!--
		Darstellung: wie die klingende Stelle markiert wird - und,
		an derselben Stelle, womit diese Seiten ueberhaupt gesetzt
		wurden. Beides gehoert zusammen: Es ist der Ort fuer
		"warum sieht das so aus".
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
		<!--
			Die Herkunft der Darstellung (E3). Rein
			beschreibend - der Viewer verzweigt nirgends
			danach, er sagt nur, womit diese Seiten gesetzt
			wurden. Das ist die Frage, die bei einem
			Satzunterschied zwischen zwei Instanzen als
			Erstes kommt.
		-->
		<p class="scoreview-origin">
			<span class="scoreview-origin-label">{{ t('Rendered by') }}</span>
			{{ rendererText }}
			<span v-if="mscoreVersion" class="scoreview-origin-note">
				{{ t('Score written with MuseScore {version}', { version: mscoreVersion }) }}
			</span>
		</p>
		<!--
			Genau hier, direkt unter der Herkunft: Das ist die
			Stelle, an der auffaellt, dass eine Partitur noch von
			einer aelteren Fassung gesetzt wurde. Nur mit
			Schreibrecht (canReconvert) - siehe
			ConversionController::reconvert().
		-->
		<NcButton
			v-if="canReconvert"
			class="scoreview-origin-action"
			:title="t('Discards the stored conversion and renders the score again with the current version of the app.')"
			@click="$emit('reconvert')">
			<template #icon>
				<Refresh :size="20" />
			</template>
			{{ t('Convert again') }}
		</NcButton>
		<!--
			Was auf DIESEM Geraet gemessen wurde. Steht hier,
			weil es dieselbe Frage beantwortet wie die
			Herkunft darueber: "warum ist das so, wie es
			ist". Rein beschreibend, nichts verzweigt danach.

			Der Grund fuer die Anzeige: "die Wiedergabe
			synchronisiert nicht sauber" hat zwei ganz
			verschiedene Ursachen, die sich gleich anfuehlen -
			die Anzeige laeuft dem Ton voraus (dann steht hier
			eine Latenz), oder der Ton setzt aus, weil die
			Synthese auf dem Geraet nicht mitkommt (dann
			zaehlt hier etwas). Aus der Ferne ist das nicht zu
			unterscheiden, auf dem Geraet mit einem Blick.
		-->
		<details class="scoreview-diagnostics">
			<summary>{{ t('Playback diagnostics') }}</summary>
			<dl class="scoreview-diagnostics-list">
				<div v-if="diagnostics.hasAudio">
					<dt>{{ t('Output latency') }}</dt>
					<dd>
						{{ diagnostics.appliedLatencyMs }} ms
						<span class="scoreview-diagnostics-note">
							{{ t('measured {measured}, reported {reported}, by hand {manual}', {
								measured: formatMs(diagnostics.measuredLatencyMs),
								reported: formatMs(diagnostics.reportedLatencyMs),
								manual: diagnostics.manualOffsetMs + ' ms',
							}) }}
						</span>
					</dd>
					<dt>{{ t('Audio output') }}</dt>
					<dd>{{ diagnostics.sampleRate }} Hz, {{ diagnostics.contextState }}</dd>
					<dt>{{ t('Dropouts') }}</dt>
					<dd>{{ diagnostics.dropoutCount }} ({{ diagnostics.dropoutLostMs }} ms)</dd>
				</div>
				<div v-else>
					<dt>{{ t('Audio output') }}</dt>
					<dd>{{ t('none – the score cursor runs without sound') }}</dd>
				</div>
				<div>
					<dt>{{ t('Frame rate') }}</dt>
					<dd>{{ diagnostics.frameRate }} fps</dd>
				</div>
			</dl>
		</details>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import Refresh from 'vue-material-design-icons/Refresh.vue'
import { HIGHLIGHT_PRESETS, normalizeHighlightColor } from '../lib/highlightStyle.js'
import { formatMs } from '../lib/viewerFormat.js'
import { rendererText } from '../lib/viewerTexts.js'

export default {
	name: 'AppearanceControls',

	components: {
		NcButton,
		NcCheckboxRadioSwitch,
		Refresh,
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

		// Der Konvertierungsweg DIESER Darstellung (useScoreSession.js).
		rendererBackend: {
			type: String,
			default: null,
		},

		mscoreVersion: {
			type: String,
			default: null,
		},

		canReconvert: {
			type: Boolean,
			default: false,
		},

		// Die Betriebsdiagnose als FUNKTION, nicht als Wert: Bildrate und
		// Latenz aendern sich in jedem Frame. Als Prop gelesen, rendete der
		// Viewer in jedem Frame neu (siehe LiveValue.vue) - so liest sie nur
		// die geoeffnete Unterseite.
		readDiagnostics: {
			type: Function,
			required: true,
		},
	},

	emits: ['update:highlightMode', 'update:highlightColor', 'update:noteTheme', 'reconvert'],

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

		/** Womit diese Seiten gesetzt wurden, als ein Satz (lib/viewerTexts.js). */
		rendererText() {
			return rendererText(this.rendererBackend, this.t)
		},

		diagnostics() {
			return this.readDiagnostics()
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		formatMs,

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

/*
 * Die Herkunftsangabe. Kleiner und zurueckgenommen: Sie wird einmal gelesen,
 * wenn etwas anders aussieht als erwartet, und steht danach nur noch da.
 */
.scoreview-origin {
	margin: 0;
	padding-block-start: 8px;
	border-block-start: 1px solid var(--color-border);
	color: var(--color-text-maxcontrast);
	font-size: 0.9em;
	line-height: 1.35;
}

.scoreview-origin-label {
	display: block;
	font-weight: bold;
}

.scoreview-origin-note {
	display: block;
	padding-block-start: 4px;
}

.scoreview-origin-action {
	margin-block-start: 8px;
}

/*
 * Die Betriebsdiagnose. Zugeklappt, weil sie nur gebraucht wird, wenn etwas
 * nicht stimmt - und dann vollstaendig, nicht haeppchenweise.
 */
.scoreview-diagnostics {
	color: var(--color-text-maxcontrast);
	font-size: 0.85em;
	line-height: 1.35;
}

.scoreview-diagnostics summary {
	cursor: pointer;
	padding-block: 4px;
}

.scoreview-diagnostics-list {
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.scoreview-diagnostics-list dt {
	font-weight: bold;
}

.scoreview-diagnostics-list dd {
	margin: 0 0 4px 0;
	font-variant-numeric: tabular-nums;
}

.scoreview-diagnostics-note {
	display: block;
	opacity: 0.8;
}
</style>
