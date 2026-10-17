<!--
	The print page (E16): every page of one score at once, laid out for the
	browser's print dialog. The viewer in Files loads and unloads pages as
	they scroll past (ScorePage.vue), so printing the Files page would print
	whatever happened to be loaded, inside Nextcloud's frame.

	The same ScorePage draws the sheets, in `static` mode: markers, note
	texts, stamps and note names are placed by the same code as on screen -
	the print shows what the screen shows, and a second placement would be
	the first deviation. The artifacts come through useConversionStatus,
	server path or browser fallback alike (E7: one `if` there, none here).
	No server-side PDF: neither conversion path can write one (E3), and the
	browser's "Save as PDF" keeps the SVG paths as vectors (measured, 0.2).
-->
<template>
	<div class="scoreview-print">
		<PrintToolbar
			v-model:withNotes="withNotes"
			v-model:noteNames="noteNamesOn"
			:title="title"
			:state="state"
			:errorText="errorText"
			:longWait="longWait"
			:clientProgress="clientProgress"
			:pageCount="pageUrls.length"
			:loadedCount="loadedCount"
			:noteNamesPossible="noteNamesPossible"
			@print="print" />
		<main class="scoreview-print-sheets">
			<div
				v-for="(url, i) in pageUrls"
				:key="url"
				class="scoreview-print-sheet"
				:style="sheetStyle">
				<ScorePage
					printSheet
					:svgUrl="url"
					:pageIndex="i"
					:zoom="sheetZoom"
					:markers="withNotes ? markers : NO_ITEMS"
					:stamps="withNotes ? stamps : NO_ITEMS"
					:systemRects="systemRectsByPage[i] ?? NO_ITEMS"
					:partCount="partCount"
					:showNoteText="withNotes"
					noteTheme="light"
					:spellings="spellings"
					:noteNameSystem="noteNameSystem"
					:noteNameStaves="noteNameStaves"
					:keyOfElid="keyOfElid"
					@loaded="onPageLoaded"
					@indexed="onPageIndexed"
					@staffMapping="onStaffMapping" />
			</div>
		</main>
	</div>
</template>

<script>
import axios from '@nextcloud/axios'
import { loadState } from '@nextcloud/initial-state'
import { getLanguage, translate } from '@nextcloud/l10n'
import { computed, ref, shallowRef } from 'vue'
import PrintToolbar from './PrintToolbar.vue'
import ScorePage from './ScorePage.vue'
import { useAnnotations } from '../composables/useAnnotations.js'
import { useConversionStatus } from '../composables/useConversionStatus.js'
import { useLeaders } from '../composables/useLeaders.js'
import { useMyPart } from '../composables/useMyPart.js'
import { useScoreFacts } from '../composables/useScoreFacts.js'
import { useViewerPreferences } from '../composables/useViewerPreferences.js'
import { capabilitiesOf } from '../lib/capabilities.js'
import { spellingMap } from '../lib/noteSpellingIndex.js'
import { pageBoxMm, pageCss } from '../lib/printLayout.js'
import { keyByElid } from '../lib/scoreFacts.js'
import { BASE_PAGE_WIDTH_PX, buildTimeline, groupRectsByPage } from '../lib/scoreLayout.js'

const t = (text, vars) => translate('scoreview', text, vars)

/** CSS pixels per millimetre - the print dialog maps 96 px to one inch. */
const PX_PER_MM = 96 / 25.4

// One frozen empty array for every "nothing here": a fresh [] per render
// would count as a change and re-render every sheet.
const NO_ITEMS = Object.freeze([])

function readState(key) {
	try {
		return loadState('scoreview', key)
	} catch {
		return null
	}
}

