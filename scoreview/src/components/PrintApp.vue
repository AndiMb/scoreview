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

	"Save as PDF in Files" (A1b) writes the PDF here in the browser, from the
	same page SVGs (lib/svgToPdf.js, lib/pdfWriter.js), and puts it next to
	the score. Only the music: notes, stamps and note names are overlays
	placed on screen, and drawing them into the file would mean a second
	placement - the print dialog carries them.
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
			:canSavePdf="canWriteFolder"
			:pdf="pdf"
			@print="print"
			@savePdf="savePdf(false)"
			@replacePdf="savePdf(true)"
			@dismissPdf="pdf = { state: '' }" />
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
import { getLanguage } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { computed, ref, shallowRef } from 'vue'
import PrintToolbar from './PrintToolbar.vue'
import ScorePage from './ScorePage.vue'
import { loadPictureArtifacts } from '../composables/pictureArtifacts.js'
import { useAnnotations } from '../composables/useAnnotations.js'
import { useConversionStatus } from '../composables/useConversionStatus.js'
import { useLeaders } from '../composables/useLeaders.js'
import { useMyPart } from '../composables/useMyPart.js'
import { useScoreFacts } from '../composables/useScoreFacts.js'
import { useViewerPreferences } from '../composables/useViewerPreferences.js'
import { readInitialState } from '../initialState.js'
import { translate } from '../l10n.js'
import { capabilitiesOf } from '../lib/capabilities.js'
import { noteNameStaves, noteNameSystem } from '../lib/noteNameSystem.js'
import { spellingMap } from '../lib/noteSpellingIndex.js'
import { createPdf } from '../lib/pdfWriter.js'
import { pageBoxMm, pageCss } from '../lib/printLayout.js'
import { keyByElid } from '../lib/scoreFacts.js'
import { BASE_PAGE_WIDTH_PX, groupRectsByPage } from '../lib/scoreLayout.js'
import { serverError } from '../lib/serverError.js'
import { createStaffMappingReports } from '../lib/staffMappingReports.js'
import { svgPageToPdf } from '../lib/svgToPdf.js'
import { elidMapping, mergePictureMeta, pictureParts as partsOfPicture } from '../lib/variantChoice.js'

const t = (text, vars) => translate('scoreview', text, vars)

/** CSS pixels per millimetre - the print dialog maps 96 px to one inch. */
const PX_PER_MM = 96 / 25.4

// One frozen empty array for every "nothing here": a fresh [] per render
// would count as a change and re-render every sheet.
const NO_ITEMS = Object.freeze([])

/**
 * A PNG, GIF or BMP data URI as RGB on white, for the PDF (svgToPdf.js
 * takes JPEG as it is). The one impure step of the PDF writing, so it
 * lives here and not in the lib: it needs an image decoder and a canvas.
 * White underneath because paper is white - an alpha channel has no
 * place in a DeviceRGB image.
 *
 * @param {string} href data URI
 * @return {Promise<?{kind: 'rgb', width: number, height: number, bytes: Uint8Array}>}
 */
