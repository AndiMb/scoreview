<template>
	<div class="scoreview-leaders">
		<h4>{{ t('Leaders') }}</h4>
		<!--
			Die Liste sehen alle mit Dateizugriff - wer leitet, soll
			niemand erfragen muessen. Nur Leitungen bekommen den Knopf zum
			Abberufen, und nur an Eintraegen, die der Server als abberufbar
			meldet (nie an der Eigentuemerin, E9).
		-->
		<ul class="scoreview-leaders-list">
			<li v-for="(leader, i) in leaders" :key="leader.userId ?? i" class="scoreview-leaders-row">
				<AccountStar v-if="leader.isOwner" :size="20" />
				<Account v-else :size="20" />
				<span class="scoreview-leaders-name">
					{{ leader.displayName }}
					<span v-if="leader.isOwner || leader.me" class="scoreview-leaders-tag">{{ tags(leader) }}</span>
				</span>
				<NcButton
					v-if="isLeader && leader.canRevoke"
					variant="tertiary"
					:aria-label="t('Remove {name} as leader', { name: leader.displayName })"
					:title="t('Remove {name} as leader', { name: leader.displayName })"
					@click="$emit('revoke', leader.userId)">
					<template #icon>
						<AccountRemove :size="20" />
					</template>
				</NcButton>
			</li>
		</ul>
		<p v-if="leaders.length === 0" class="scoreview-leaders-hint">
			{{ t('No leaders yet.') }}
		</p>

		<template v-if="isLeader">
			<NcTextField
				:modelValue="query"
				:label="t('Appoint a leader')"
				:placeholder="t('Search by name')"
				trailingButtonIcon="close"
				:showTrailingButton="query !== ''"
				@trailingButtonClick="setQuery('')"
				@update:modelValue="setQuery" />
			<ul v-if="candidates.length > 0" class="scoreview-leaders-list">
				<li v-for="candidate in candidates" :key="candidate.userId" class="scoreview-leaders-row">
					<Account :size="20" />
					<span class="scoreview-leaders-name">{{ candidate.displayName }}</span>
					<NcButton
						variant="secondary"
						:aria-label="t('Appoint {name} as leader', { name: candidate.displayName })"
						@click="appoint(candidate.userId)">
						<template #icon>
							<AccountPlus :size="20" />
						</template>
						{{ t('Appoint') }}
					</NcButton>
				</li>
			</ul>
			<!--
				Die Suche filtert auf den Dateizugriff. Ohne diesen
				Hinweis saehe eine leere Liste aus wie ein Fehler, obwohl die
				gesuchte Person die Partitur schlicht nicht sieht.
			-->
			<p v-else-if="searched" class="scoreview-leaders-hint">
				{{ t('Nobody found. Only people who can open this score can lead it.') }}
			</p>
		</template>
		<p v-else class="scoreview-leaders-hint">
			{{ t('Leaders can appoint other leaders.') }}
		</p>

		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>

		<!--
			„Folgt mir" (C) haengt an der Leitungsrolle und steht deshalb hier.
			Mit abgeschalteter Funktion fehlt der ganze Abschnitt - eine
			Ueberschrift ohne Wirkung waere eine falsche Auskunft.
		-->
		<template v-if="followEnabled">
			<!--
				Die Knoepfe bleiben waehrend einer Anfrage bedienbar: Der
				letzte Tipp gewinnt (lib/leaderQueue.js). Dass noch etwas
				unterwegs ist, zeigt nur ein kleines Rad - erst nach einer
				kurzen Verzoegerung, damit es bei einer schnellen Antwort nicht
				bei jedem Tipp aufblitzt.
			-->
			<h4 class="scoreview-follow-title" :aria-busy="followBusy ? 'true' : 'false'">
				{{ t('Follow me') }}
				<NcLoadingIcon
					v-if="followBusy"
					class="scoreview-follow-pending"
					:size="16"
					:name="t('Sending…')" />
			</h4>
			<template v-if="isLeader">
				<template v-if="!followActive">
					<p class="scoreview-leaders-hint">
						{{ t('Everyone who has this score open follows the position, loop and starting note you send.') }}
					</p>
					<NcButton
						variant="primary"
						wide
						@click="$emit('followStart')">
						<template #icon>
							<Broadcast :size="20" />
						</template>
						{{ t('Start “Follow me”') }}
					</NcButton>
				</template>
				<template v-else-if="!followMine">
					<!--
						Uebernehmen statt nebenher senden: Es gibt hoechstens
						eine Sitzung, und wer sie leitet, sehen alle.
					-->
					<p class="scoreview-leaders-hint">
						{{ t('{name} is leading “Follow me”.', { name: followLeaderName }) }}
					</p>
					<div class="scoreview-follow-row">
						<NcButton variant="primary" @click="$emit('followStart')">
							<template #icon>
								<AccountSwitch :size="20" />
							</template>
							{{ t('Take over') }}
						</NcButton>
						<NcButton @click="$emit('followEnd')">
							<template #icon>
								<StopCircle :size="20" />
							</template>
							{{ t('End session') }}
						</NcButton>
					</div>
				</template>
				<template v-else>
					<div class="scoreview-follow-row">
						<NcButton variant="primary" @click="$emit('followPosition')">
							<template #icon>
								<CrosshairsGps :size="20" />
							</template>
							{{ t('Send my position') }}
						</NcButton>
						<NcButton @click="$emit('followLoop')">
							<template #icon>
								<Repeat :size="20" />
							</template>
							{{ loopActive ? t('Send loop') : t('Clear loop for everyone') }}
						</NcButton>
						<NcButton @click="$emit('followTone')">
							<template #icon>
								<MusicNote :size="20" />
							</template>
							{{ t('Starting note for everyone') }}
						</NcButton>
					</div>
					<!--
						Ein Buchstabe ist in der Probe DIE Ansage („ab C") - ein Tipp
						bringt alle dorthin, die Leitung eingeschlossen.
					-->
					<div
						v-if="marks.length > 0"
						class="scoreview-follow-marks"
						role="group"
						:aria-label="t('Send a rehearsal mark')">
						<NcButton
							v-for="mark in marks"
							:key="mark.measure + ':' + mark.text"
							:aria-label="t('Everyone to rehearsal mark {mark} (measure {n})', { mark: mark.text, n: mark.measure })"
							@click="$emit('followMark', mark)">
							{{ mark.text }}
						</NcButton>
					</div>
					<NcButton wide @click="$emit('followEnd')">
						<template #icon>
							<StopCircle :size="20" />
						</template>
						{{ t('End “Follow me”') }}
					</NcButton>
				</template>
			</template>
			<p v-else class="scoreview-leaders-hint">
				{{ followActive
					? t('{name} is leading “Follow me”.', { name: followLeaderName })
					: t('Leaders can start “Follow me”: everyone then follows their position.') }}
			</p>
			<NcNoteCard v-if="followError" type="error">
				{{ followError }}
			</NcNoteCard>
		</template>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import Account from 'vue-material-design-icons/Account.vue'
import AccountPlus from 'vue-material-design-icons/AccountPlus.vue'
import AccountRemove from 'vue-material-design-icons/AccountRemove.vue'
import AccountStar from 'vue-material-design-icons/AccountStar.vue'
import AccountSwitch from 'vue-material-design-icons/AccountSwitch.vue'
import Broadcast from 'vue-material-design-icons/Broadcast.vue'
import CrosshairsGps from 'vue-material-design-icons/CrosshairsGps.vue'
import MusicNote from 'vue-material-design-icons/MusicNote.vue'
import Repeat from 'vue-material-design-icons/Repeat.vue'
import StopCircle from 'vue-material-design-icons/StopCircle.vue'
import { candidateQuery } from '../lib/leaders.js'

/**
 * Die Leitungen einer Partitur im Aufklapper „Probe" und die Bedienung
 * von „Folgt mir" (C). Nur Darstellung - Laden, Ernennen, Abberufen und
 * Suchen stehen in useLeaders.js, die Sitzung in useFollowSession.js.
 */
export default {
	name: 'LeaderPanel',

	components: {
		Account,
		AccountPlus,
		AccountRemove,
		AccountStar,
		AccountSwitch,
		Broadcast,
		CrosshairsGps,
		MusicNote,
		NcButton,
		NcLoadingIcon,
		NcNoteCard,
		NcTextField,
		Repeat,
		StopCircle,
	},

	props: {
		leaders: { type: Array, required: true },
		isLeader: { type: Boolean, default: false },
		candidates: { type: Array, default: () => [] },
		error: { type: String, default: '' },
		// „Folgt mir" (useFollowSession.js)
		followEnabled: { type: Boolean, default: false },
		followActive: { type: Boolean, default: false },
		followMine: { type: Boolean, default: false },
		followLeaderName: { type: String, default: '' },
		// Eine Leitungs-Aktion ist unterwegs oder wartet - nur Anzeige, sperrt nichts.
		followBusy: { type: Boolean, default: false },
		followError: { type: String, default: '' },
		// Studierbuchstaben der Partitur ({text, measure}) - zum Senden
		marks: { type: Array, default: () => [] },
		loopActive: { type: Boolean, default: false },
	},

	emits: ['appoint', 'revoke', 'search', 'followStart', 'followEnd', 'followPosition', 'followMark', 'followLoop', 'followTone'],

	data() {
		return {
			query: '',
			searchTimer: null,
		}
	},

	computed: {
		/** Erst nach einer echten Suche ist eine leere Trefferliste eine Aussage. */
		searched() {
			return candidateQuery(this.query) !== null
		},
	},

	beforeUnmount() {
		clearTimeout(this.searchTimer)
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		/**
		 * Die Zusaetze hinter dem Namen als EIN Text: Zwei Elemente
		 * nebeneinander verloeren im Template den Zwischenraum und laesen
		 * sich fuer einen Screenreader als ein Wort.
		 *
		 * @param {{isOwner: boolean, me: boolean}} leader Eintrag der Liste
		 * @return {string}
		 */
		tags(leader) {
			return [leader.isOwner ? this.t('owner') : null, leader.me ? this.t('you') : null]
				.filter(Boolean)
				.join(' · ')
		},

		/**
		 * Kurz warten, bis das Tippen ruht: Jeder Buchstabe waere sonst eine
		 * Anfrage samt Dateibaum-Pruefung je Treffer auf dem Server.
		 *
		 * @param {string} value Eingabe
		 */
		setQuery(value) {
			this.query = value
			clearTimeout(this.searchTimer)
			this.searchTimer = setTimeout(() => this.$emit('search', value), 250)
		},

		/**
		 * Nach dem Ernennen die Suche leeren: Die ernannte Person faellt aus
		 * den Treffern, und eine stehengebliebene Suche meldete dann
		 * „Niemand gefunden" - als waere etwas schiefgegangen.
		 *
		 * @param {string} userId die zu ernennende Person
		 */
		appoint(userId) {
			this.$emit('appoint', userId)
			this.setQuery('')
		},
	},
}
</script>

<style scoped>
.scoreview-leaders {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

/* Unterueberschrift unter dem Panel-Titel „Probe" - nicht groesser als er. */
.scoreview-leaders h4 {
	margin: 0;
	font-size: var(--default-font-size);
	font-weight: bold;
}

.scoreview-follow-title {
	display: flex;
	align-items: center;
	gap: 6px;
}

.scoreview-follow-pending {
	animation: scoreview-follow-pending-in 150ms 200ms both;
}

@keyframes scoreview-follow-pending-in {
	from {
		opacity: 0;
	}

	to {
		opacity: 1;
	}
}

.scoreview-leaders-list {
	display: flex;
	flex-direction: column;
	gap: 2px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.scoreview-leaders-row {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: var(--default-clickable-area);
}

.scoreview-leaders-name {
	flex: 1;
	min-width: 0;
	overflow-wrap: anywhere;
}

.scoreview-leaders-tag {
	margin-inline-start: 4px;
	color: var(--color-text-maxcontrast);
	font-size: var(--font-size-small, 13px);
}

.scoreview-leaders-hint {
	margin: 0;
	color: var(--color-text-maxcontrast);
}

.scoreview-follow-row,
.scoreview-follow-marks {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
</style>