export default {
	name: 'PrintApp',

	components: {
		PrintToolbar,
		ScorePage,
	},

	setup() {
		const page = readState('print') ?? {}
		const fileId = Number(page.fileId)

		const pageUrls = shallowRef([])
		const timeline = shallowRef(null)
		const measuresTimeline = shallowRef(null)
		const scoreMeta = shallowRef(null)
		const currentEtag = ref(null)
		// meta.json's duration is in seconds; the last measure of the key
		// lookup ends there.
		const durationMs = computed(() => Math.round((scoreMeta.value?.duration ?? 0) * 1000))

		const preferences = useViewerPreferences()
		const myPart = useMyPart({ fileId: () => fileId })
		const leaders = useLeaders({ fileId: () => fileId })
		const annotations = useAnnotations({
			fileId: () => fileId,
			timeline: () => timeline.value,
			measuresTimeline: () => measuresTimeline.value,
			currentEtag: () => currentEtag.value,
			durationMs: () => durationMs.value,
			// Nothing to seek on paper.
			seek: () => {},
			parts: () => scoreMeta.value?.parts ?? [],
			myPartId: () => myPart.myPartId.value,
			isLeader: () => leaders.isLeader.value,
		})
		// No playback here, so nobody else has the MIDI: the facts fetch it
		// themselves where the keys need it (sidecar path, E12).
		const scoreFacts = useScoreFacts({
			midiData: () => null,
			meta: () => scoreMeta.value,
			measuresTimeline: () => measuresTimeline.value,
		})

		const conversion = useConversionStatus({
			fileId: () => fileId,
			onReady: async ({ files }) => {
				try {
					const [timingRes, measuresRes, metaRes] = await Promise.all([
						axios.get(files.timingJson),
						axios.get(files.measuresJson),
						axios.get(files.metaJson),
					])
					timeline.value = buildTimeline(timingRes.data)
					measuresTimeline.value = buildTimeline(measuresRes.data)
					scoreMeta.value = metaRes.data
					currentEtag.value = files.etag
					pageUrls.value = files.pages
					scoreFacts.ensureMidi(files.midi)
					myPart.load()
				} catch (err) {
					conversion.state.value = 'error'
					conversion.errorMessage.value = err?.message ?? String(err)
					conversion.errorCode.value = ''
				}
			},
		})

		// Whether the SVG carries segment ids (M10) is known once a sheet has
		// indexed itself - the same signal the viewer uses (E15).
		const svgHasSegIds = ref(false)
		const capabilities = computed(() => capabilitiesOf({ meta: scoreMeta.value, svgHasSegIds: svgHasSegIds.value }))
		const spellings = computed(() => (capabilities.value.spellings ? spellingMap(scoreMeta.value?.noteSpellings) : null))
		const elidKeys = computed(() => keyByElid(timeline.value, scoreFacts.facts.value?.keys ?? [], measuresTimeline.value, durationMs.value))
		const systemRectsByPage = computed(() => (measuresTimeline.value ? groupRectsByPage(measuresTimeline.value) : []))

		return {
			fileId,
			fileName: page.fileName ?? '',
			pageUrls,
			scoreMeta,
			state: conversion.state,
			errorText: conversion.errorText,
			longWait: conversion.langeWartezeit,
			clientProgress: conversion.clientProgress,
			poll: conversion.poll,
			preferenceNoteNames: preferences.noteNames,
			noteNamesMine: preferences.noteNamesMine,
			myPartId: myPart.myPartId,
			loadLeaders: leaders.load,
			loadAnnotations: annotations.load,
			markers: annotations.markers,
			stamps: annotations.stamps,
			svgHasSegIds,
			capabilities,
			spellings,
			elidKeys,
			systemRectsByPage,
			NO_ITEMS,
		}
	},

	data() {
		return {
			withNotes: false,
			noteNamesOn: this.preferenceNoteNames !== 'off',
			// Indices of the sheets that have loaded - a Set, since a sheet
			// reports once and the count must not depend on the order.
			loaded: new Set(),
			loadedCount: 0,
			staffMappingOk: false,
			notesLoaded: false,
			pageStyleEl: null,
		}
	},

	computed: {
		/** The file name without its extension - what the print dialog shows as the job. */
		title() {
			return this.fileName.replace(/\.(mscz|mscx)$/i, '')
		},

		/** The sheet size: the score's own page format (printLayout.js). */
		pageBox() {
			return pageBoxMm(this.scoreMeta)
		},

		sheetStyle() {
			return { width: `${this.pageBox.widthMm}mm`, height: `${this.pageBox.heightMm}mm` }
		},

		/**
		 * ScorePage sizes itself as BASE_PAGE_WIDTH_PX × zoom. On paper the
		 * sheet is exactly as wide as the page format says, so the zoom is
		 * whatever makes the two agree - note names then scale with the real
		 * sheet, not with a screen width.
		 */
		sheetZoom() {
			return (this.pageBox.widthMm * PX_PER_MM) / BASE_PAGE_WIDTH_PX
		},

		partCount() {
			return this.scoreMeta?.parts?.length ?? 0
		},

		myPartIndex() {
			if (this.myPartId === null) {
				return null
			}
			const index = (this.scoreMeta?.parts ?? []).findIndex((part) => String(part.id) === String(this.myPartId))
			return index === -1 ? null : index
		},

		/** Note names need spellings and segment ids, as in the viewer (E15). */
		noteNamesPossible() {
			return this.capabilities.spellings && this.capabilities.segIds
		},

		/**
		 * The naming system for the sheets: the viewer setting, or - switched
		 * on here while the setting says off - the one that fits the
		 * interface language.
		 */
		noteNameSystem() {
			if (!this.noteNamesOn || !this.noteNamesPossible) {
				return null
			}
			if (this.preferenceNoteNames !== 'off') {
				return this.preferenceNoteNames
			}
			return getLanguage().toLowerCase().startsWith('de') ? 'de' : 'en'
		},

		/** Only my own staff, as in the viewer, where staves map to parts. */
		noteNameStaves() {
			if (!this.noteNamesMine || this.myPartIndex === null || !this.staffMappingOk) {
				return null
			}
			return [this.myPartIndex]
		},
	},

	watch: {
		withNotes(on) {
			if (on && !this.notesLoaded) {
				// Loaded on first use, not on open: most prints go without.
				this.notesLoaded = true
				this.loadLeaders()
				this.loadAnnotations()
			}
		},

		pageBox: {
			handler() {
				this.applyPageCss()
			},

			immediate: true,
		},

		title: {
			handler(title) {
				if (title) {
					document.title = title
				}
			},

			immediate: true,
		},
	},

	mounted() {
		this.poll()
	},

	beforeUnmount() {
		this.pageStyleEl?.remove()
	},

	methods: {
		t,

		/**
		 * `@page` cannot live in a scoped style with a value from data; one
		 * style element in the head carries it.
		 */
		applyPageCss() {
			if (!this.pageStyleEl) {
				this.pageStyleEl = document.createElement('style')
				document.head.appendChild(this.pageStyleEl)
			}
			this.pageStyleEl.textContent = pageCss(this.pageBox)
		},

		onPageLoaded({ index }) {
			this.loaded.add(index)
			this.loadedCount = this.loaded.size
		},

		onStaffMapping(possible) {
			this.staffMappingOk = possible
		},

		onPageIndexed({ segIds }) {
			if (segIds) {
				this.svgHasSegIds = true
			}
		},

		keyOfElid(elid) {
			return this.elidKeys(elid)
		},

		print() {
			window.print()
		},
	},
}
</script>

