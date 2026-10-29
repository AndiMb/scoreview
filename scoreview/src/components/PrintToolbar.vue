<!--
	The bar above the sheets of the print page (E16): what goes on paper, and
	the Print button. Hidden on paper itself (@media print).

	"Notes and stamps" is off by default (decision: everything I see, but
	chosen, not assumed - a rehearsal note on a concert copy is a surprise).
	"Note names" follows the person's viewer setting.

	The Print button stays locked until every sheet has loaded: otherwise
	someone prints half a score after the first glance.

	"Save as PDF in Files" (A1b) only where the person may create files next
	to the score; it holds the music only, which the line under it says.
-->
<template>
	<header class="scoreview-print-toolbar">
		<div class="scoreview-print-toolbar-row">
			<!-- The title comes from the file name: material, not translated (E4). -->
			<h1 class="scoreview-print-title">
				{{ title }}
			</h1>
			<span class="scoreview-print-status" role="status">{{ statusText }}</span>
			<NcButton
				variant="primary"
				:disabled="!ready"
				@click="$emit('print')">
				<template #icon>
					<Printer :size="20" />
				</template>
				{{ t('Print') }}
			</NcButton>
			<NcButton
				v-if="canSavePdf"
				:disabled="!ready || pdf.state === 'working'"
				@click="$emit('savePdf')">
				<template #icon>
					<NcLoadingIcon v-if="pdf.state === 'working'" :size="20" />
					<FilePdfBox v-else :size="20" />
				</template>
				{{ t('Save as PDF in Files') }}
			</NcButton>
		</div>
		<div v-if="pdf.state" class="scoreview-print-toolbar-row scoreview-print-pdf" role="status">
			<span v-if="pdf.state === 'working'">{{ pdfProgressText }}</span>
			<span v-else-if="pdf.state === 'done'">{{ t('Saved as {name} next to the score - the music only, without notes, stamps and note names.', { name: pdf.name }) }}</span>
			<template v-else-if="pdf.state === 'exists'">
				<span>{{ t('{name} already exists next to the score. Replace it?', { name: pdf.name }) }}</span>
				<NcButton variant="primary" @click="$emit('replacePdf')">
					{{ t('Replace') }}
				</NcButton>
				<NcButton variant="tertiary" @click="$emit('dismissPdf')">
					{{ t('Cancel') }}
				</NcButton>
			</template>
			<span v-else-if="pdf.state === 'error'" class="scoreview-print-pdf-error">{{ pdf.error }}</span>
			<span v-if="pdf.unsupported?.length" class="scoreview-print-pdf-error">
				{{ t('Could not be written into the PDF and left out: {list}', { list: pdf.unsupported.join(', ') }) }}
			</span>
		</div>
		<div class="scoreview-print-toolbar-row scoreview-print-toolbar-switches">
			<NcCheckboxRadioSwitch
				:modelValue="withNotes"
				type="switch"
				@update:modelValue="$emit('update:withNotes', $event)">
				{{ t('Notes and stamps') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch
				:modelValue="noteNames"
				:disabled="!noteNamesPossible"
				type="switch"
				@update:modelValue="$emit('update:noteNames', $event)">
				{{ t('Note names') }}
			</NcCheckboxRadioSwitch>
		</div>
		<NcNoteCard v-if="state === 'error'" type="error">
			{{ errorText }}
		</NcNoteCard>
	</header>
</template>

<script>
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import FilePdfBox from 'vue-material-design-icons/FilePdfBox.vue'
import Printer from 'vue-material-design-icons/Printer.vue'
import { translate } from '../l10n.js'

export default {
	name: 'PrintToolbar',

	components: {
		NcButton,
		FilePdfBox,
		NcCheckboxRadioSwitch,
		NcLoadingIcon,
		NcNoteCard,
		Printer,
	},

	props: {
		title: {
			type: String,
			default: '',
		},

		// loading | converting | ready | error (useConversionStatus)
		state: {
			type: String,
			required: true,
		},

		errorText: {
			type: String,
			default: '',
		},

		// The conversion takes unusually long (useConversionStatus.langeWartezeit).
		longWait: {
			type: Boolean,
			default: false,
		},

		// Progress of a conversion in this browser (E7), or null.
		clientProgress: {
			type: Object,
			default: null,
		},

		pageCount: {
			type: Number,
			default: 0,
		},

		loadedCount: {
			type: Number,
			default: 0,
		},

		withNotes: {
			type: Boolean,
			default: false,
		},

		noteNames: {
			type: Boolean,
			default: false,
		},

		// Whether the artifacts carry note spellings at all (E15).
		noteNamesPossible: {
			type: Boolean,
			default: false,
		},

		// Whether files may be created next to the score (status endpoint).
		canSavePdf: {
			type: Boolean,
			default: false,
		},

		// The PDF file: {state, page?, of?, name?, error?, unsupported?} (PrintApp.vue)
		pdf: {
			type: Object,
			default: () => ({ state: '' }),
		},
	},

	emits: ['update:withNotes', 'update:noteNames', 'print', 'savePdf', 'replacePdf', 'dismissPdf'],

	computed: {
		pdfProgressText() {
			return this.pdf.page
				? this.t('Writing the PDF: page {page} of {of}…', { page: this.pdf.page, of: this.pdf.of })
				: this.t('Saving the PDF…')
		},

		ready() {
			return this.state === 'ready' && this.pageCount > 0 && this.loadedCount >= this.pageCount
		},

		statusText() {
			if (this.state === 'error') {
				return ''
			}
			if (this.state === 'converting') {
				if (this.clientProgress?.phase === 'page') {
					return this.t('Converting in this browser: page {page} of {of}…', { page: this.clientProgress.page, of: this.clientProgress.of })
				}
				if (this.clientProgress) {
					return this.t('Converting in this browser…')
				}
				return this.longWait
					? this.t('Still converting… this is taking longer than usual.')
					: this.t('Converting…')
			}
			if (this.state === 'ready' && this.pageCount > 0) {
				return this.ready
					? this.t('{count} pages ready to print.', { count: this.pageCount })
					: this.t('Loading page {loaded} of {count}…', { loaded: this.loadedCount + 1, count: this.pageCount })
			}
			return this.t('Loading…')
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
.scoreview-print-toolbar {
	position: sticky;
	top: 0;
	z-index: 2;
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 8px 16px;
	background: var(--color-main-background);
	border-block-end: 1px solid var(--color-border);
}

.scoreview-print-toolbar-row {
	display: flex;
	align-items: center;
	gap: 16px;
	flex-wrap: wrap;
}

.scoreview-print-title {
	flex: 1 1 auto;
	min-inline-size: 0;
	margin: 0;
	font-size: 1.1rem;
	font-weight: bold;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.scoreview-print-status {
	color: var(--color-text-maxcontrast);
}

.scoreview-print-pdf {
	gap: 8px;
}

.scoreview-print-pdf-error {
	color: var(--color-error-text, var(--color-error));
}

@media print {
	.scoreview-print-toolbar {
		display: none;
	}
}
</style>
