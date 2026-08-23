<template>
	<div class="scoreview-annotations">
		<!-- Die Überschrift "Notes" liefert seit Phase 22 die Panel-Kopfzeile in
			ScoreViewer.vue (samt Schließen-Knopf) - hier stünde sie doppelt. -->
		<NcButton wide :aria-label="t('+ At current position')" @click="startNewAtCurrentPosition">
			<template #icon>
				<PlusCircleOutline :size="20" />
			</template>
			{{ t('+ At current position') }}
		</NcButton>
		<NcNoteCard v-if="error" type="error" class="scoreview-annotations-error">
			{{ error }}
		</NcNoteCard>
		<NcButton v-if="hasShared" class="scoreview-annotations-filter" :pressed="onlyMine" :aria-label="t('Only mine')" @click="onlyMine = !onlyMine">
			{{ t('Only mine') }}
		</NcButton>
		<p v-if="visibleAnnotations.length === 0 && !draft" class="scoreview-annotations-empty">
			{{ t('No notes yet. Click a note or use "+ At current position" to add one.') }}
		</p>
		<ul class="scoreview-annotations-list">
			<li v-if="draft" class="scoreview-annotation scoreview-annotation-draft">
				<span class="scoreview-annotation-anchor">{{ t('Measure {n}', { n: draft.measureNumber }) }}</span>
				<textarea v-model="draft.content" rows="2" :placeholder="t('Note…')" />
				<!--
					Sichtbarkeit beim Anlegen (Phase 18) - bewusst nicht versteckt vor
					Nutzerinnen ohne Schreibrecht: der Server lehnt eine geteilte
					Notiz ohne PERMISSION_UPDATE mit 403 ab (siehe
					AnnotationController::canWriteShared()), das ist die eigentliche
					Durchsetzung. Der Text macht unmissverständlich klar, dass eine
					geteilte Notiz eine Datenweitergabe an alle mit Dateizugriff ist.
				-->
				<NcButton
					class="scoreview-annotation-visibility"
					:pressed="draft.visibility === 'shared'"
					:aria-label="draft.visibility === 'shared' ? t('Shared with everyone who has access to this file') : t('Private')"
					@click="draft.visibility = draft.visibility === 'shared' ? 'private' : 'shared'">
					<template #icon>
						<AccountGroup v-if="draft.visibility === 'shared'" :size="20" />
						<LockOutline v-else :size="20" />
					</template>
					{{ draft.visibility === 'shared' ? t('Shared with everyone who has access to this file') : t('Private') }}
				</NcButton>
				<div class="scoreview-annotation-actions">
					<NcButton :aria-label="t('Save')" @click="saveDraft">
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
				:class="{ orphaned: a.orphaned, shared: a.visibility === 'shared' }">
				<span class="scoreview-annotation-anchor" @click="$emit('jump-to', a)">
					{{ t('Measure {n}', { n: a.measureNumber }) }}
					<em v-if="a.orphaned">{{ t('(orphaned)') }}</em>
					<span v-if="a.visibility === 'shared'" class="scoreview-annotation-badge" :title="t('Shared with everyone who has access to this file')">
						<AccountGroup :size="14" />
						<template v-if="!a.mine">{{ t('by {name}', { name: a.authorName }) }}</template>
					</span>
				</span>
				<template v-if="editingId === a.id">
					<textarea v-model="editContent" rows="2" />
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
					<p class="scoreview-annotation-content">
						{{ a.content }}
					</p>
					<div v-if="a.mine || a.visibility === 'shared'" class="scoreview-annotation-actions">
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
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import PlusCircleOutline from 'vue-material-design-icons/PlusCircleOutline.vue'
import Check from 'vue-material-design-icons/Check.vue'
import Close from 'vue-material-design-icons/Close.vue'
import Pencil from 'vue-material-design-icons/Pencil.vue'
import Delete from 'vue-material-design-icons/Delete.vue'
import AccountGroup from 'vue-material-design-icons/AccountGroup.vue'
import LockOutline from 'vue-material-design-icons/LockOutline.vue'

/**
 * Liste + Editor für Notizen: privat (Phase 11) und geteilt (Phase 18).
 * Hält nur UI-Zustand (Entwurf/Bearbeitung/„nur meine"-Filter) -
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

	components: { NcButton, NcNoteCard, PlusCircleOutline, Check, Close, Pencil, Delete, AccountGroup, LockOutline },

	props: {
		annotations: {
			type: Array,
			required: true,
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

	emits: ['create', 'update', 'delete', 'jump-to'],

	data() {
		return {
			draft: null,
			editingId: null,
			editContent: '',
			onlyMine: false,
		}
	},

	computed: {
		hasShared() {
			return this.annotations.some((a) => a.visibility === 'shared')
		},

		visibleAnnotations() {
			return this.onlyMine ? this.annotations.filter((a) => a.mine) : this.annotations
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		startNewAtCurrentPosition() {
			if (!this.currentAnchor) {
				return
			}
			this.editingId = null
			this.draft = { ...this.currentAnchor, content: '', visibility: 'private' }
		},

		saveDraft() {
			if (!this.draft || this.draft.content.trim() === '') {
				return
			}
			this.$emit('create', this.draft)
			this.draft = null
		},

		startEdit(annotation) {
			this.draft = null
			this.editingId = annotation.id
			this.editContent = annotation.content
		},

		saveEdit(annotation) {
			if (this.editContent.trim() === '') {
				return
			}
			this.$emit('update', { id: annotation.id, content: this.editContent })
			this.editingId = null
		},
	},
}
</script>

<style scoped>
/* Rahmen und Abstand nach oben kommen seit Phase 22 von der Panel-Karte in
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
	border-color: var(--color-warning, orange);
}

/* Geteilte Notizen optisch unterscheidbar (Phase 18: "eigene und geteilte
   Notizen unterscheidbar, Markerfarbe") - ein dezenter linker Akzentbalken
   statt der vollen Rahmenfarbe, damit sich das nicht mit "orphaned" beißt,
   falls beides gleichzeitig zutrifft. */
.scoreview-annotation.shared {
	border-left: 3px solid var(--color-primary-element, #0082c9);
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

.scoreview-annotation-visibility {
	margin-top: 4px;
}

.scoreview-annotation-actions {
	display: flex;
	gap: 6px;
	margin-top: 4px;
}
</style>
