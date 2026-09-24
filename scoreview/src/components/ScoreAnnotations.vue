<template>
	<div class="scoreview-annotations">
		<!-- Die Überschrift "Notes" liefert die Panel-Kopfzeile in
			ScoreViewer.vue (samt Schließen-Knopf) - hier stünde sie doppelt. -->
		<NcButton wide :aria-label="t('+ At current position')" @click="startNewAtCurrentPosition">
			<template #icon>
				<PlusCircleOutline :size="20" />
			</template>
			{{ t('+ At current position') }}
		</NcButton>
		<!--
			Fuer wen neue Notizen und Stempel sind - EINE Wahl fuer beide, oben
			im Panel statt in jedem Entwurf: Ein Stempel wird mit einem Tipp ins
			Notenbild gesetzt, da gibt es keinen Entwurf, an dem die Frage
			stehen koennte.

			Bewusst nicht versteckt vor Nutzerinnen ohne Schreibrecht: der Server
			lehnt eine geteilte Notiz ohne PERMISSION_UPDATE mit 403 ab (siehe
			AnnotationController::canWriteShared()), das ist die eigentliche
			Durchsetzung. Der Text macht unmissverstaendlich klar, dass eine
			geteilte Notiz eine Datenweitergabe an alle mit Dateizugriff ist.
			„Stimmen" dagegen gibt es nur fuer Leitungen - fuer alle
			anderen waere es ein Knopf, der immer mit 403 endet.
		-->
		<fieldset class="scoreview-annotations-audience">
			<legend>{{ t('New notes and stamps are for') }}</legend>
			<div class="scoreview-annotations-audience-choice">
				<NcButton
					:pressed="audience === 'private'"
					:aria-label="t('Private')"
					@click="audience = 'private'">
					<template #icon>
						<LockOutline :size="20" />
					</template>
					{{ t('Private') }}
				</NcButton>
				<NcButton
					:pressed="audience === 'shared'"
					:aria-label="t('Shared with everyone who has access to this file')"
					:title="t('Shared with everyone who has access to this file')"
					@click="audience = 'shared'">
					<template #icon>
						<AccountGroup :size="20" />
					</template>
					{{ t('Shared') }}
				</NcButton>
				<NcButton
					v-if="isLeader && parts.length > 0"
					:pressed="audience === 'parts'"
					:aria-label="t('Voices')"
					:title="t('Only singers of the chosen voices see it')"
					@click="audience = 'parts'">
					<template #icon>
						<AccountMusic :size="20" />
					</template>
					{{ t('Voices') }}
				</NcButton>
			</div>
			<div v-if="audience === 'parts'" class="scoreview-annotations-voices">
				<NcCheckboxRadioSwitch
					v-for="part in parts"
					:key="part.id"
					:modelValue="targetIds.includes(String(part.id))"
					type="checkbox"
					@update:modelValue="toggleTarget(part)">
					{{ part.name }}
				</NcCheckboxRadioSwitch>
				<p v-if="targetIds.length === 0" class="scoreview-annotations-hint">
					{{ t('Choose at least one voice.') }}
				</p>
			</div>
		</fieldset>
		<!--
			Die Stempel-Palette: Symbol waehlen, dann in die Noten
			tippen - drei Tipps, auch am Notenstaender. Das Symbol im Knopf ist
			dieselbe Zeichnung wie im Notenbild.
		-->
		<div class="scoreview-annotations-palette" role="group" :aria-label="t('Stamps')">
			<button
				v-for="code in stampCodes"
				:key="code"
				type="button"
				class="scoreview-annotations-stamp"
				:class="{ 'scoreview-annotations-stamp--armed': armedStamp === code }"
				:aria-label="stampName(code)"
				:title="stampName(code)"
				:disabled="!audienceComplete"
				@click="armStamp(code)">
				<svg viewBox="-2 -3 4 3.4" aria-hidden="true">
					<StampSymbol :stamp="code" />
				</svg>
			</button>
		</div>
		<NcNoteCard v-if="error" type="error" class="scoreview-annotations-error">
			{{ error }}
		</NcNoteCard>
		<NcButton
			v-if="hasOthers"
			class="scoreview-annotations-filter"
			:pressed="onlyMine"
			:aria-label="t('Only mine')"
			@click="onlyMine = !onlyMine">
			{{ t('Only mine') }}
		</NcButton>
		<p v-if="visibleAnnotations.length === 0 && !draft" class="scoreview-annotations-empty">
			{{ t('No notes yet. Click a note or use "+ At current position" to add one.') }}
		</p>
		<ul class="scoreview-annotations-list">
			<li v-if="draft" class="scoreview-annotation scoreview-annotation-draft">
				<span class="scoreview-annotation-anchor">{{ t('Measure {n}', { n: draft.measureNumber }) }}</span>
				<textarea
					v-model="draft.content"
					rows="2"
					:maxlength="maxContentLength"
					:placeholder="t('Note…')" />
				<p class="scoreview-annotations-hint">
					{{ audienceText }}
				</p>
				<div class="scoreview-annotation-actions">
					<NcButton :aria-label="t('Save')" :disabled="!audienceComplete" @click="saveDraft">
						<template #icon>
							<Check :size="20" />
						</template>
						{{ t('Save') }}
					</NcButton>
					<NcButton :aria-label="t('Cancel')" @click="draft = null">
						<template #icon>
							<Close :size="20" />
						</template>
						{{ t('Cancel') }}
					</NcButton>
				</div>
			</li>
			<li
				v-for="a in visibleAnnotations"
				:key="a.id"
				class="scoreview-annotation"
				:class="{
					orphaned: a.orphaned,
					shared: a.visibility === 'shared',
					parts: a.visibility === 'parts',
					dimmed: a.display === 'dim',
				}">
				<span class="scoreview-annotation-anchor" @click="$emit('jumpTo', a)">
					<svg
						v-if="a.kind === 'stamp'"
						class="scoreview-annotation-stamp"
						viewBox="-2 -3 4 3.4"
						aria-hidden="true">
						<StampSymbol :stamp="a.stamp" />
					</svg>
					{{ t('Measure {n}', { n: a.measureNumber }) }}
					<em v-if="a.orphaned">{{ t('(orphaned)') }}</em>
					<span v-if="a.visibility === 'shared'" class="scoreview-annotation-badge" :title="t('Shared with everyone who has access to this file')">
						<AccountGroup :size="14" />
						<template v-if="!a.mine">{{ t('by {name}', { name: a.authorName }) }}</template>
					</span>
					<!-- Die Leitung ist als solche erkennbar. -->
					<span v-if="a.byLeader" class="scoreview-annotation-badge scoreview-annotation-badge--leader" :title="t('From the leader')">
						<AccountStar :size="14" />
						{{ a.mine ? t('Leader') : t('Leader {name}', { name: a.authorName }) }}
					</span>
				</span>
				<!--
					An wen die Notiz geht - und wenn es die Stimme nicht mehr gibt,
					das auch: Sie ist dann fuer alle sichtbar, und ohne den
					Hinweis wuesste niemand, warum.
				-->
				<p v-if="a.visibility === 'parts'" class="scoreview-annotation-voices">
					<AccountMusic :size="14" />
					<template v-if="withoutVoice(a)">
						{{ t('Voice no longer in the score ({voices}) – shown to everyone', { voices: a.voices.join(', ') }) }}
					</template>
					<template v-else>
						{{ t('For {voices}', { voices: a.voices.join(', ') }) }}
					</template>
				</p>
				<template v-if="editingId === a.id">
					<textarea v-model="editContent" rows="2" :maxlength="maxContentLength" />
					<div class="scoreview-annotation-actions">
						<NcButton :aria-label="t('Save')" @click="saveEdit(a)">
							<template #icon>
								<Check :size="20" />
							</template>
							{{ t('Save') }}
						</NcButton>
						<NcButton :aria-label="t('Cancel')" @click="editingId = null">
							<template #icon>
								<Close :size="20" />
							</template>
							{{ t('Cancel') }}
						</NcButton>
					</div>
				</template>
				<template v-else>
					<p v-if="a.kind === 'stamp'" class="scoreview-annotation-content">
						{{ stampName(a.stamp) }}<template v-if="a.content">
							– {{ a.content }}
						</template>
					</p>
					<p v-else class="scoreview-annotation-content">
						{{ a.content }}
					</p>
					<div v-if="canChange(a)" class="scoreview-annotation-actions">
						<NcButton :aria-label="t('Edit')" @click="startEdit(a)">
							<template #icon>
								<Pencil :size="20" />
							</template>
							{{ t('Edit') }}
						</NcButton>
						<NcButton :aria-label="t('Delete')" @click="$emit('delete', a)">
							<template #icon>
								<Delete :size="20" />
							</template>
							{{ t('Delete') }}
						</NcButton>
					</div>
				</template>
			</li>
		</ul>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import AccountGroup from 'vue-material-design-icons/AccountGroup.vue'
