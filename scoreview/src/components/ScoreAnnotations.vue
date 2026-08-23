<template>
	<div class="scoreview-annotations">
		<div class="scoreview-annotations-header">
			<h3>Notizen</h3>
			<button type="button" @click="startNewAtCurrentPosition">
				+ An aktueller Stelle
			</button>
		</div>
		<p v-if="annotations.length === 0 && !draft" class="scoreview-annotations-empty">
			Noch keine Notizen. Klicke auf eine Note oder „+ An aktueller Stelle", um eine anzulegen.
		</p>
		<ul class="scoreview-annotations-list">
			<li v-if="draft" class="scoreview-annotation scoreview-annotation-draft">
				<span class="scoreview-annotation-anchor">Takt {{ draft.measureNumber }}</span>
				<textarea v-model="draft.content" rows="2" placeholder="Notiz…" />
				<div class="scoreview-annotation-actions">
					<button type="button" @click="saveDraft">
						Speichern
					</button>
					<button type="button" @click="draft = null">
						Abbrechen
					</button>
				</div>
			</li>
			<li
				v-for="a in annotations"
				:key="a.id"
				class="scoreview-annotation"
				:class="{ orphaned: a.orphaned }">
				<span class="scoreview-annotation-anchor" @click="$emit('jump-to', a)">
					Takt {{ a.measureNumber }}
					<em v-if="a.orphaned">(verwaist)</em>
				</span>
				<template v-if="editingId === a.id">
					<textarea v-model="editContent" rows="2" />
					<div class="scoreview-annotation-actions">
						<button type="button" @click="saveEdit(a)">
							Speichern
						</button>
						<button type="button" @click="editingId = null">
							Abbrechen
						</button>
					</div>
				</template>
				<template v-else>
					<p class="scoreview-annotation-content">
						{{ a.content }}
					</p>
					<div class="scoreview-annotation-actions">
						<button type="button" @click="startEdit(a)">
							Bearbeiten
						</button>
						<button type="button" @click="$emit('delete', a)">
							Löschen
						</button>
					</div>
				</template>
			</li>
		</ul>
	</div>
</template>

<script>
/**
 * Liste + Editor für private Notizen (Phase 11). Hält nur UI-Zustand
 * (Entwurf/Bearbeitung) - Laden/Speichern/Löschen passiert in
 * ScoreViewer.vue (dort liegt auch der HTTP-Zugriff über die
 * annotation#-Routen), damit diese Komponente unabhängig von
 * @nextcloud/axios bleibt und sich isoliert testen ließe.
 */
export default {
	name: 'ScoreAnnotations',

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
