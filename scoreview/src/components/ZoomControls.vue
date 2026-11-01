<template>
	<div class="scoreview-controls">
		<label class="scoreview-popover-label">
			{{ t('Zoom') }}: {{ shownPercent }}%
			<input
				type="range"
				:min="min"
				:max="max"
				step="0.05"
				:value="zoom"
				:aria-label="t('Zoom')"
				@input="onInput"
				@change="$emit('change')">
		</label>
		<NcButton v-if="presets.includes('width')" wide @click="$emit('preset', 'width')">
			<template #icon>
				<ArrowExpandHorizontal :size="20" />
			</template>
			{{ t('Fit page width') }}
		</NcButton>
		<NcButton v-if="presets.includes('page')" wide @click="$emit('preset', 'page')">
			<template #icon>
				<FitToPage :size="20" />
			</template>
			{{ t('Fit whole page') }}
		</NcButton>
		<NcButton v-if="presets.includes('actual')" wide @click="$emit('preset', 'actual')">
			<template #icon>
				<Magnify :size="20" />
			</template>
			{{ t('Actual size') }}
		</NcButton>
		<NcButton v-if="presets.includes('default')" wide @click="$emit('preset', 'default')">
			<template #icon>
				<Restore :size="20" />
			</template>
			{{ t('Default size') }}
		</NcButton>
	</div>
</template>

<script>
import NcButton from '@nextcloud/vue/components/NcButton'
import ArrowExpandHorizontal from 'vue-material-design-icons/ArrowExpandHorizontal.vue'
import FitToPage from 'vue-material-design-icons/FitToPage.vue'
import Magnify from 'vue-material-design-icons/Magnify.vue'
import Restore from 'vue-material-design-icons/Restore.vue'
import { translate } from '../l10n.js'

/**
 * Der Zoom der Bedienleiste: Regler und die drei Voreinstellungen, direkt
 * oben in der Gruppe „Ansicht" (ohne Unterseite - im Auffuehrungsmodus ist
 * er dort das einzige Werkzeug). Rechnen
 * und Merken ist Sache von useZoom.js - hier wird nur angezeigt und
 * gemeldet.
 */
export default {
	name: 'ZoomControls',

	components: {
		ArrowExpandHorizontal,
		FitToPage,
		Magnify,
		NcButton,
		Restore,
	},

	props: {
		zoom: {
			type: Number,
			required: true,
		},

		percent: {
			type: Number,
			required: true,
		},

		min: {
			type: Number,
			required: true,
		},

		max: {
			type: Number,
			required: true,
		},

		// The presets on offer: the page view fits pages ('width', 'page',
		// 'actual'), the system band only knows its default size ('default').
		presets: {
			type: Array,
			default: () => ['width', 'page', 'actual'],
		},
	},

	// `input` reicht das rohe Ereignis weiter (event.target.value), `change`
	// says the slider was let go, `preset` den Namen: 'width' | 'page' |
	// 'actual' | 'default'.
	emits: ['input', 'change', 'preset'],

	data() {
		return {
			// The value being dragged. The zoom itself is set only when the
			// slider is let go (zoomGesture.js), so the percentage follows the
			// thumb from here - re-rendering only this, not the viewer.
			dragged: null,
		}
	},

	computed: {
		shownPercent() {
			return this.dragged === null ? this.percent : Math.round(this.dragged * 100)
		},
	},

	watch: {
		// Set at last (or set elsewhere): the prop speaks again.
		zoom() {
			this.dragged = null
		},
	},

	methods: {
		onInput(event) {
			this.dragged = Number(event.target.value)
			this.$emit('input', event)
		},

		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>
