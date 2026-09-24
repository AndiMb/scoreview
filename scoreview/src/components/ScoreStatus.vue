<template>
	<!--
		Was an der Stelle der Noten steht, solange es keine gibt: Laden,
		Konvertieren oder der Fehler. Nur Anzeige - was als Naechstes passiert,
		entscheidet useConversionStatus.js, und nach dem Konvertierungsweg
		verzweigt hier nichts (E3).
	-->
	<div v-if="state === 'converting' || state === 'loading'" class="scoreview-status">
		<NcLoadingIcon :size="32" :name="state === 'loading' ? t('Loading…') : t('Converting…')" />
		<!--
			Nur beim Rueckfall im Browser gefuellt: Dort dauert das erste
			Oeffnen laenger als sonst, weil die Engine geladen wird - ein
			stummer Kreisel liesse das wie einen Haenger aussehen.
			Serverseitig konvertiert bleibt die Zeile leer, bis es
			ungewoehnlich lange dauert (lib/viewerTexts.js).
		-->
		<p v-if="progressText" class="scoreview-status-detail">
			{{ progressText }}
		</p>
	</div>
	<div v-else-if="state === 'error'" class="scoreview-status scoreview-error">
		<NcEmptyContent :name="t('Error')" :description="errorText">
			<template #icon>
				<AlertCircleOutline :size="48" />
			</template>
		</NcEmptyContent>
		<details v-if="errorCode && errorMessage" class="scoreview-error-detail">
			<summary>{{ t('Technical detail') }}</summary>
			<pre>{{ errorMessage }}</pre>
		</details>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import AlertCircleOutline from 'vue-material-design-icons/AlertCircleOutline.vue'
import { conversionProgressText } from '../lib/viewerTexts.js'

export default {
	name: 'ScoreStatus',

	components: {
		AlertCircleOutline,
		NcEmptyContent,
		NcLoadingIcon,
	},

	props: {
		// Zustand aus useConversionStatus: 'loading' | 'converting' | 'error'.
		state: {
			type: String,
			required: true,
		},

		// Fortschritt der Konvertierung im Browser, null serverseitig.
		clientProgress: {
			type: Object,
			default: null,
		},

		// Ob die Frist fuer den Hinweis auf Cron verstrichen ist.
		longWait: {
			type: Boolean,
			default: false,
		},

		errorText: {
			type: String,
			default: '',
		},

		// Gespeicherter Fehlercode des Servers - nur mit ihm ist die rohe
		// Meldung eine zusaetzliche Angabe statt derselben zweimal.
		errorCode: {
			type: String,
			default: '',
		},

		errorMessage: {
			type: String,
			default: '',
		},
	},

	computed: {
		progressText() {
			return conversionProgressText(this.clientProgress, this.longWait, this.t)
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
.scoreview-status {
	padding: 3rem 1rem;
	text-align: center;
	color: var(--color-text-maxcontrast);
}

.scoreview-status-detail {
	margin-top: 0.5rem;
	font-size: 0.9em;
}

.scoreview-error {
	color: var(--color-error);
}

.scoreview-error-detail {
	display: inline-block;
	text-align: start;
	color: var(--color-text-maxcontrast);
	font-size: 0.9em;
}

.scoreview-error-detail pre {
	white-space: pre-wrap;
	overflow-wrap: break-word;
}
</style>
