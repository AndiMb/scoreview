<template>
	<!--
		Info and diagnostics: what set these pages and what this device
		measured. Its own page in "Score" rather than under the colours: it
		answers "why is it like this" when something looks or sounds wrong,
		and that is a question about the score and the device, not about how
		someone likes the notes coloured.
	-->
	<div class="scoreview-controls">
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
			Was auf DIESEM Geraet gemessen wurde. Der Grund fuer die
			Anzeige: "die Wiedergabe synchronisiert nicht sauber" hat zwei
			ganz verschiedene Ursachen, die sich gleich anfuehlen - die
			Anzeige laeuft dem Ton voraus (dann steht hier eine Latenz),
			oder der Ton setzt aus, weil die Synthese auf dem Geraet nicht
			mitkommt (dann zaehlt hier etwas). Aus der Ferne ist das nicht
			zu unterscheiden, auf dem Geraet mit einem Blick.
		-->
		<fieldset class="scoreview-popover-group scoreview-diagnostics">
			<legend>{{ t('Playback diagnostics') }}</legend>
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
		</fieldset>
	</div>
</template>

<script>
import NcButton from '@nextcloud/vue/components/NcButton'
import Refresh from 'vue-material-design-icons/Refresh.vue'
import { translate } from '../l10n.js'
import { formatMs } from '../lib/viewerFormat.js'
import { rendererText } from '../lib/viewerTexts.js'

export default {
	name: 'ScoreInfoControls',

	components: {
		NcButton,
		Refresh,
	},

	props: {
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

	emits: ['reconvert'],

	computed: {
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
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>

<style scoped>
/*
 * Die Herkunftsangabe. Kleiner und zurueckgenommen: Sie wird einmal gelesen,
 * wenn etwas anders aussieht als erwartet, und steht danach nur noch da.
 */
.scoreview-origin {
	margin: 0;
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

.scoreview-diagnostics {
	color: var(--color-text-maxcontrast);
	font-size: 0.85em;
	line-height: 1.35;
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
