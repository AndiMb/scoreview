<template>
	<!--
		Setliste zusammenklicken: Partituren wählen, ordnen, speichern.
		Geschrieben wird dasselbe Format, das man von Hand schriebe - der
		Server fasst nur die erste Liste der Datei an (SetlistFormat.php).
	-->
	<div class="scoreview-setlist-editor">
		<NcTextField
			v-if="mode === 'new'"
			v-model="name"
			:label="t('Name of the setlist')"
			:placeholder="t('e.g. Autumn concert')"
			:helperText="t('Saved as “{file}” next to the open score.', { file: fileName })" />
		<p v-else class="scoreview-setlist-editor-title">
			{{ setlist?.title }}
		</p>

		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>

		<p v-if="rows.length === 0" class="scoreview-setlist-editor-empty">
			{{ t('No pieces yet. Add scores below.') }}
		</p>
		<!--
			Ziehen zum Ordnen - und daneben Knöpfe für hoch/runter:
			HTML-Drag-and-drop gibt es auf Touchgeräten nicht, und mit der
			Tastatur auch nicht.
		-->
		<ol v-else class="scoreview-setlist-editor-rows">
			<li
				v-for="(row, i) in rows"
				:key="row.key"
				class="scoreview-setlist-editor-row"
				:class="{
					'scoreview-setlist-editor-row--dragging': dragIndex === i,
					'scoreview-setlist-editor-row--missing': row.status !== 'ok',
				}"
				draggable="true"
				@dragstart="onDragStart(i, $event)"
				@dragover.prevent
				@drop.prevent="onDrop(i)"
				@dragend="dragIndex = null">
				<DragVertical :size="20" class="scoreview-setlist-editor-handle" />
				<span class="scoreview-setlist-editor-label">
					<s v-if="row.status !== 'ok'">{{ row.label }}</s>
					<template v-else>{{ row.label }}</template>
					<span class="scoreview-setlist-editor-path">{{ row.path }}</span>
				</span>
				<NcButton
					variant="tertiary"
					:disabled="i === 0"
					:aria-label="t('Move up')"
					:title="t('Move up')"
					@click="move(i, i - 1)">
					<template #icon>
						<ArrowUp :size="20" />
					</template>
				</NcButton>
				<NcButton
					variant="tertiary"
					:disabled="i === rows.length - 1"
					:aria-label="t('Move down')"
					:title="t('Move down')"
					@click="move(i, i + 1)">
					<template #icon>
						<ArrowDown :size="20" />
					</template>
				</NcButton>
				<NcButton
					variant="tertiary"
					:aria-label="t('Remove from setlist')"
					:title="t('Remove from setlist')"
					@click="remove(i)">
					<template #icon>
						<Delete :size="20" />
					</template>
				</NcButton>
			</li>
		</ol>

		<!--
			Auf der Seite der mobilen Apps nimmt der Server beim Bearbeiten
			nur Umordnen und Entfernen an (S2): Ihr Ausweis für die
			Liste ist ein Begleit-Token, und aus dem soll nichts Neues in eine
			Liste gelangen, für das es dann weitere Token gäbe.
		-->
		<p v-if="noAdding" class="scoreview-setlist-editor-hint">
			{{ t('Here you can reorder or remove pieces. To add pieces, open the setlist in the browser.') }}
		</p>
		<fieldset v-else class="scoreview-setlist-editor-add">
			<legend>{{ t('Add scores') }}</legend>
			<!--
				Zwei Wege: die Partituren rund um die offene (score-candidates,
				geht auch mobil ohne Sitzung, E8) und Nextclouds
				Dateiauswahl für beliebige Ordner - die braucht eine Sitzung.
			-->
			<NcButton v-if="!withoutFilePicker" wide @click="pickFromFiles">
				<template #icon>
					<FolderOpen :size="20" />
				</template>
				{{ t('Choose from Files…') }}
			</NcButton>
			<template v-if="candidates.length > 0">
				<NcTextField
					v-model="filter"
					:label="t('Scores in this folder')"
					:placeholder="t('Filter')" />
				<ul class="scoreview-setlist-editor-candidates">
					<li v-for="candidate in filteredCandidates" :key="candidate.fileId">
						<button
							type="button"
							class="scoreview-setlist-editor-candidate"
							:title="t('Add {name}', { name: candidate.path })"
							@click="add(candidate)">
							<Plus :size="16" />
							{{ candidate.path }}
						</button>
					</li>
				</ul>
			</template>
		</fieldset>

		<div class="scoreview-setlist-editor-actions">
			<NcButton @click="$emit('cancel')">
				{{ t('Cancel') }}
			</NcButton>
			<NcButton variant="primary" :disabled="busy || (mode === 'new' && name.trim() === '')" @click="save">
				<template #icon>
					<Check :size="20" />
				</template>
				{{ mode === 'new' ? t('Create setlist') : t('Save setlist') }}
			</NcButton>
		</div>
	</div>
