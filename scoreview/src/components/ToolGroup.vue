<template>
	<!--
		Eine Werkzeuggruppe der Leiste (lib/barGroups.js): ein Knopf, dahinter
		EIN Aufklapper. Werkzeuge mit eigenem Bedienfeld (Loop, Tempo,
		Darstellung) oeffnen darin eine Unterseite mit Zurueck-Pfeil statt
		eines zweiten Aufklappers - verschachtelte Aufklapper sind auf dem
		Tablet ein Geduldsspiel, und jedes Werkzeug ist so hoechstens einen
		Tipp weiter weg als frueher als eigener Knopf.

		Wie ScoreBar nur Gestalt: Was in der Gruppe steht und was es tut,
		verdrahtet der Viewer ueber die Slots.
	-->
	<NcPopover v-model:shown="shown" popupRole="dialog">
		<template #trigger>
			<NcButton :aria-label="label" :title="label">
				<template #icon>
					<span class="scoreview-group-icon">
						<slot name="icon" />
						<!-- Aktiv in der Gruppe: sichtbar, ohne sie zu oeffnen. -->
						<span v-if="active" class="scoreview-group-dot" />
					</span>
				</template>
			</NcButton>
		</template>
		<template #default>
			<div class="scoreview-popover scoreview-group" role="group" :aria-label="label">
				<template v-if="page === null">
					<slot :openPage="openPage" :close="close" />
				</template>
				<template v-else>
					<div class="scoreview-group-head">
						<NcButton
							variant="tertiary"
							:aria-label="t('Back')"
							:title="t('Back')"
							@click="page = null">
							<template #icon>
								<ArrowLeft :size="20" />
							</template>
						</NcButton>
						<h3 ref="heading" class="scoreview-group-title" tabindex="-1">
							{{ pageTitle }}
						</h3>
					</div>
					<!-- Hohe Unterseiten (Loop mit Tempotrainer) scrollen in
						sich, statt den Aufklapper aus dem Bild zu schieben. -->
					<div class="scoreview-group-page">
						<slot :name="'page-' + page" :close="close" />
					</div>
				</template>
			</div>
		</template>
	</NcPopover>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcPopover from '@nextcloud/vue/components/NcPopover'
import ArrowLeft from 'vue-material-design-icons/ArrowLeft.vue'

export default {
	name: 'ToolGroup',

	components: {
		ArrowLeft,
		NcButton,
		NcPopover,
	},

	props: {
		// Name der Gruppe, zugleich Beschriftung des Knopfes.
		label: {
			type: String,
			required: true,
		},

		// Ist darin etwas eingeschaltet? (lib/barGroups.js groupActive)
		active: {
			type: Boolean,
			default: false,
		},
	},

	data() {
		return {
			shown: false,
			// Die offene Unterseite, oder null fuer die Liste.
			page: null,
			pageTitle: '',
		}
	},

	watch: {
		// Wer die Gruppe wieder oeffnet, sucht in der Liste - nicht auf der
		// Unterseite, auf der er sie zuletzt verlassen hat.
		shown(isShown) {
			if (!isShown) {
				this.page = null
			}
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		/**
		 * Eine Unterseite oeffnen. Der Fokus geht auf ihre Ueberschrift,
		 * damit Tastatur und Vorlesewerkzeug mitkommen.
		 *
		 * @param {string} id Name des Slots `page-<id>`
		 * @param {string} title
		 */
		async openPage(id, title) {
			this.page = id
			this.pageTitle = title
			await this.$nextTick()
			this.$refs.heading?.focus()
		},

		close() {
			this.shown = false
		},
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>

<style scoped>
.scoreview-group {
	gap: 4px;
}

.scoreview-group-icon {
	position: relative;
	display: inline-flex;
}

/* Derselbe Punkt wie am „Mehr"-Knopf (ScoreBar.vue). */
.scoreview-group-dot {
	position: absolute;
	inset-block-start: -2px;
	inset-inline-end: -2px;
	inline-size: 8px;
	block-size: 8px;
	border-radius: 50%;
	background: var(--color-primary-element);
}

.scoreview-group-head {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-block-end: 4px;
}

.scoreview-group-title {
	margin: 0;
	font-size: 1em;
	font-weight: bold;
}

.scoreview-group-title:focus {
	outline: none;
}

.scoreview-group-page {
	display: flex;
	flex-direction: column;
	gap: 8px;
	max-block-size: min(70vh, 520px);
	overflow-y: auto;
}
</style>
