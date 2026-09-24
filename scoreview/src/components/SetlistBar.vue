<template>
	<!--
		Die Setliste im Viewer: „Stück 3/12 · Ave verum" mit
		vor und zurück. Ein eigener Streifen über allem anderen, auch über der
		Konvertierungsanzeige - wer im Konzert an einem Stück hängt, das
		gerade noch konvertiert oder gar nicht geht, muss trotzdem weiter
		können.

		Ohne aktive Liste ist es das Angebot aus Weg 2: „Steht in der Setliste
		…", wegzuklicken, damit es keine Höhe kostet, wenn niemand es will.
	-->
	<div
		v-if="active"
		class="scoreview-setlist-bar"
		role="navigation"
		:aria-label="t('Setlist')">
		<NcButton
			class="scoreview-setlist-prev"
			:disabled="!canNavigate || !position.hasPrevious"
			:aria-label="t('Previous piece')"
			:title="t('Previous piece')"
			@click="$emit('previous')">
			<template #icon>
				<ChevronLeft :size="20" />
			</template>
		</NcButton>
		<NcPopover v-model:shown="listOpen" class="scoreview-setlist-popover">
			<template #trigger>
				<NcButton
					class="scoreview-setlist-title"
					variant="tertiary"
					:aria-label="t('Setlist {title}: show all pieces', { title })"
					:title="title">
					<template #icon>
						<PlaylistMusic :size="20" />
					</template>
					<span class="scoreview-setlist-text">{{ label }}</span>
				</NcButton>
			</template>
			<template #default>
				<div class="scoreview-setlist-list">
					<p class="scoreview-setlist-heading">
						{{ title }}
					</p>
					<ol>
						<!--
							Fehlende Einträge stehen durchgestrichen in der Liste,
							statt zu verschwinden: Die Nummern sollen mit
							dem Blatt der anderen übereinstimmen, und wer ein
							Stück vermisst, sieht, dass es daran liegt.
						-->
						<li
							v-for="(entry, i) in entries"
							:key="i"
							:class="{
								'scoreview-setlist-entry--current': i === index,
								'scoreview-setlist-entry--missing': entry.status !== 'ok',
							}">
							<button
								v-if="entry.status === 'ok' && canNavigate"
								type="button"
								class="scoreview-setlist-entry"
								:aria-current="i === index ? 'true' : undefined"
								@click="choose(i)">
								{{ entry.label }}
							</button>
							<span
								v-else
								class="scoreview-setlist-entry"
								:title="entry.status === 'ok' ? '' : missingText(entry)">
								<s v-if="entry.status !== 'ok'">{{ entry.label }}</s>
								<template v-else>{{ entry.label }}</template>
							</span>
						</li>
					</ol>
				</div>
			</template>
		</NcPopover>
		<NcButton
			class="scoreview-setlist-next"
			:disabled="!canNavigate || !position.hasNext"
			:aria-label="t('Next piece')"
			:title="t('Next piece')"
			@click="$emit('next')">
			<template #icon>
				<ChevronRight :size="20" />
			</template>
		</NcButton>
		<NcButton
			v-if="canManage && canEdit"
			class="scoreview-setlist-edit"
			variant="tertiary"
			:aria-label="t('Edit setlist')"
			:title="t('Edit setlist')"
			@click="$emit('edit')">
			<template #icon>
				<Pencil :size="20" />
			</template>
		</NcButton>
		<NcButton
			v-if="canManage"
			variant="tertiary"
			:aria-label="t('Leave setlist')"
			:title="t('Leave setlist')"
			@click="$emit('close')">
			<template #icon>
				<Close :size="20" />
			</template>
		</NcButton>
	</div>
	<div v-else-if="offers.length > 0 && !offerDismissed" class="scoreview-setlist-bar scoreview-setlist-offer">
		<PlaylistMusic :size="20" />
		<template v-if="offers.length === 1">
			<span class="scoreview-setlist-text">{{ t('This score is in the setlist “{title}”.', { title: offers[0].title }) }}</span>
			<NcButton variant="primary" class="scoreview-setlist-accept" @click="$emit('accept', offers[0])">
				{{ t('Open setlist') }}
			</NcButton>
		</template>
		<!--
			Steht die Partitur in mehreren Listen, wählt die Nutzerin -
			geraten wird nicht. Kein Plural nötig: Dieser Zweig heißt „mehrere".
		-->
		<template v-else>
			<span class="scoreview-setlist-text">{{ t('This score is in {n} setlists.', { n: offers.length }) }}</span>
			<NcPopover>
				<template #trigger>
					<NcButton variant="primary" class="scoreview-setlist-accept">
						{{ t('Choose setlist') }}
					</NcButton>
				</template>
				<template #default>
					<div class="scoreview-setlist-list">
						<ul>
							<li v-for="offer in offers" :key="offer.id">
								<button type="button" class="scoreview-setlist-entry" @click="$emit('accept', offer)">
									{{ offer.title }}
								</button>
							</li>
						</ul>
					</div>
				</template>
			</NcPopover>
		</template>
		<NcButton
			variant="tertiary"
			:aria-label="t('Dismiss')"
			:title="t('Dismiss')"
			@click="$emit('dismiss')">
			<template #icon>
				<Close :size="20" />
			</template>
		</NcButton>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcPopover from '@nextcloud/vue/components/NcPopover'