</template>

<script>
import axios from '@nextcloud/axios'
import { getFilePickerBuilder } from '@nextcloud/dialogs'
import { translate } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import ArrowDown from 'vue-material-design-icons/ArrowDown.vue'
import ArrowUp from 'vue-material-design-icons/ArrowUp.vue'
import Check from 'vue-material-design-icons/Check.vue'
import Delete from 'vue-material-design-icons/Delete.vue'
import DragVertical from 'vue-material-design-icons/DragVertical.vue'
import FolderOpen from 'vue-material-design-icons/FolderOpen.vue'
import Plus from 'vue-material-design-icons/Plus.vue'
import { addScore, moveRow, payloadFor, removeRow, rowsFromSetlist } from '../lib/setlistEdit.js'

import '@nextcloud/dialogs/style.css'

/**
 * „Setliste bearbeiten" bzw. „Neue Setliste" (E11). Die
 * Zeilenlogik steht in lib/setlistEdit.js; hier nur Oberfläche und Anfragen.
 */
export default {
	name: 'SetlistEditor',

	components: {
		ArrowDown,
		ArrowUp,
		Check,
		Delete,
		DragVertical,
		FolderOpen,
		NcButton,
		NcNoteCard,
		NcTextField,
		Plus,
	},

	props: {
		/** 'edit' (PUT auf `setlist`) oder 'new' (POST in `folderFileId`) */
		mode: { type: String, default: 'edit' },
		setlist: { type: Object, default: null },
		/** Die offene Partitur - fuer die Auswahl daneben (score-candidates). */
		scoreFileId: { type: [Number, String], default: null },
		folderFileId: { type: [Number, String], default: null },
		/** Ohne Sitzung (Mobil) gibt es Nextclouds Dateiauswahl nicht (E8). */
		withoutFilePicker: { type: Boolean, default: false },
		/** Keine Stücke hinzufügen - mobil beim Bearbeiten einer Liste (S2). */
		noAdding: { type: Boolean, default: false },
	},

	emits: ['saved', 'cancel'],

	data() {
		return {
			rows: this.mode === 'edit' ? rowsFromSetlist(this.setlist) : [],
			name: '',
			candidates: [],
			filter: '',
			busy: false,
			error: '',
			dragIndex: null,
		}
	},

	computed: {
		fileName() {
			const base = this.name.trim().replace(/(\.setlist)?\.md$/i, '')
			return (base || this.t('Setlist')) + '.setlist.md'
		},

		filteredCandidates() {
			const needle = this.filter.trim().toLowerCase()
			return needle === ''
				? this.candidates
				: this.candidates.filter((c) => c.path.toLowerCase().includes(needle))
		},
	},

	mounted() {
		this.loadCandidates()
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		async loadCandidates() {
			if (this.scoreFileId === null || this.noAdding) {
				return
			}
			try {
				const res = await axios.get(generateUrl('/apps/scoreview/api/scores/{fileId}/score-candidates', { fileId: this.scoreFileId }))
				this.candidates = res.data.candidates ?? []
				// Mobil beginnt eine neue Liste mit der offenen Partitur: Nur
				// fuer eine Liste, die sie enthaelt, gibt der Server die Token
				// zum Blaettern aus (S1). Entfernen laesst sie sich.
				const offen = this.candidates.find((c) => String(c.fileId) === String(this.scoreFileId))
				if (this.withoutFilePicker && this.mode === 'new' && this.rows.length === 0 && offen) {
					this.add(offen)
				}
			} catch (err) {
				// Die Auswahl ist ein Angebot - die Dateiauswahl geht trotzdem.
				// eslint-disable-next-line no-console
				console.error('ScoreView: Partituren im Ordner konnten nicht geladen werden.', err)
			}
		},

		add(candidate) {
			this.rows = addScore(this.rows, candidate)
		},

		move(from, to) {
			this.rows = moveRow(this.rows, from, to)
		},

		remove(i) {
			this.rows = removeRow(this.rows, i)
		},

		onDragStart(i, event) {
			this.dragIndex = i
			// Ohne Daten beginnt Firefox kein Ziehen.
			event.dataTransfer?.setData('text/plain', String(i))
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = 'move'
			}
		},

		onDrop(i) {
			if (this.dragIndex !== null) {
				this.move(this.dragIndex, i)
			}
			this.dragIndex = null
		},

		/**
		 * Nextclouds Dateiauswahl, gefiltert auf Partituren. Am Namen, nicht am
		 * Mimetype: Eine frisch hochgeladene .mscz traegt noch
		 * application/octet-stream (siehe lib/scoreFile.js).
		 */
		async pickFromFiles() {
			const picker = getFilePickerBuilder(this.t('Add scores'))
				.setMultiSelect(true)
				.allowDirectories(false)
				.setFilter((node) => node.type === 'folder' || String(node.basename).toLowerCase().endsWith('.mscz'))
				.addButton({ label: this.t('Add'), variant: 'primary', callback: () => {} })
				.build()
			let nodes
			try {
				nodes = await picker.pickNodes()
			} catch {
				// Geschlossen, ohne zu waehlen.
				return
			}
			for (const node of nodes) {
				if (node.fileid) {
					this.add({ fileId: node.fileid, basename: node.basename, path: node.path })
				}
			}
		},

		async save() {
			this.busy = true
			this.error = ''
			try {
				const entries = payloadFor(this.rows)
				const res = this.mode === 'new'
					? await axios.post(generateUrl('/apps/scoreview/api/setlists'), {
							folderFileId: Number(this.folderFileId),
							name: this.name,
							entries,
						})
					: await axios.put(generateUrl('/apps/scoreview/api/setlists/{id}', { id: this.setlist.id }), {
							entries,
							etag: this.setlist.etag,
						})
				this.$emit('saved', res.data)
			} catch (err) {
				this.error = err?.response?.data?.error ?? this.t('The setlist could not be saved.')
			} finally {
				this.busy = false
			}
		},
	},
}
</script>

