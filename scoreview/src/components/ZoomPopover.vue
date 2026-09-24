<template>
	<NcPopover>
		<template #trigger>
			<NcButton :aria-label="t('Zoom')" :title="t('Zoom')">
				<template #icon>
					<Magnify :size="20" />
				</template>
			</NcButton>
		</template>
		<template #default>
			<div class="scoreview-popover">
				<label class="scoreview-popover-label">
					{{ t('Zoom') }}: {{ percent }}%
					<input
						type="range"
						:min="min"
						:max="max"
						step="0.05"
						:value="zoom"
						:aria-label="t('Zoom')"
						@input="$emit('input', $event)">
				</label>
				<NcButton wide @click="$emit('preset', 'width')">
					<template #icon>
						<ArrowExpandHorizontal :size="20" />
					</template>
					{{ t('Fit page width') }}
				</NcButton>
				<NcButton wide @click="$emit('preset', 'page')">
					<template #icon>
						<FitToPage :size="20" />
					</template>
					{{ t('Fit whole page') }}
				</NcButton>
				<NcButton wide @click="$emit('preset', 'actual')">
					<template #icon>
						<Magnify :size="20" />
					</template>
					{{ t('Actual size') }}
				</NcButton>
			</div>
		</template>
	</NcPopover>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcPopover from '@nextcloud/vue/components/NcPopover'
import ArrowExpandHorizontal from 'vue-material-design-icons/ArrowExpandHorizontal.vue'
import FitToPage from 'vue-material-design-icons/FitToPage.vue'
import Magnify from 'vue-material-design-icons/Magnify.vue'

/**
 * Der Zoom der Bedienleiste: Regler und die drei Voreinstellungen. Rechnen
 * und Merken ist Sache von useZoom.js - hier wird nur angezeigt und
 * gemeldet.
 */
export default {
	name: 'ZoomPopover',

	components: {
		ArrowExpandHorizontal,
		FitToPage,
		Magnify,
		NcButton,
		NcPopover,
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
	},

	// `input` reicht das rohe Ereignis weiter (useZoom.onInput liest
	// event.target), `preset` den Namen: 'width' | 'page' | 'actual'.
	emits: ['input', 'preset'],

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>
