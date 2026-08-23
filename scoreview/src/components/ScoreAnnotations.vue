<template>
	<div class="scoreview-annotations">
		<div class="scoreview-annotations-header">
			<h3>{{ t('Notes') }}</h3>
			<NcButton :aria-label="t('+ At current position')" @click="startNewAtCurrentPosition">
				<template #icon>
					<PlusCircleOutline :size="20" />
				</template>
				{{ t('+ At current position') }}
			</NcButton>
		</div>
		<p v-if="annotations.length === 0 && !draft" class="scoreview-annotations-empty">
			{{ t('No notes yet. Click a note or use "+ At current position" to add one.') }}
		</p>
		<ul class="scoreview-annotations-list">
			<li v-if="draft" class="scoreview-annotation scoreview-annotation-draft">
				<span class="scoreview-annotation-anchor">{{ t('Measure {n}', { n: draft.measureNumber }) }}</span>
				<textarea v-model="draft.content" rows="2" :placeholder="t('Note…')" />
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
				v-for="a in annotations"
				:key="a.id"
				class="scoreview-annotation"
				:class="{ orphaned: a.orphaned }">
				<span class="scoreview-annotation-anchor" @click="$emit('jump-to', a)">
					{{ t('Measure {n}', { n: a.measureNumber }) }}
					<em v-if="a.orphaned">{{ t('(orphaned)') }}</em>
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
					<div class="scoreview-annotation-actions">
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
import PlusCircleOutline from 'vue-material-design-icons/PlusCircleOutline.vue'
import Check from 'vue-material-design-icons/Check.vue'
import Close from 'vue-material-design-icons/Close.vue'
import Pencil from 'vue-material-design-icons/Pencil.vue'
import Delete from 'vue-material-design-icons/Delete.vue'

/**
 * Liste + Editor für private Notizen (Phase 11). Hält nur UI-Zustand
 * (Entwurf/Bearbeitung) - Laden/Speichern/Löschen passiert in
 * ScoreViewer.vue (dort liegt auch der HTTP-Zugriff über die
 * annotation#-Routen), damit diese Komponente unabhängig von
 * @nextcloud/axios bleibt und sich isoliert testen ließe.
 */
export default {
	name: 'ScoreAnnotations',

	components: { NcButton, PlusCircleOutline, Check, Close, Pencil, Delete },

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
	},

	emits: ['create', 'update', 'delete', 'jump-to'],

	data() {
		return {
			draft: null,
			editingId: null,
			editContent: '',
		}
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
			this.draft = { ...this.currentAnchor, content: '' }
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
.scoreview-annotations {
	border-top: 1px solid var(--color-border);
	padding-top: 8px;
	margin-top: 12px;
}

.scoreview-annotations-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.scoreview-annotations-header h3 {
	margin: 0;
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

.scoreview-annotation-anchor {
	display: block;
	font-weight: bold;
	cursor: pointer;
	margin-bottom: 4px;
}

.scoreview-annotation-content {
	margin: 0;
	white-space: pre-wrap;
}

.scoreview-annotation textarea {
	width: 100%;
	box-sizing: border-box;
}

.scoreview-annotation-actions {
	display: flex;
	gap: 6px;
	margin-top: 4px;
}
</style>