<style scoped>
.scoreview-setlist-editor {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.scoreview-setlist-editor-title {
	font-weight: bold;
}

.scoreview-setlist-editor-empty,
.scoreview-setlist-editor-hint {
	color: var(--color-text-maxcontrast);
}

.scoreview-setlist-editor-rows {
	list-style: none;
	padding: 0;
	margin: 0;
}

.scoreview-setlist-editor-row {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 2px 4px;
	border-radius: var(--border-radius);
	cursor: grab;
}

.scoreview-setlist-editor-row:hover {
	background-color: var(--color-background-hover);
}

.scoreview-setlist-editor-row--dragging {
	opacity: 0.5;
}

.scoreview-setlist-editor-row--missing {
	color: var(--color-text-maxcontrast);
}

.scoreview-setlist-editor-handle {
	color: var(--color-text-maxcontrast);
}

.scoreview-setlist-editor-label {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
}

.scoreview-setlist-editor-path {
	font-size: var(--font-size-small, 13px);
	color: var(--color-text-maxcontrast);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.scoreview-setlist-editor-add {
	display: flex;
	flex-direction: column;
	gap: 6px;
	border-block-start: 1px solid var(--color-border);
	padding-block-start: 8px;
}

.scoreview-setlist-editor-add legend {
	font-weight: bold;
}

.scoreview-setlist-editor-candidates {
	list-style: none;
	padding: 0;
	margin: 0;
	max-height: 30vh;
	overflow-y: auto;
}

.scoreview-setlist-editor-candidate {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	min-height: 36px;
	margin: 0;
	padding: 4px 8px;
	border: none;
	border-radius: var(--border-radius);
	background: transparent;
	text-align: start;
	cursor: pointer;
}

.scoreview-setlist-editor-candidate:hover,
.scoreview-setlist-editor-candidate:focus-visible {
	background-color: var(--color-background-hover);
}

.scoreview-setlist-editor-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}
</style>
