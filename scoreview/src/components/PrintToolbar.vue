<!--
	The bar above the sheets of the print page (E16): what goes on paper, and
	the Print button. Hidden on paper itself (@media print).

	"Notes and stamps" is off by default (decision: everything I see, but
	chosen, not assumed - a rehearsal note on a concert copy is a surprise).
	"Note names" follows the person's viewer setting.

	The Print button stays locked until every sheet has loaded: otherwise
	someone prints half a score after the first glance.
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
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import Printer from 'vue-material-design-icons/Printer.vue'

export default {
	name: 'PrintToolbar',

	components: {
		NcButton,
		NcCheckboxRadioSwitch,
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
	},

	emits: ['update:withNotes', 'update:noteNames', 'print'],

	computed: {
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

@media print {
	.scoreview-print-toolbar {
		display: none;
	}
}
</style>
