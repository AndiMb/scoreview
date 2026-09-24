<template>
	<!--
		Eine Karte ueber dem Notenbild (Mixer, Notizen, Probe, …): Rahmen,
		Ueberschrift und Schliessen-Knopf an EINER Stelle. Der Inhalt bleibt
		als Slot im Template des Viewers - er ist dort verdrahtet, und seine
		scoped Styles greifen weiter (Slotinhalt traegt die Scope-ID des
		Elternteils).
	-->
	<section class="scoreview-panel">
		<div v-if="title" class="scoreview-panel-head">
			<h3>{{ title }}</h3>
			<NcButton :aria-label="t('Close')" :title="t('Close')" @click="$emit('close')">
				<template #icon>
					<Close :size="20" />
				</template>
			</NcButton>
		</div>
		<slot />
	</section>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import Close from 'vue-material-design-icons/Close.vue'

export default {
	name: 'ScorePanel',

	components: {
		Close,
		NcButton,
	},

	props: {
		// Ohne Ueberschrift auch ohne Kopfzeile - fuer einen reinen Hinweis
		// wie den wartenden Stempel, der seinen eigenen Abbrechen-Knopf hat.
		title: {
			type: String,
			default: '',
		},
	},

	emits: ['close'],

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped>
.scoreview-panel {
	pointer-events: auto;
	box-sizing: border-box;
	background: var(--color-main-background);
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large, 8px);
	box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
	padding: 8px 12px 12px 12px;
	max-height: 100%;
	overflow-y: auto;
}

.scoreview-panel-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.scoreview-panel-head h3 {
	margin: 0;
	font-size: 1.1em;
}
</style>