async function decodeImage(href) {
	try {
		const image = new Image()
		image.src = href
		await image.decode()
		const canvas = document.createElement('canvas')
		canvas.width = image.naturalWidth
		canvas.height = image.naturalHeight
		const context = canvas.getContext('2d')
		context.fillStyle = '#fff'
		context.fillRect(0, 0, canvas.width, canvas.height)
		context.drawImage(image, 0, 0)
		const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
		const bytes = new Uint8Array(canvas.width * canvas.height * 3)
		for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
			bytes[j] = rgba[i]
			bytes[j + 1] = rgba[i + 1]
			bytes[j + 2] = rgba[i + 2]
		}
		return { kind: 'rgb', width: canvas.width, height: canvas.height, bytes }
	} catch {
		// Reported as an element that could not be written.
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
		const page = readInitialState('print') ?? {}
		const fileId = Number(page.fileId)

		const pageUrls = shallowRef([])
		const timeline = shallowRef(null)
		const measuresTimeline = shallowRef(null)
		const scoreMeta = shallowRef(null)
		// The display variant the viewer showed (E19), from `?variant=`: a
		// part or phone pages print as such. Its meta describes the picture;
		// the piece stays scoreMeta's.
		const variantKey = new URLSearchParams(window.location.search).get('variant')
		const variantMeta = shallowRef(null)
		const pictureMeta = computed(() => mergePictureMeta(scoreMeta.value, variantMeta.value))
		const pictureParts = computed(() => partsOfPicture(scoreMeta.value, variantMeta.value))
		const elids = computed(() => elidMapping(variantMeta.value))
		const currentEtag = ref(null)
		// From the status body, as in the viewer: offer the PDF file only where
		// the person may create files next to the score.
		const canWriteFolder = ref(false)
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
			pictureParts: () => pictureParts.value,
			pictureElid: (elid) => elids.value.toPicture(elid),
			myPartId: () => myPart.myPartId.value,
			isLeader: () => leaders.isLeader.value,
		})
		// No playback here, so nobody else has the MIDI: the facts fetch it
		// themselves where the keys need it (MuseScore on the sidecar, E12).
		const scoreFacts = useScoreFacts({
			midiData: () => null,
			meta: () => scoreMeta.value,
			measuresTimeline: () => measuresTimeline.value,
		})

		const conversion = useConversionStatus({
			fileId: () => fileId,
			onReady: async ({ files, canWriteFolder: mayWrite }) => {
				canWriteFolder.value = mayWrite === true
				try {
					const base = await loadPictureArtifacts(files)
					let picture = { ...base, meta: null }
					if (variantKey) {
						// Where the variant cannot be had, the score prints as
						// the file has it - better than no print at all.
						const answer = await conversion.requestVariant(variantKey)
						if (answer?.status === 'ready') {
							picture = await loadPictureArtifacts(answer.files)
						}
					}
					timeline.value = picture.timeline
					measuresTimeline.value = picture.measures
					scoreMeta.value = base.meta
					variantMeta.value = picture.meta
					currentEtag.value = files.etag
					pageUrls.value = picture.pages
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
		const capabilities = computed(() => capabilitiesOf({ meta: pictureMeta.value, svgHasSegIds: svgHasSegIds.value }))
		const spellings = computed(() => (capabilities.value.spellings ? spellingMap(pictureMeta.value?.noteSpellings) : null))
		const elidKeys = computed(() => keyByElid(timeline.value, scoreFacts.facts.value?.keys ?? [], measuresTimeline.value, durationMs.value))
		const systemRectsByPage = computed(() => (measuresTimeline.value ? groupRectsByPage(measuresTimeline.value) : []))

		return {
			fileId,
			fileName: page.fileName ?? '',
			pageUrls,
			scoreMeta,
			pictureMeta,
			pictureParts,
			variantKey,
			canWriteFolder,
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
			// Not reactive: only its answer is (staffMappingOk).
			staffMappingReports: createStaffMappingReports(),
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
			// The PDF file (A1b): state '' | working | done | exists | error,
			// with progress, file name, error text and what could not be written.
			pdf: { state: '' },
			// The written file while "replace?" is open, so a yes sends it at once.
			pdfBlob: null,
		}
	},

	computed: {
		/** The file name without its extension - what the print dialog shows as the job. */
		title() {
			const base = this.fileName.replace(/\.(mscz|mscx)$/i, '')
			// A part prints under its own name next to the score's (E19):
			// "Lied - Sopran.pdf" beside "Lied.pdf", not a second "Lied.pdf".
			// A stored part has the name its arranger gave it.
			const stored = /^ex(\d+)~/.exec(this.variantKey ?? '')
			if (stored) {
				const name = this.scoreMeta?.excerpts?.[Number(stored[1])]?.name
				return name ? `${base} - ${name}` : base
			}
			const isPart = this.pictureParts.length > 0 && this.pictureParts.length < (this.scoreMeta?.parts?.length ?? 0)
			return isPart ? `${base} - ${this.pictureParts.map((p) => p.name).filter(Boolean).join(', ')}` : base
		},

		/** The sheet size: the score's own page format (printLayout.js). */
		pageBox() {
			return pageBoxMm(this.pictureMeta)
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
			return this.pictureParts.length
		},

		myPartIndex() {
			if (this.myPartId === null) {
				return null
			}
			const index = this.pictureParts.findIndex((part) => String(part.id) === String(this.myPartId))
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
			return noteNameSystem(this.preferenceNoteNames, getLanguage())
		},

		/** Only my own staff, as in the viewer, where staves map to parts. */
		noteNameStaves() {
			return noteNameStaves(this.noteNamesMine, this.myPartIndex, this.staffMappingOk)
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

		onStaffMapping(possible, page) {
			this.staffMappingOk = this.staffMappingReports.report(page, possible)
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

		/**
		 * Write the PDF from the page SVGs and save it next to the score.
		 * With `replace`, the file written last time is sent again instead
		 * of writing it anew - the answer to "replace?" should be instant.
		 *
		 * @param {boolean} replace
		 */
		async savePdf(replace) {
			if (this.pdf.state === 'working') {
				return
			}
			const unsupported = new Set(replace ? (this.pdf.unsupported ?? []) : [])
			try {
				if (!replace || !this.pdfBlob) {
					this.pdfBlob = await this.writePdf(unsupported)
				}
				this.pdf = { state: 'working', unsupported: [...unsupported] }
				const response = await axios.post(
					generateUrl('/apps/scoreview/api/scores/{fileId}/pdf', { fileId: this.fileId }),
					this.pdfBlob,
					{ params: { name: this.title, replace }, headers: { 'Content-Type': 'application/pdf' } },
				)
				this.pdfBlob = null
				this.pdf = { state: 'done', name: response.data?.name ?? '', unsupported: [...unsupported] }
			} catch (err) {
				const data = err?.response?.data
				if (err?.response?.status === 409 && data?.reason === 'exists') {
					this.pdf = { state: 'exists', name: `${this.title}.pdf`, unsupported: [...unsupported] }
					return
				}
				this.pdfBlob = null
				this.pdf = { state: 'error', error: serverError(err, err?.message ?? String(err)), unsupported: [...unsupported] }
			}
		},

		/**
		 * All pages into one PDF. The SVG text is fetched again (the browser
		 * has it cached from the sheets) and parsed as an inert XML document:
		 * nothing of it reaches the DOM or runs, and svgToPdf.js reads only
		 * the drawing elements, so the sanitizer has nothing to do here.
		 * One await per page, so the page stays responsive and the progress
		 * shows.
		 *
		 * @param {Set<string>} unsupported collects what could not be written
		 * @return {Promise<Blob>}
		 */
		async writePdf(unsupported) {
			const of = this.pageUrls.length
			const writer = createPdf({ title: this.title, producer: 'ScoreView' })
			for (let i = 0; i < of; i++) {
				this.pdf = { state: 'working', page: i + 1, of }
				const response = await axios.get(this.pageUrls[i], { responseType: 'text' })
				const page = await svgPageToPdf(response.data, this.pageBox, { decodeImage })
				page.unsupported.forEach((item) => unsupported.add(item))
				writer.addPage(page)
			}
			this.pdf = { state: 'working' }
			return new Blob([await writer.finish()], { type: 'application/pdf' })
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