<style>
/*
 * The base layout (RENDER_AS_BASE) is built for an app that fills the
 * window; a print needs a document that flows, or the dialog prints the
 * first screenful only. On screen the sheets scroll inside the page like
 * any document.
 */
#body-public #content.app-public {
	margin: 0;
	padding: 0;
	block-size: auto;
	min-block-size: 100%;
}

#scoreview-print {
	display: block;
	inline-size: 100%;
	color-scheme: light;
}

@media print {
	html,
	body,
	#content,
	#scoreview-print {
		position: static !important;
		block-size: auto !important;
		min-block-size: 0 !important;
		overflow: visible !important;
		margin: 0 !important;
		padding: 0 !important;
		background: #fff !important;
	}
}
</style>

<style scoped>
.scoreview-print {
	min-block-size: 100%;
	background: var(--color-background-dark, #eee);
	/* The sheets are paper: light, whatever the interface theme says. */
	--scoreview-page: #fff;
	--scoreview-ink: #000;
}

.scoreview-print-sheets {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 16px;
	padding: 16px 0;
}

.scoreview-print-sheet {
	overflow: hidden;
	background: #fff;
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}

@media print {
	.scoreview-print {
		background: #fff;
	}

	.scoreview-print-sheets {
		display: block;
		padding: 0;
	}

	.scoreview-print-sheet {
		box-shadow: none;
		/* One sheet per page; the last one must not push an empty page out. */
		break-after: page;
	}

	.scoreview-print-sheet:last-child {
		break-after: auto;
	}
}
</style>