import AccountMusic from 'vue-material-design-icons/AccountMusic.vue'
import AccountStar from 'vue-material-design-icons/AccountStar.vue'
import Check from 'vue-material-design-icons/Check.vue'
import Close from 'vue-material-design-icons/Close.vue'
import Delete from 'vue-material-design-icons/Delete.vue'
import LockOutline from 'vue-material-design-icons/LockOutline.vue'
import Pencil from 'vue-material-design-icons/Pencil.vue'
import PlusCircleOutline from 'vue-material-design-icons/PlusCircleOutline.vue'
import { stampName } from './ScoreStamps.vue'
import StampSymbol from './StampSymbol.vue'
import { isWithoutVoice } from '../lib/annotationFilter.js'
import { STAMP_CODES } from '../lib/stampLayout.js'

// Spiegelt AnnotationController::MAX_CONTENT_LENGTH. Bewusst hier verdoppelt
// statt uebertragen: die Zahl ist keine Aushandlung, sondern eine Anzeigehilfe -
// durchgesetzt wird sie serverseitig, hier verhindert sie nur, dass jemand einen
// langen Text tippt und ihn erst beim Speichern als 400 zurueckbekommt.
const MAX_CONTENT_LENGTH = 10000

/**
 * Liste + Editor für Notizen (privat, geteilt, für Stimmen) und die
 * Stempel-Palette.
 * Hält nur UI-Zustand (Entwurf/Bearbeitung/„nur meine"-Filter/Zielgruppe) -
 * Laden/Speichern/Löschen passiert in ScoreViewer.vue (dort liegt auch der
 * HTTP-Zugriff über die annotation#-Routen), damit diese Komponente
 * unabhängig von @nextcloud/axios bleibt und sich isoliert testen ließe.
 *
 * Wer eine geteilte Notiz tatsächlich anlegen/ändern/löschen darf, prüft
 * ausschließlich der Server (`PERMISSION_UPDATE`, siehe
 * AnnotationController::canWriteShared()) - diese Komponente zeigt die
 * Aktionen für jede geteilte Notiz an und verlässt sich auf die Server-
 * Antwort (bzw. den durchgereichten `error`), statt eine eigene, zwangsläufig
 * unvollständige Rechteprüfung nachzubauen.
 */
