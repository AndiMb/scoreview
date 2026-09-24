<template>
	<!--
		Die Anzeige einer laufenden „Folgt mir"-Sitzung: wer leitet, ob
		dieses Geraet folgt und ob die Verbindung steht. Ein schmaler Streifen
		ueber den Noten statt einer eigenen Zeile - er kostet keine Hoehe und
		bleibt auch im Aufführungsmodus sichtbar, wo die Leiste nur noch
		Blaettern und Zoom kennt.

		role="status": Ein Wechsel („getrennt", „folgt nicht") soll auch ein
		Screenreader ansagen, ohne dass jemand den Fokus dorthin legt.
	-->
	<div
		class="scoreview-follow-badge"
		:class="{
			'scoreview-follow-badge--paused': !mine && detached,
			'scoreview-follow-badge--offline': offline,
		}"
		role="status">
		<AccountVoice v-if="mine" :size="18" />
		<LanDisconnect v-else-if="offline" :size="18" />
		<LanConnect v-else :size="18" />
		<span class="scoreview-follow-badge-text">{{ text }}</span>
		<!--
			Der Knopf steht nur da, wo er etwas bewirkt. Er ist bewusst
			kein Symbolknopf: Wer sich versehentlich geloest hat, soll ihn
			ohne Raten finden.
		-->
		<NcButton
			v-if="!mine && detached"
			variant="primary"
			size="small"
			class="scoreview-follow-resume"
			@click="$emit('resume')">
			{{ t('Back to the leader') }}
		</NcButton>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import AccountVoice from 'vue-material-design-icons/AccountVoice.vue'
import LanConnect from 'vue-material-design-icons/LanConnect.vue'
import LanDisconnect from 'vue-material-design-icons/LanDisconnect.vue'

/**
 * „Folgt: Name · verbunden/getrennt" (E10). Nur Darstellung - der
 * Zustand kommt aus useFollowSession.js.
 */
export default {
	name: 'FollowBadge',

	components: {
		AccountVoice,
		LanConnect,
		LanDisconnect,
		NcButton,
	},

	props: {
		leaderName: { type: String, default: '' },
		mine: { type: Boolean, default: false },
		// Gerade nicht folgend (eigenes Navigieren). Als „abgeloest"
		// statt als „folgt", damit die Vorgabe false sein kann.
		detached: { type: Boolean, default: false },
		// Verbindung verloren
		offline: { type: Boolean, default: false },
	},

	emits: ['resume'],

	computed: {
		/**
		 * EIN Satz statt einzelner Teile: Die Reihenfolge von Name und Zustand
		 * ist je Sprache verschieden, und ein Screenreader liest ihn am Stueck.
		 *
		 * @return {string}
		 */
		text() {
			const name = this.leaderName
			if (this.mine) {
				return this.offline
					? this.t('You are leading “Follow me” · disconnected')
					: this.t('You are leading “Follow me”')
			}
			if (!this.detached) {
				return this.offline
					? this.t('Following: {name} · disconnected', { name })
					: this.t('Following: {name} · connected', { name })
			}
			return this.offline
				? this.t('Not following {name} · disconnected', { name })
				: this.t('Not following {name}', { name })
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
.scoreview-follow-badge {
	display: flex;
	align-items: center;
	gap: 6px;
	max-width: calc(100% - 24px);
	padding: 2px 4px 2px 10px;
	border-radius: var(--border-radius-pill, 20px);
	/* Flaechenfarben aus dem Theme: Die Anzeige liegt ueber den Noten und
	   muss sich in hell und dunkel vom Papier abheben. */
	background-color: var(--color-primary-element-light);
	color: var(--color-primary-element-light-text);
	box-shadow: 0 1px 4px var(--color-box-shadow);
	font-size: var(--font-size-small, 13px);
	min-height: 32px;
}

.scoreview-follow-badge--paused {
	background-color: var(--color-warning);
	color: var(--color-warning-text, var(--color-main-background));
}

.scoreview-follow-badge--offline {
	background-color: var(--color-error);
	color: var(--color-error-text, var(--color-main-background));
}

.scoreview-follow-badge-text {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	padding-inline-end: 6px;
}
</style>
