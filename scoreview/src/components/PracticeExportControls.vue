<template>
	<!--
		Uebe-Track speichern (H1) und Tracks fuer alle Stimmen (H10). Eine
		Unterseite der Gruppe „Ueben" statt eines Dialogs: Die Einstellungen,
		die der Track uebernimmt (Mixer, Coach, Tempo, Transposition), stehen
		eine Ebene hoeher in derselben Gruppe.
	-->
	<div class="scoreview-controls">
		<p class="scoreview-popover-hint">
			{{ t('The track uses what you hear now: mixer, coach, tempo and transposition.') }}
		</p>
		<NcCheckboxRadioSwitch v-model="metronome" type="switch" :disabled="running">
			{{ t('With metronome') }}
		</NcCheckboxRadioSwitch>
		<NcCheckboxRadioSwitch
			v-if="loopRange"
			v-model="loopOnly"
			type="switch"
			:disabled="running">
			{{ t('Only the loop (measures {from}–{to})', { from: loopRange.fromMeasure, to: loopRange.toMeasure }) }}
		</NcCheckboxRadioSwitch>
		<fieldset v-if="!standalone" class="scoreview-popover-group">
			<legend>{{ t('Save to') }}</legend>
			<NcCheckboxRadioSwitch
				v-model="target"
				type="radio"
				value="folder"
				name="scoreview-export-target"
				:disabled="running">
				{{ t('Next to the score') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch
				v-model="target"
				type="radio"
				value="own"
				name="scoreview-export-target"
				:disabled="running">
				{{ ownFolder ? t('Folder: {name}', { name: ownFolder.name }) : t('Choose a folder…') }}
			</NcCheckboxRadioSwitch>
		</fieldset>
		<NcButton
			variant="primary"
			wide
			:disabled="running || (target === 'own' && !ownFolder)"
			@click="start">
			<template #icon>
				<Download :size="20" />
			</template>
			{{ t('Save as audio file') }}
		</NcButton>
		<template v-if="canWriteFolder">
			<NcButton wide :disabled="running" @click="startAll">
				<template #icon>
					<AccountMultiple :size="20" />
				</template>
				{{ t('Tracks for all parts') }}
			</NcButton>
			<p class="scoreview-popover-hint">
				{{ t('One coach track per part, saved for everyone in a folder of practice tracks next to the score. Existing tracks are replaced.') }}
			</p>
		</template>

		<div v-if="running" class="scoreview-export-progress" role="status">
			<NcProgressBar :value="percent" />
			<span>{{ progressLabel }}</span>
			<NcButton @click="$emit('cancel')">
				{{ t('Cancel') }}
			</NcButton>
		</div>

		<NcNoteCard v-if="conflict" type="warning">
			<p>{{ t('“{name}” already exists.', { name: conflict.name }) }}</p>
			<div class="scoreview-popover-row">
				<NcButton @click="$emit('resolveConflict', 'replace')">
					{{ t('Replace') }}
				</NcButton>
				<NcButton v-if="conflict.suggested" @click="$emit('resolveConflict', 'rename')">
					{{ t('Save as “{name}”', { name: conflict.suggested }) }}
				</NcButton>
			</div>
		</NcNoteCard>
		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>
		<NcNoteCard v-if="saved.length > 0 && !running" type="success">
			<p>{{ t('Saved:') }}</p>
			<ul class="scoreview-export-saved">
				<li v-for="file in saved" :key="file.fileId">
					<a :href="fileLink(file)" target="_blank" rel="noopener">{{ file.name }}</a>
				</li>
			</ul>
		</NcNoteCard>
	</div>
</template>

<script>
import { getFilePickerBuilder } from '@nextcloud/dialogs'
import { translate } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcProgressBar from '@nextcloud/vue/components/NcProgressBar'
import AccountMultiple from 'vue-material-design-icons/AccountMultiple.vue'
import Download from 'vue-material-design-icons/Download.vue'

export default {
	name: 'PracticeExportControls',

	components: {
		AccountMultiple,
		Download,
		NcButton,
		NcCheckboxRadioSwitch,
		NcNoteCard,
		NcProgressBar,
	},

	props: {
		running: {
			type: Boolean,
			required: true,
		},

		// {stage, p, index, count, part} aus usePracticeExport
		progress: {
			type: Object,
			default: null,
		},

		error: {
			type: String,
			default: '',
		},

		conflict: {
			type: Object,
			default: null,
		},

		saved: {
			type: Array,
			default: () => [],
		},

		// {fromMeasure, toMeasure, fromMs, toMs} des laufenden Loops, sonst null
		loopRange: {
			type: Object,
			default: null,
		},

		canWriteFolder: {
			type: Boolean,
			default: false,
		},

		// Direct Editing (E8): ohne Dateiauswahl - und der Server nimmt
		// mit Token ohnehin nur den Ordner der Partitur an.
		standalone: {
			type: Boolean,
			default: false,
		},
	},

	emits: ['export', 'exportAll', 'cancel', 'resolveConflict'],

	data() {
		return {
			metronome: false,
			loopOnly: false,
			target: 'folder',
			ownFolder: null,
		}
	},

	computed: {
		percent() {
			const p = this.progress
			if (!p) {
				return 0
			}
			// Rendern und Kodieren als ein Balken: grob gemessen ein Viertel
			// zu drei Vierteln (M-C), das Hochladen am Ende.
			const within = p.stage === 'render' ? p.p * 0.25 : p.stage === 'encode' ? 0.25 + p.p * 0.7 : 0.97
			const count = p.count || 1
			return Math.round(((p.index - 1) + within) / count * 100)
		},

		progressLabel() {
			const p = this.progress
			if (!p) {
				return ''
			}
			const stage = p.stage === 'upload' ? this.t('Saving…') : this.t('Rendering…')
			return p.count > 1 ? `${p.index}/${p.count} – ${p.part ?? ''} – ${stage}` : stage
		},
	},

	watch: {
		async target(value) {
			if (value === 'own' && !this.ownFolder) {
				await this.pickFolder()
			}
		},
	},

	methods: {
		start() {
			this.$emit('export', {
				metronome: this.metronome,
				everyBeat: true,
				range: this.loopOnly && this.loopRange ? { fromMs: this.loopRange.fromMs, toMs: this.loopRange.toMs } : null,
				target: this.target,
				ownFolder: this.target === 'own' ? this.ownFolder?.fileId ?? null : null,
			})
		},

		startAll() {
			this.$emit('exportAll', { metronome: this.metronome, everyBeat: true })
		},

		async pickFolder() {
			const picker = getFilePickerBuilder(this.t('Choose a folder'))
				.setMultiSelect(false)
				.allowDirectories(true)
				.setFilter((node) => node.type === 'folder')
				.addButton({ label: this.t('Choose'), variant: 'primary', callback: () => {} })
				.build()
			try {
				const [node] = await picker.pickNodes()
				if (node?.fileid) {
					this.ownFolder = { fileId: node.fileid, name: node.basename || '/' }
					return
				}
			} catch {
				// Geschlossen, ohne zu waehlen.
			}
			if (!this.ownFolder) {
				this.target = 'folder'
			}
		},

		fileLink(file) {
			return generateUrl('/f/{fileId}', { fileId: file.fileId })
		},

		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>

<style scoped>
.scoreview-export-progress {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.scoreview-export-saved {
	margin: 4px 0 0 1.2em;
	list-style: disc;
	overflow-wrap: anywhere;
}
</style>