export default {
	name: 'ScoreAnnotations',

	components: { NcButton, NcCheckboxRadioSwitch, NcNoteCard, PlusCircleOutline, Check, Close, Pencil, Delete, AccountGroup, AccountMusic, AccountStar, LockOutline, StampSymbol },

	props: {
		// Die Notizen, die diese Person sieht - bereits eingeordnet
		// (useAnnotations `listed`: `display` show/dim, `voices`).
		annotations: {
			type: Array,
			required: true,
		},

		// Anzeigehilfe fuer „Stimmen" und die Bearbeiten-Knoepfe an
		// Stimmnotizen; durchgesetzt wird die Rolle serverseitig.
		isLeader: {
			type: Boolean,
			default: false,
		},

		// meta.parts - die Stimmen, an die eine Leitung schreiben kann.
		parts: {
			type: Array,
			default: () => [],
		},

		// Code des Stempels, der gerade auf den Tipp ins Notenbild wartet.
		armedStamp: {
			type: String,
			default: null,
		},

		// {measureNumber, fraction, elid, anchorEtag} der aktuellen
		// Wiedergabeposition, von ScoreViewer.vue aus scoreLayout.js berechnet.
		currentAnchor: {
			type: Object,
			default: null,
		},

		// Serverfehler vom letzten create/update/delete (z.B. 403 beim Anlegen
		// einer geteilten Notiz ohne Schreibrecht) - roh durchgereicht, siehe
		// ScoreViewer.vue.
		error: {
			type: String,
			default: '',
		},
	},

	emits: ['create', 'update', 'delete', 'jumpTo', 'armStamp'],

	data() {
		return {
			draft: null,
			editingId: null,
			editContent: '',
			onlyMine: false,
			// 'private' | 'shared' | 'parts' - fuer neue Notizen und Stempel
			audience: 'private',
			// Stimmen-IDs aus meta.parts (als Text), nur bei 'parts'
			targetIds: [],
		}
	},

	computed: {
		// Modulkonstante ueber das Template erreichbar machen.
		maxContentLength() {
			return MAX_CONTENT_LENGTH
		},

		hasOthers() {
			return this.annotations.some((a) => !a.mine)
		},

		stampCodes() {
			return STAMP_CODES
		},

		/** Die gewaehlten Zielstimmen in der Form der API. */
		targetParts() {
			return this.parts
				.filter((part) => this.targetIds.includes(String(part.id)))
				.map((part) => ({ id: String(part.id), name: part.name }))
		},

		audienceComplete() {
			return this.audience !== 'parts' || this.targetParts.length > 0
		},

		audienceText() {
			if (this.audience === 'shared') {
				return this.t('Shared with everyone who has access to this file')
			}
			if (this.audience === 'parts') {
				return this.t('For {voices}', { voices: this.targetParts.map((p) => p.name).join(', ') || '–' })
			}
			return this.t('Private')
		},

		visibleAnnotations() {
			return this.onlyMine ? this.annotations.filter((a) => a.mine) : this.annotations
		},
	},

	watch: {
		// Wer die Rolle verliert (oder nie hatte), soll nicht auf „Stimmen"
		// stehen bleiben - jede Notiz endete dann mit 403.
		isLeader(leader) {
			if (!leader && this.audience === 'parts') {
				this.audience = 'private'
			}
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		stampName(code) {
			return stampName(code)
		},

		withoutVoice(annotation) {
			return isWithoutVoice(annotation, this.parts)
		},

		/**
		 * Ob die Knoepfe zum Aendern erscheinen. Die Regeln stehen im Server
		 * (AnnotationService::mayWrite); hier nur so viel, dass niemand
		 * Knoepfe sieht, die sicher mit 403 enden.
		 *
		 * @param {object} a
		 * @return {boolean}
		 */
		canChange(a) {
			if (a.visibility === 'parts') {
				return this.isLeader
			}
			return a.mine || a.visibility === 'shared'
		},

		toggleTarget(part) {
			const id = String(part.id)
			this.targetIds = this.targetIds.includes(id)
				? this.targetIds.filter((x) => x !== id)
				: [...this.targetIds, id]
		},

		armStamp(code) {
			if (!this.audienceComplete) {
				return
			}
			this.$emit('armStamp', {
				stamp: code,
				visibility: this.audience,
				targetParts: this.audience === 'parts' ? this.targetParts : null,
			})
		},

		startNewAtCurrentPosition() {
			if (!this.currentAnchor) {
				return
			}
			this.editingId = null
			this.draft = { ...this.currentAnchor, content: '' }
		},

		saveDraft() {
			if (!this.draft || this.draft.content.trim() === '' || !this.audienceComplete) {
				return
			}
			this.$emit('create', {
				...this.draft,
				visibility: this.audience,
				targetParts: this.audience === 'parts' ? this.targetParts : null,
			})
			this.draft = null
		},

		startEdit(annotation) {
			this.draft = null
			this.editingId = annotation.id
			this.editContent = annotation.content
		},

		saveEdit(annotation) {
			// Ein Stempel darf ohne Zusatztext sein, eine Textnotiz nicht.
			if (annotation.kind !== 'stamp' && this.editContent.trim() === '') {
				return
			}
			this.$emit('update', { id: annotation.id, content: this.editContent })
			this.editingId = null
		},
	},
}
</script>

<style scoped>
/* Rahmen und Abstand nach oben kommen von der Panel-Karte in
   ScoreViewer.vue - hier bleibt nur der Inhalt. */
.scoreview-annotations {
	padding-top: 8px;
}

.scoreview-annotations-error {
	margin: 8px 0;
}

.scoreview-annotations-filter {
	margin: 8px 0 0 0;
}

.scoreview-annotations-empty {
	color: var(--color-text-maxcontrast);
}

.scoreview-annotations-list {
	list-style: none;
	margin: 8px 0 0 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.scoreview-annotation {
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius, 4px);
	padding: 8px;
}

.scoreview-annotation.orphaned {
	/* Die Liste steht in der Leiste, nicht auf dem Papier - also die Farbe
	   des Themes. Aber das Element, nicht die Flaeche: `--color-warning` ist
	   seit Nextcloud 34 eine Flaechenfarbe (gemessen 1,15:1 hell, 1,39:1
	   dunkel zum Grund der Leiste), der Rahmen war kaum zu sehen. */
	border-color: var(--color-element-warning, #bf7900);
}

/* Geteilte Notizen optisch unterscheidbar ("eigene und geteilte
   Notizen unterscheidbar, Markerfarbe") - ein dezenter linker Akzentbalken
   statt der vollen Rahmenfarbe, damit sich das nicht mit "orphaned" beißt,
   falls beides gleichzeitig zutrifft. */
.scoreview-annotation.shared {
	border-inline-start: 3px solid var(--color-primary-element, #0082c9);
}

.scoreview-annotation-anchor {
	display: flex;
	align-items: center;
	gap: 6px;
	font-weight: bold;
	cursor: pointer;
	margin-bottom: 4px;
}

.scoreview-annotation-badge {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	font-weight: normal;
	font-size: 0.85em;
	color: var(--color-text-maxcontrast);
}

.scoreview-annotation-content {
	margin: 0;
	white-space: pre-wrap;
}

.scoreview-annotation textarea {
	width: 100%;
	box-sizing: border-box;
}

.scoreview-annotations-audience {
	margin: 8px 0 0 0;
	padding: 0;
	border: none;
}

.scoreview-annotations-audience legend {
	color: var(--color-text-maxcontrast);
	font-size: 0.9em;
}

.scoreview-annotations-audience-choice {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}

.scoreview-annotations-voices {
	margin-top: 4px;
}

.scoreview-annotations-hint {
	margin: 4px 0 0 0;
	color: var(--color-text-maxcontrast);
	font-size: 0.9em;
}

/* Die Palette: Tippziele in Touch-Groesse (44px), fuenf je Zeile. */
.scoreview-annotations-palette {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
	gap: 4px;
	margin-top: 8px;
}

.scoreview-annotations-stamp {
	min-height: 44px;
	margin: 0;
	padding: 4px;
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius, 4px);
	background: var(--color-main-background);
	/* Palette und Liste stehen in der Leiste: die Stempelfarbe des Themes,
	   nicht des Papiers (lib/noteTheme.js). */
	color: var(--scoreview-ui-stamp, #1565c0);
	cursor: pointer;
}

.scoreview-annotations-stamp svg {
	width: 100%;
	height: 28px;
	overflow: visible;
}

.scoreview-annotations-stamp--armed {
	border-color: var(--color-primary-element, #0082c9);
	background: var(--color-primary-element-light, #d5eaff);
}

.scoreview-annotations-stamp:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}

.scoreview-annotation.parts {
	border-inline-start: 3px solid var(--color-warning-text, #a36100);
}

/* Ohne gewaehlte Stimme da, aber zurueckgenommen. */
.scoreview-annotation.dimmed {
	opacity: 0.55;
}

.scoreview-annotation-badge--leader {
	color: var(--color-warning-text, #a36100);
}

.scoreview-annotation-stamp {
	width: 28px;
	height: 22px;
	overflow: visible;
	color: var(--scoreview-ui-stamp, #1565c0);
}

.scoreview-annotation-voices {
	display: flex;
	align-items: center;
	gap: 4px;
	margin: 0 0 4px 0;
	color: var(--color-text-maxcontrast);
	font-size: 0.9em;
}

.scoreview-annotation-actions {
	display: flex;
	gap: 6px;
	margin-top: 4px;
}
</style>
