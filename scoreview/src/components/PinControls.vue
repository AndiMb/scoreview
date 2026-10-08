<template>
	<!--
		„Offline vormerken" (H9): erst sagen, was es kostet, dann laden. Die
		Offline-Seite selbst muss einmal mit Netz geoeffnet worden sein, sonst
		kennt der Browser sie ohne Netz nicht (V8) - darauf weist der Link hin.
	-->
	<div class="scoreview-controls">
		<p v-if="checking" class="scoreview-popover-hint">
			{{ t('Checking…') }}
		</p>
		<template v-else-if="info">
			<p v-if="info.notReady" class="scoreview-popover-hint">
				{{ t('Open every piece once until it is shown, then try again.') }}
			</p>
			<p v-else class="scoreview-popover-hint">
				{{ info.free !== null
					? t('Needs about {size} MB of {free} MB free in this browser.', { size: mb(info.bytes), free: mb(info.free) })
					: t('Needs about {size} MB in this browser.', { size: mb(info.bytes) }) }}
			</p>
			<NcButton
				:disabled="busy || info.notReady"
				variant="primary"
				wide
				@click="$emit('pin', target)">
				{{ info.pinned ? t('Save again') : t('Save for offline use') }}
			</NcButton>
		</template>
		<NcCheckboxRadioSwitch
			v-if="setlistId !== null"
			:modelValue="whole"
			type="switch"
			@update:modelValue="whole = $event">
			{{ t('The whole setlist') }}
		</NcCheckboxRadioSwitch>
		<NcProgressBar v-if="busy" :value="Math.round(progress * 100)" />
		<p v-if="done" class="scoreview-popover-hint">
			{{ done }}
		</p>
		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>
		<p class="scoreview-popover-hint">
			{{ t('Without a network, open the offline page. Open it once now so the browser knows it.') }}
			<a :href="offlinePage" target="_blank" rel="noopener">{{ t('Offline page') }}</a>
		</p>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcProgressBar from '@nextcloud/vue/components/NcProgressBar'

export default {
	name: 'PinControls',

	components: {
		NcButton,
		NcCheckboxRadioSwitch,
		NcNoteCard,
		NcProgressBar,
	},

	props: {
		fileId: {
			type: [Number, String],
			required: true,
		},

		// Die offene Setliste, sonst null
		setlistId: {
			type: [Number, String],
			default: null,
		},

		// Titel fuer die Liste der Offline-Seite (Material, nicht uebersetzt)
		title: {
			type: String,
			default: '',
		},

		setlistTitle: {
			type: String,
			default: '',
		},

		estimate: {
			type: Function,
			required: true,
		},

		busy: Boolean,
		progress: {
			type: Number,
			default: 0,
		},

		done: {
			type: String,
			default: '',
		},

		error: {
			type: String,
			default: '',
		},
	},

	emits: ['pin'],

	data() {
		return {
			whole: this.setlistId !== null,
			info: null,
			checking: false,
			offlinePage: generateUrl('/apps/scoreview/offline'),
		}
	},

	computed: {
		target() {
			return this.whole && this.setlistId !== null
				? { setlistId: Number(this.setlistId), title: this.setlistTitle || this.title }
				: { fileId: Number(this.fileId), title: this.title }
		},
	},

	watch: {
		target: {
			handler() {
				this.check()
			},

			immediate: true,
		},

		busy(now) {
			if (!now) {
				this.check()
			}
		},
	},

	methods: {
		t: (text, vars) => translate('scoreview', text, vars),

		async check() {
			this.checking = true
			try {
				this.info = await this.estimate(this.target)
			} catch {
				this.info = null
			} finally {
				this.checking = false
			}
		},

		mb(bytes) {
			return (bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)
		},
	},
}
</script>
