<template>
	<!--
		Die Darstellung (H2/H8): Seiten, Systemband oder Liedtext. Was die
		Artefakte nicht hergeben, steht ausgegraut da und sagt warum (N3) -
		statt still zu fehlen oder still auf Seiten zurueckzufallen.
	-->
	<div class="scoreview-controls">
		<!--
			The display variant (E19): what MuseScore engraves - a part, a
			phone-sized page, concert pitch. Unlike the layout below, each is a
			new engraving, made on demand; where the server cannot make them,
			the choices stay visible, greyed out, with the reason.
		-->
		<fieldset class="scoreview-popover-group">
			<legend>{{ t('Edition') }}</legend>
			<NcSelect
				:modelValue="selectedSource"
				:options="variantSources"
				:clearable="false"
				:appendToBody="!inFullscreen"
				:disabled="variantUnavailable !== ''"
				:inputLabel="t('Score or part')"
				label="label"
				@update:modelValue="$emit('update:variantSource', $event.value)" />
			<NcCheckboxRadioSwitch
				v-if="showConcert"
				:modelValue="variantConcert"
				:disabled="variantUnavailable !== ''"
				@update:modelValue="$emit('update:variantConcert', $event)">
				{{ t('Concert pitch (transposing instruments as they sound)') }}
			</NcCheckboxRadioSwitch>
		</fieldset>
		<fieldset class="scoreview-popover-group">
			<legend>{{ t('Page format') }}</legend>
			<NcCheckboxRadioSwitch
				v-for="option in formatOptions"
				:key="option.value"
				:modelValue="variantFormat"
				type="radio"
				:value="option.value"
				name="scoreview-variant-format"
				:disabled="option.value !== 'orig' && variantUnavailable !== ''"
				@update:modelValue="$emit('update:variantFormat', $event)">
				{{ option.label }}
			</NcCheckboxRadioSwitch>
			<p v-if="variantUnavailable" class="scoreview-popover-hint">
				{{ variantUnavailable }}
			</p>
		</fieldset>
		<fieldset class="scoreview-popover-group">
			<legend>{{ t('Layout') }}</legend>
			<template v-for="option in options" :key="option.value">
				<NcCheckboxRadioSwitch
					:modelValue="layout"
					type="radio"
					:value="option.value"
					name="scoreview-layout"
					:disabled="option.reason !== ''"
					@update:modelValue="$emit('update:layout', $event)">
					{{ option.label }}
				</NcCheckboxRadioSwitch>
				<p v-if="option.reason" class="scoreview-popover-hint">
					{{ option.reason }}
				</p>
			</template>
		</fieldset>
		<!--
			Two pages side by side (A2) - not a fourth layout but a property of
			the page view that applies where the page area is wide enough. When
			it does not apply right now, the hint says why instead of leaving a
			switch that seems to do nothing.
		-->
		<fieldset class="scoreview-popover-group">
			<legend>{{ t('Two pages side by side') }}</legend>
			<NcCheckboxRadioSwitch
				v-for="option in spreadOptions"
				:key="option.value"
				:modelValue="doublePage"
				type="radio"
				:value="option.value"
				name="scoreview-double-page"
				@update:modelValue="$emit('update:doublePage', $event)">
				{{ option.label }}
			</NcCheckboxRadioSwitch>
			<p v-if="spreadUnavailable" class="scoreview-popover-hint">
				{{ spreadUnavailable }}
			</p>
		</fieldset>
	</div>
</template>

<script>
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import { useFullscreenContainer } from '../composables/useFullscreenContainer.js'
import { translate } from '../l10n.js'

export default {
	name: 'LayoutControls',

	components: {
		NcCheckboxRadioSwitch,
		NcSelect,
	},

	props: {
		// 'pages' | 'band' | 'lyrics'
		layout: {
			type: String,
			required: true,
		},

		// Warum es die Liedtext-Ansicht nicht gibt, sonst leer
		lyricsUnavailable: {
			type: String,
			default: '',
		},

		// 'off' | 'left' | 'right' (Service\ViewerPreferences::DOUBLE_PAGE)
		doublePage: {
			type: String,
			default: 'left',
		},

		// Why the chosen spread does not show right now, otherwise empty
		spreadUnavailable: {
			type: String,
			default: '',
		},

		// [{value, label}] - 'full', 'ex<N>', 'part<id>' (lib/variantChoice.js)
		variantSources: {
			type: Array,
			default: () => [],
		},

		variantSource: {
			type: String,
			default: 'full',
		},

		// 'orig' | 'phone' | 'phonel'
		variantFormat: {
			type: String,
			default: 'orig',
		},

		variantConcert: {
			type: Boolean,
			default: false,
		},

		// Only where some instrument does not sound as written
		showConcert: {
			type: Boolean,
			default: false,
		},

		// Why the server makes no variants, otherwise empty
		variantUnavailable: {
			type: String,
			default: '',
		},
	},

	emits: ['update:layout', 'update:doublePage', 'update:variantSource', 'update:variantFormat', 'update:variantConcert'],

	// Popovers into the viewer while it is fullscreen (useFullscreenContainer.js).
	setup() {
		return useFullscreenContainer()
	},

	computed: {
		options() {
			return [
				{ value: 'pages', label: this.t('Pages'), reason: '' },
				{ value: 'band', label: this.t('System band (staves side by side, for phones)'), reason: '' },
				{ value: 'lyrics', label: this.t('Lyrics only'), reason: this.lyricsUnavailable },
			]
		},

		selectedSource() {
			return this.variantSources.find((o) => o.value === this.variantSource) ?? this.variantSources[0] ?? null
		},

		formatOptions() {
			return [
				{ value: 'orig', label: this.t('As in the file') },
				{ value: 'phone', label: this.t('Phone, upright') },
				{ value: 'phonel', label: this.t('Phone, landscape') },
			]
		},

		spreadOptions() {
			return [
				{ value: 'off', label: this.t('Off') },
				{ value: 'left', label: this.t('Page 1 on the left') },
				{ value: 'right', label: this.t('Page 1 on the right') },
			]
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