import ChevronLeft from 'vue-material-design-icons/ChevronLeft.vue'
import ChevronRight from 'vue-material-design-icons/ChevronRight.vue'
import Close from 'vue-material-design-icons/Close.vue'
import Pencil from 'vue-material-design-icons/Pencil.vue'
import PlaylistMusic from 'vue-material-design-icons/PlaylistMusic.vue'

/**
 * Nur Darstellung - Zustand und Blättern stehen in useSetlist.js und
 * lib/setlistNav.js. Ob vor/zurück gerade wirken dürfen, entscheidet
 * lib/interactionPolicy.js (`nextPiece`, auch im Aufführungsmodus).
 */
export default {
	name: 'SetlistBar',

	components: {
		ChevronLeft,
		ChevronRight,
		Close,
		NcButton,
		NcPopover,
		Pencil,
		PlaylistMusic,
	},

	props: {
		active: { type: Boolean, default: false },
		title: { type: String, default: '' },
		entries: { type: Array, default: () => [] },
		index: { type: Number, default: null },
		/** {number, total, hasNext, hasPrevious} aus lib/setlistNav.js */
		position: { type: Object, required: true },
		canEdit: { type: Boolean, default: false },
		/** Blättern erlaubt (Policy `nextPiece`) */
		canNavigate: { type: Boolean, default: false },
		/** Bearbeiten und Verlassen (Policy `settings`) - im Aufführungsmodus aus */
		canManage: { type: Boolean, default: false },
		offers: { type: Array, default: () => [] },
		offerDismissed: { type: Boolean, default: false },
	},

	emits: ['previous', 'next', 'goTo', 'edit', 'close', 'accept', 'dismiss'],

	data() {
		return {
			listOpen: false,
		}
	},

	computed: {
		/**
		 * „Stück 3/12 · Ave verum" - EIN Satz, weil sich Reihenfolge und
		 * Trenner je Sprache unterscheiden. Der Titel ist Material aus der
		 * Liste, nicht übersetzt.
		 *
		 * @return {string}
		 */
		label() {
			const entry = this.index === null ? null : this.entries[this.index]
			if (!entry) {
				return this.title
			}
			return this.t('Piece {n}/{total} · {title}', { n: this.position.number, total: this.position.total, title: entry.label })
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		choose(i) {
			this.listOpen = false
			this.$emit('goTo', i)
		},

		/**
		 * @param {{status: string, path: string}} entry
		 * @return {string}
		 */
		missingText(entry) {
			return entry.status === 'unsupported'
				? this.t('Not a MuseScore file: {path}', { path: entry.path })
				: this.t('Not found or no access: {path}', { path: entry.path })
		},
	},
}
</script>

<style scoped>
.scoreview-setlist-bar {
	display: flex;
	align-items: center;
	gap: 4px;
	flex: 0 0 auto;
	min-width: 0;
	padding: 2px 4px;
	border-block-end: 1px solid var(--color-border);
	background-color: var(--color-main-background);
}

.scoreview-setlist-popover {
	flex: 1 1 auto;
	min-width: 0;
	display: flex;
}

.scoreview-setlist-title {
	max-width: 100%;
}

.scoreview-setlist-text {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.scoreview-setlist-offer .scoreview-setlist-text {
	flex: 1 1 auto;
	min-width: 0;
	padding-inline: 4px;
}

.scoreview-setlist-list {
	max-height: 60vh;
	max-width: min(90vw, 420px);
	overflow-y: auto;
	padding: 8px;
}

.scoreview-setlist-heading {
	font-weight: bold;
	padding: 0 8px 4px;
}

.scoreview-setlist-list ol {
	list-style: decimal;
	padding-inline-start: 32px;
}

.scoreview-setlist-list ul {
	list-style: none;
	padding: 0;
}

.scoreview-setlist-entry {
	display: block;
	width: 100%;
	min-height: 36px;
	padding: 6px 8px;
	margin: 0;
	border: none;
	border-radius: var(--border-radius);
	background: transparent;
	text-align: start;
	cursor: pointer;
}

span.scoreview-setlist-entry {
	cursor: default;
}

button.scoreview-setlist-entry:hover,
button.scoreview-setlist-entry:focus-visible {
	background-color: var(--color-background-hover);
}

.scoreview-setlist-entry--current > .scoreview-setlist-entry {
	font-weight: bold;
	background-color: var(--color-primary-element-light);
	color: var(--color-primary-element-light-text);
}

.scoreview-setlist-entry--missing {
	color: var(--color-text-maxcontrast);
}
</style>
