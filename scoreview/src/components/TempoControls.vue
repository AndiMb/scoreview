<template>
	<!--
		BPM statt Prozent (auf Basis von docs/architecture.md M8:
		metadata.tempo ist Viertel-BPM) - der Notensymbol-Text "♩ 80"
		statt "100%" ist die Einheit, die eine Chorleitung tatsaechlich
		ansagt. tempoGuessed markiert Partituren ohne eigene Tempoangabe
		(M8: tempo kann 0 sein) sichtbar als geschaetzt, statt eine
		Genauigkeit vorzutaeuschen, die nicht da ist. Der Regler liegt auf
		einer Unterseite der Gruppe „Ueben" (ToolGroup.vue) - er wird einmal
		eingestellt, nicht dauernd; die Zahl steht in deren Zeile.
	-->
	<div class="scoreview-controls">
		<p v-if="tempoGuessed" class="scoreview-popover-hint">
			{{ t('No tempo marking in the score – 120 BPM assumed.') }}
		</p>
		<label v-if="hasRealPlayer" class="scoreview-popover-label">
			{{ t('Tempo (BPM)') }}: ♩ = {{ effectiveTempoBpm }}
			<input
				type="range"
				:min="minTempoBpm"
				:max="maxTempoBpm"
				step="1"
				:value="effectiveTempoBpm"
				:aria-label="t('Tempo (BPM)')"
				@input="$emit('tempoInput', $event)">
		</label>
		<fieldset class="scoreview-popover-group">
			<legend>{{ t('Metronome') }}</legend>
			<NcCheckboxRadioSwitch
				v-model="beats"
				type="radio"
				value="all"
				name="scoreview-metronome-beats">
				{{ t('Every beat') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch
				v-model="beats"
				type="radio"
				value="downbeat"
				name="scoreview-metronome-beats">
				{{ t('Downbeat only') }}
			</NcCheckboxRadioSwitch>
		</fieldset>
		<!--
			Bild und Ton abgleichen. Der Cursor stuende sonst
			dort, wo die Musik erst noch hinkommt: Die Audiouhr
			meldet, was an das Ausgabegeraet UEBERGEBEN wurde,
			hoerbar wird es erst nach der Ausgabelatenz - ueber
			Bluetooth 150-300 ms, bei Viertel = 120 eine
			Achtelnote. Automatisch ausgeglichen wird, was der
			Browser meldet (lib/playbackTime.js); dieser Regler
			traegt den Rest, denn ob der Bluetooth-Anteil
			ueberhaupt gemeldet wird, haengt am Kopfhoerer.
			Geraeteweise gemerkt, nicht am Konto - Begruendung
			in usePlayback.js.
		-->
		<label v-if="hasRealPlayer" class="scoreview-popover-label">
			{{ t('Sync picture and sound') }}: {{ audioOffsetMs }} ms
			<input
				type="range"
				:min="minAudioOffsetMs"
				:max="maxAudioOffsetMs"
				step="10"
				:value="audioOffsetMs"
				:aria-label="t('Sync picture and sound')"
				@input="$emit('audioOffsetInput', $event)">
			<span class="scoreview-popover-hint">
				{{ t('Adjust while playing, until the highlighted note matches what you hear. Detected automatically: {ms} ms.', { ms: automaticLatencyRounded }) }}
			</span>
		</label>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import { MAX_MANUAL_OFFSET_MS, MIN_MANUAL_OFFSET_MS } from '../lib/playbackTime.js'

export default {
	name: 'TempoControls',

	components: {
		NcCheckboxRadioSwitch,
	},

	props: {
		hasRealPlayer: {
			type: Boolean,
			required: true,
		},

		effectiveTempoBpm: {
			type: Number,
			required: true,
		},

		tempoGuessed: {
			type: Boolean,
			required: true,
		},

		minTempoBpm: {
			type: Number,
			required: true,
		},

		maxTempoBpm: {
			type: Number,
			required: true,
		},

		// 'all' | 'downbeat' (useMetronome.js), als v-model:metronomeBeats.
		metronomeBeats: {
			type: String,
			required: true,
		},

		// Der Versatz von Hand (usePlayback.manualOffsetMs).
		audioOffsetMs: {
			type: Number,
			required: true,
		},

		// Die automatisch erkannte Latenz als FUNKTION, nicht als Wert: Sie
		// aendert sich in jedem Frame. Als Prop gelesen, rendete der Viewer
		// in jedem Frame neu (siehe LiveValue.vue) - so liest sie nur die
		// geoeffnete Unterseite.
		readAutomaticLatencyMs: {
			type: Function,
			required: true,
		},
	},

	// Die Regler reichen das rohe Ereignis weiter - usePlayback liest
	// event.target selbst.
	emits: ['tempoInput', 'audioOffsetInput', 'update:metronomeBeats'],

	computed: {
		beats: {
			get() {
				return this.metronomeBeats
			},

			set(value) {
				this.$emit('update:metronomeBeats', value)
			},
		},

		minAudioOffsetMs() {
			return MIN_MANUAL_OFFSET_MS
		},

		maxAudioOffsetMs() {
			return MAX_MANUAL_OFFSET_MS
		},

		automaticLatencyRounded() {
			return Math.round(this.readAutomaticLatencyMs())
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>
