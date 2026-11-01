<template>
	<!--
		The pages of the bar's tools, written once (reusableTemplate.js):
		they open inside their group and, pinned (E23), in a popover of
		their own. Rendered only where a page is shown.
	-->
	<component :is="DefineToolPage" v-slot="{ id }">
		<div v-if="id === 'loop'" class="scoreview-controls">
			<div class="scoreview-popover-row">
				<NcTextField
					v-model.number="loop.fromMeasure"
					type="number"
					min="1"
					:label="t('From measure')" />
				<NcTextField
					v-model.number="loop.toMeasure"
					type="number"
					min="1"
					:label="t('To measure')" />
			</div>
			<NcButton wide :aria-label="t('Loop from current measure')" @click="loop.setFromCurrentMeasure(navigation.currentAnchor?.measureNumber)">
				<template #icon>
					<CrosshairsGps :size="20" />
				</template>
				{{ t('Loop from current measure') }}
			</NcButton>
			<NcButton
				wide
				:pressed="loop.active"
				:aria-label="loop.active ? t('Loop on') : t('Loop off')"
				@click="view.toggleLoop">
				<template #icon>
					<Repeat :size="20" />
				</template>
				{{ loop.active ? t('Loop on') : t('Loop off') }}
			</NcButton>
			<!-- Focus (B4): only while a loop runs, gone with it. -->
			<NcCheckboxRadioSwitch
				v-if="loop.active"
				v-model="view.loopFocus"
				type="switch">
				{{ t('Show only the loop') }}
			</NcCheckboxRadioSwitch>
			<ScoreSpeedTrainer
				v-if="loop.active && playback.hasRealPlayer"
				v-model:startBpm="trainer.startBpm"
				v-model:targetBpm="trainer.targetBpm"
				v-model:stepBpm="trainer.stepBpm"
				:minBpm="playback.minTempoBpm"
				:maxBpm="playback.maxTempoBpm"
				:active="trainer.active"
				:passes="trainer.passes"
				:currentBpm="playback.effectiveTempoBpm"
				@toggle="trainer.toggle" />
			<!--
				Saved loops (B5): kept like notes, so a
				leader can save "Alto: 12-20" for the altos
				and everyone else sees it dimmed.
			-->
			<fieldset v-if="annotations.savedLoops.length > 0" class="scoreview-popover-group">
				<legend>{{ t('Saved loops') }}</legend>
				<button
					v-for="savedLoop in annotations.savedLoops"
					:key="savedLoop.id"
					type="button"
					class="scoreview-saved-loop"
					:class="{ 'scoreview-saved-loop--dimmed': savedLoop.dimmed }"
					:disabled="savedLoop.orphaned || !performance.can('loop')"
					@click="view.applySavedLoop(savedLoop)">
					<span class="scoreview-saved-loop-name">{{ savedLoop.name || t('Measures {from}–{to}', { from: savedLoop.from, to: savedLoop.to }) }}</span>
					<span class="scoreview-saved-loop-meta">{{ savedLoopMeta(savedLoop) }}</span>
				</button>
			</fieldset>
			<NcButton
				v-if="loop.active && performance.can('annotate') && !loopSaving"
				wide
				:aria-label="t('Save this loop…')"
				@click="loopSaving = true">
				<template #icon>
					<ContentSave :size="20" />
				</template>
				{{ t('Save this loop…') }}
			</NcButton>
			<LoopSaveForm
				v-if="loopSaving && loop.active"
				:from="Number(loop.fromMeasure)"
				:to="Number(loop.toMeasure)"
				:isLeader="leaderRoles.isLeader"
				:parts="session.scoreParts"
				:error="annotations.error"
				@save="saveLoop"
				@cancel="loopSaving = false" />
		</div>
		<TempoControls
			v-else-if="id === 'tempo'"
			v-model:metronomeBeats="metronome.beats"
			:hasRealPlayer="playback.hasRealPlayer"
			:effectiveTempoBpm="playback.effectiveTempoBpm"
			:tempoGuessed="playback.tempoGuessed"
			:minTempoBpm="playback.minTempoBpm"
			:maxTempoBpm="playback.maxTempoBpm"
			:audioOffsetMs="playback.manualOffsetMs"
			:readAutomaticLatencyMs="readAutomaticLatencyMs"
			@tempoInput="playback.onTempoBpmInput"
			@audioOffsetInput="playback.onManualOffsetInput" />
		<TransposeControls
			v-else-if="id === 'transpose'"
			:semitones="view.effectiveTranspose"
			:startKey="view.startKey"
			:fromLeader="view.sessionTranspose !== null"
			:notationAvailable="conversion.variantsSupported"
			:transposeNotation="variant.transposeNotation"
			@update:semitones="onTransposeInput"
			@update:transposeNotation="variant.setTransposeNotation" />
		<CoachControls
			v-else-if="id === 'coach'"
			:coach="myPart.practice.coach"
			:othersLevel="myPart.practice.othersLevel"
			:hasMyPart="myPart.myPartId !== null"
			@update:coach="myPart.setPractice({ coach: $event })"
			@update:othersLevel="myPart.setPractice({ othersLevel: $event })" />
		<NoteNameControls
			v-else-if="id === 'noteNames'"
			v-model:system="prefs.noteNames"
			v-model:onlyMine="prefs.noteNamesMine"
			v-model:counts="prefs.beatCounts"
			:hasMyPart="myPart.myPartId !== null"
			:transpose="view.effectiveTranspose"
			:unavailable="display.noteNamesUnavailable"
			:countsUnavailable="display.countsUnavailable" />
		<LayoutControls
			v-else-if="id === 'layout'"
			v-model:layout="prefs.layout"
			v-model:doublePage="prefs.doublePage"
			:spreadUnavailable="display.spreadUnavailable"
			:lyricsUnavailable="display.lyricsUnavailable"
			:variantSources="variantSourceChoices"
			:variantSource="variant.source"
			:variantFormat="variant.format"
			:variantConcert="variant.concert"
			:showConcert="variant.hasTransposingParts"
			:variantUnavailable="variant.unavailableReason"
			@update:variantSource="variant.setSource"
			@update:variantFormat="variant.setFormat"
			@update:variantConcert="variant.setConcert" />
		<AppearanceControls
			v-else-if="id === 'appearance'"
			v-model:highlightMode="prefs.highlightMode"
			v-model:highlightColor="prefs.highlightColor"
			v-model:noteTheme="prefs.noteTheme" />
		<PracticeExportControls
			v-else-if="id === 'export'"
			:running="practiceExport.running"
			:progress="practiceExport.progress"
			:error="practiceExport.error"
			:conflict="practiceExport.conflict"
			:saved="practiceExport.saved"
			:loopRange="exportLoopRange"
			:canWriteFolder="session.canWriteFolder"
			:standalone="view.standalonePage"
			:metronomeMode="metronome.beats"
			@export="practiceExport.exportOne"
			@exportAll="practiceExport.exportAllParts"
			@cancel="practiceExport.cancel"
			@resolveConflict="practiceExport.resolveConflict" />
		<PinControls
			v-else-if="id === 'offline'"
			:fileId="view.activeFileId"
			:setlistId="setlistNav.active ? (setlistNav.setlist?.id ?? null) : null"
			:title="pinTitle"
			:setlistTitle="view.setlistTitle"
			:estimate="offlineStore.estimate"
			:busy="offlineStore.busy"
			:progress="offlineStore.progress"
			:done="offlineStore.done"
			:error="offlineStore.error"
			@pin="offlineStore.pin($event)" />
		<ScoreInfoControls
			v-else-if="id === 'info'"
			:rendererBackend="session.rendererBackend"
			:mscoreVersion="session.mscoreVersion"
			:canReconvert="session.canReconvert"
			:readDiagnostics="readAudioDiagnostics"
			@reconvert="$emit('reconvert')" />
	</component>
	<!--
		Die Leiste: Wie sie steht (eingefahren, kompakt, Werkzeuge auf
		Abruf), regeln ScoreBar.vue und useBarLayout.js; was darin
		steht, ist hier verdrahtet.
	-->
	<ScoreBar
		v-model:toolsOpen="bar.toolsOpen"
		:collapsed="bar.collapsed"
		:compact="bar.compact"
		:anyToolActive="anyToolActive"
		:readProgress="readPlaybackPercent"
		@show="bar.show"
		@activity="bar.scheduleCollapse"
		@overflow="bar.reportOverflow"
		@height="bar.reportHeight">
		<template #transport>
			<NcButton
				class="scoreview-play"
				variant="primary"
				:disabled="!performance.can('play')"
				:aria-label="playback.isPlaying ? t('Pause') : t('Play')"
				:title="playback.isPlaying ? t('Pause') : t('Play')"
				@click="onPlayClick">
				<template #icon>
					<Pause v-if="playback.isPlaying" :size="20" />
					<Play v-else :size="20" />
				</template>
			</NcButton>
			<!-- Die Zeit liest nur LiveValue: sonst rendert der ganze
				Viewer in jedem Frame neu (siehe LiveValue.vue). -->
			<!--
				Auf SEEK_STEP_MS gerundet: Jeder neue Wert des Reglers loest in
				Files eine Stil-Neuberechnung ueber den ganzen Baum aus
				(Nextclouds :has()-Regeln an body/Viewer, gemessen: 7139
				Elemente, ~78 ms je Mal am Desktop). In jedem Bild
				geschrieben, frass das am Telefon die halbe Hauptthread-Zeit;
				Vue schreibt den Wert nur, wenn er sich aendert.
			-->
			<LiveValue v-slot="{ value }" :get="() => seekValue(playback.displayTimeMs)">
				<input
					type="range"
					class="scoreview-seek"
					min="0"
					:max="session.durationMs"
					:value="value"
					:disabled="!performance.can('seek')"
					:aria-label="t('Playback position')"
					@input="onSeekBarInput">
				<span v-node-text="`${formatTime(value)} / ${formatTime(session.durationMs)}`" class="scoreview-time" />
			</LiveValue>
			<!--
			Taktanzeige und Sprungfeld sind DASSELBE Feld: getrennt zeigten
			sie dieselbe Zahl an zwei Stellen und kosteten zusammen fast eine
			halbe Leiste. Solange das Feld den Fokus hat, laeuft die Anzeige
			nicht mit - sonst wuerde die Wiedergabe die gerade getippte Zahl
			ueberschreiben.
		-->
			<span class="scoreview-measure">
				<!-- Die feste Breite sitzt am Wrapper, nicht an NcTextField
					selbst - Begründung im CSS unten. -->
				<!--
					Mit Studierbuchstaben nimmt das Feld auch „C" und
					„C+3" an und zeigt „47 (C+3)" - deshalb dann Text statt
					Zahl, und breiter. Ohne Buchstaben bleibt es das
					Zahlenfeld von heute.
				-->
				<span class="scoreview-measure-field" :class="{ 'scoreview-measure-field--marks': scoreFacts.marks.length > 0 }">
					<NcTextField
						v-model="navigation.input"
						:type="scoreFacts.marks.length > 0 ? 'text' : 'number'"
						min="1"
						:label="t('Measure')"
						:title="scoreFacts.marks.length > 0
							? t('Measure – enter a number or a rehearsal mark (C, C+3) and press Enter to jump there')
							: t('Measure – enter a number and press Enter to jump there')"
						:disabled="!performance.can('seek')"
						labelOutside
						@focus="navigation.onFieldFocus"
						@blur="navigation.onFieldBlur"
						@keyup.enter="navigation.jumpToInput" />
				</span>
				<span class="scoreview-measure-total">/ {{ session.totalMeasures || '–' }}</span>
			</span>
			<!--
				Der Aufklapper „Navigation": die Studierbuchstaben als Chips.
				Als Aufklapper statt als Leiste, weil die Leiste auf
				Telefonbreite keinen Platz fuer eine zweite Reihe hat; und nur,
				wenn die Partitur welche traegt.
			-->
			<NcPopover
				v-if="scoreFacts.marks.length > 0 && performance.can('seek')"
				v-model:shown="navigation.marksOpen"
				popoverBaseClass="scoreview-bounded-popper"
				:container="view.popoverContainer"
				:autoBoundaryMaxSize="true">
				<template #trigger>
					<NcButton
						class="scoreview-marks-button"
						:aria-label="t('Rehearsal marks')"
						:title="t('Rehearsal marks')">
						<template #icon>
							<BookmarkOutline :size="20" />
						</template>
					</NcButton>
				</template>
				<template #default>
					<div class="scoreview-popover scoreview-marks" role="group" :aria-label="t('Rehearsal marks')">
						<NcButton
							v-for="mark in scoreFacts.marks"
							:key="mark.text"
							class="scoreview-mark-chip"
							:aria-label="t('Go to rehearsal mark {mark} (measure {n})', { mark: mark.text, n: mark.measure })"
							:title="t('Measure {n}', { n: mark.measure })"
							@click="navigation.jumpToMark(mark)">
							{{ mark.text }}
						</NcButton>
					</div>
				</template>
			</NcPopover>
			<!--
				Anfangston und Schloss stehen im Transport, nicht in den
				Werkzeugen: Beide werden auf Telefonbreite gebraucht,
				und das Schloss ist im Aufführungsmodus der einzige Weg
				hinaus - es darf nicht hinter „Mehr" verschwinden.
			-->
			<ScoreStartTone
				v-if="performance.can('tone')"
				:mode="startTone.mode"
				:sounding="startTone.sounding"
				:toneName="startTone.lastToneName"
				:unavailableReason="startTone.unavailableReason"
				@press="startTone.press"
				@release="startTone.release" />
			<ScoreLockButton
				:active="performance.active"
				:holding="performance.holding"
				@down="performance.lockDown"
				@cancel="performance.cancelHold"
				@lockKeydown="performance.lockKeydown"
				@lockKeyup="performance.lockKeyup" />
			<!--
				Der rote Punkt: im Transport, nicht in den
				Werkzeugen - er muss auch im Aufführungsmodus und bei
				eingefahrenen Werkzeugen sichtbar und antippbar bleiben.
			-->
			<MicIndicator v-if="microphone.active" :consumers="microphone.consumers" @off="microphone.turnOff" />
		</template>
		<template #tools>
			<!--
				Pinned tools first (E23): what someone uses all the time,
				one tap away instead of two or three. The same rule as
				the groups decides what is visible (lib/barGroups.js
				barPins) - a pinned mixer without sound disappears.
			-->
			<template v-for="pin in barPins" :key="'pin-' + pin.id">
				<ToolGroup
					v-if="pin.kind === 'page'"
					class="scoreview-pinned"
					:label="toolLabel(pin.id)"
					:pressed="toolOn(pin.id)"
					:fixedPage="{ id: pin.id, title: toolLabel(pin.id) }">
					<template #icon>
						<component :is="toolIcon(pin.id)" :size="20" />
					</template>
					<template #page="{ id }">
						<component :is="ReuseToolPage" :id="id" />
					</template>
				</ToolGroup>
				<NcButton
					v-else
					class="scoreview-pinned"
					:pressed="pin.kind === 'action' ? undefined : toolOn(pin.id)"
					:aria-label="toolLabel(pin.id)"
					:title="toolLabel(pin.id)"
					@click="onToolTap(pin.id)">
					<template #icon>
						<component :is="toolIcon(pin.id)" :size="20" />
					</template>
				</NcButton>
			</template>
			<!--
				Die Werkzeuge in drei Gruppen (lib/barGroups.js - dort
				steht auch, was wann sichtbar ist). Im Aufführungsmodus
				bleibt nur „Ansicht" mit dem Zoom; was gesperrt ist,
				verschwindet, statt ausgegraut dazustehen - ein grauer
				Knopf laedt zum Antippen ein. Within a group the
				sections are divided by a line: the frequent tools
				first, what is set once below.
			-->
			<ToolGroup
				v-for="group in barGroups"
				:key="group.id"
				:label="groupLabel(group.id)"
				:active="groupActive(group.id)">
				<template #icon>
					<component :is="groupIcon(group.id)" :size="20" />
				</template>
				<template #default="{ openPage, close }">
					<template v-for="(section, index) in group.sections" :key="index">
						<hr v-if="index > 0" class="scoreview-group-divider">
						<template v-for="id in section" :key="id">
							<ZoomControls
								v-if="id === 'zoom'"
								v-bind="zoomView"
								@input="onZoomControlInput"
								@change="display.activeZoom.inputDone()"
								@preset="onZoomControlPreset" />
							<fieldset v-else-if="id === 'toneMode'" class="scoreview-popover-group">
								<!--
									Welcher Ton der Anfangston ist: der eigene
									oder der Grundton. Beide Moeglichkeiten
									beschriftet nebeneinander - an dieser Wahl
									entscheidet sich, was man gleich hoert.
									Right below "my part": "my note" is its
									first note.
								-->
								<legend>{{ t('Starting note') }}</legend>
								<div class="scoreview-tone-modes">
									<NcCheckboxRadioSwitch
										:modelValue="startTone.mode"
										type="radio"
										:value="MODE_TONIC"
										name="scoreview-tone-mode"
										buttonVariant
										buttonVariantGrouped="horizontal"
										:title="t('Key note of the current key')"
										@update:modelValue="startTone.setMode">
										{{ t('Key note') }}
									</NcCheckboxRadioSwitch>
									<NcCheckboxRadioSwitch
										:modelValue="startTone.mode"
										type="radio"
										:value="MODE_VOICE"
										name="scoreview-tone-mode"
										buttonVariant
										buttonVariantGrouped="horizontal"
										:title="t('The first note of my voice')"
										@update:modelValue="startTone.setMode">
										{{ t('My note') }}
									</NcCheckboxRadioSwitch>
								</div>
							</fieldset>
							<ToolSwitch
								v-else-if="toolKind(id) === 'switch'"
								:label="toolLabel(id)"
								:modelValue="toolOn(id)"
								v-bind="pinProps(id)"
								@update:modelValue="setSwitch(id, $event)"
								@pin="flipPin(id)" />
							<ToolRow
								v-else
								:page="toolKind(id) === 'page'"
								:pressed="toolKind(id) !== 'page' && toolOn(id)"
								:label="toolLabel(id)"
								:value="toolValue(id)"
								v-bind="pinProps(id)"
								@click="onToolTap(id, { openPage, close })"
								@pin="flipPin(id)">
								<template #icon>
									<component :is="toolIcon(id)" :size="20" />
								</template>
							</ToolRow>
						</template>
					</template>
				</template>
				<template #page="{ id }">
					<component :is="ReuseToolPage" :id="id" />
				</template>
			</ToolGroup>
			<!--
				Vollbild steht ausserhalb der Gruppen: Es wird am
				Notenstaender gebraucht, nicht eingerichtet. In der
				kompakten Leiste steht es vorn im Werkzeug-Streifen
				(CSS unten) - auf 360 px traegt der Transport keinen
				weiteren Knopf (docs/architecture.md, Telefonbreite).

				Always there: where the browser has no Fullscreen API -
				measured in the WebView of the Nextcloud Android app,
				document.fullscreenEnabled = false - it switches to
				fullscreen inside the page (useZoom.js, issue #20). The
				title says so, so that the system bars that stay are not
				taken for a fault.
			-->
			<NcButton
				class="scoreview-fullscreen"
				:pressed="zoom.isFullscreen"
				:aria-label="fullscreenLabel"
				:title="fullscreenLabel"
				@click="zoom.toggleFullscreen">
				<template #icon>
					<FullscreenExit v-if="zoom.isFullscreen" :size="20" />
					<Fullscreen v-else :size="20" />
				</template>
			</NcButton>
			<!--
				Only where the host has no cross of its own - the page of
				the mobile apps (StandaloneFrame.vue). There it replaces a
				header row of its own: in landscape that row and the bar
				took a third of the phone's height. Next to fullscreen and,
				like it, behind "More" on the compact bar: the transport
				carries nothing more at 360 px, and Android's back gesture
				leaves in one tap anyway. Not locked in performance mode -
				it locks working on the score, not leaving the page.
			-->
			<NcButton
				v-if="closable"
				class="scoreview-close"
				variant="tertiary"
				:aria-label="t('Close')"
				:title="t('Close')"
				@click="$emit('close')">
				<template #icon>
					<Close :size="20" />
				</template>
			</NcButton>
		</template>
	</ScoreBar>
</template>

<script>
import { computed, defineAsyncComponent, inject, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcPopover from '@nextcloud/vue/components/NcPopover'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import BookmarkOutline from 'vue-material-design-icons/BookmarkOutline.vue'
import Close from 'vue-material-design-icons/Close.vue'
import ContentSave from 'vue-material-design-icons/ContentSave.vue'
import CrosshairsGps from 'vue-material-design-icons/CrosshairsGps.vue'
import Fullscreen from 'vue-material-design-icons/Fullscreen.vue'
import FullscreenExit from 'vue-material-design-icons/FullscreenExit.vue'
import Pause from 'vue-material-design-icons/Pause.vue'
import Play from 'vue-material-design-icons/Play.vue'
import Repeat from 'vue-material-design-icons/Repeat.vue'
import AppearanceControls from './AppearanceControls.vue'
import CoachControls from './CoachControls.vue'
import LayoutControls from './LayoutControls.vue'
import LiveValue from './LiveValue.vue'
import LoopSaveForm from './LoopSaveForm.vue'
import MicIndicator from './MicIndicator.vue'
import NoteNameControls from './NoteNameControls.vue'
import PinControls from './PinControls.vue'
import ScoreBar from './ScoreBar.vue'
import ScoreInfoControls from './ScoreInfoControls.vue'
import ScoreLockButton from './ScoreLockButton.vue'
import ScoreSpeedTrainer from './ScoreSpeedTrainer.vue'
import ScoreStartTone from './ScoreStartTone.vue'
import TempoControls from './TempoControls.vue'
import ToolGroup from './ToolGroup.vue'
import ToolRow from './ToolRow.vue'
import ToolSwitch from './ToolSwitch.vue'
import TransposeControls from './TransposeControls.vue'
import ZoomControls from './ZoomControls.vue'
import nodeText from '../directives/nodeText.js'
import { translate } from '../l10n.js'
import { anyGroupActive, groupActive, isPinned, pinLimitReached, PINNABLE, togglePin, toolOn, toolValue, barGroups as visibleBarGroups, barPins as visibleBarPins } from '../lib/barGroups.js'
import { findMeasureStartTime } from '../lib/scoreLayout.js'
import { MODE_TONIC, MODE_VOICE } from '../lib/startTone.js'
import { formatTime, progressPercent, seekValue } from '../lib/viewerFormat.js'
import { GROUP_ICONS, groupLabel, TOOL_ICONS, toolLabel } from './barTools.js'
import { createReusableTemplate } from './reusableTemplate.js'
import { VIEWER_CONTEXT } from './viewerContext.js'

// Online only, rarely opened: a chunk of its own (see ScoreViewer.vue).
const PracticeExportControls = defineAsyncComponent(() => import(/* webpackChunkName: "panel-export" */ './PracticeExportControls.vue'))
/**
 * The viewer's bar: transport, pinned tools, the three groups and their
 * pages. How it stands (retracted, compact, tools on demand) is ScoreBar.vue
 * and useBarLayout.js; what is visible and what is on, lib/barGroups.js;
 * names and icons, barTools.js. Here it is wired to the viewer's composables,
 * which come by injection (viewerContext.js) - the bar works with nearly all
 * of them, and as props they were sixty.
 */
export default {
	name: 'ViewerBar',

	components: {
		AppearanceControls,
		BookmarkOutline,
		Close,
		CoachControls,
		ContentSave,
		CrosshairsGps,
		Fullscreen,
		FullscreenExit,
		LayoutControls,
		LiveValue,
		LoopSaveForm,
		MicIndicator,
		NcButton,
		NcCheckboxRadioSwitch,
		NcPopover,
		NcTextField,
		NoteNameControls,
		Pause,
		PinControls,
		Play,
		PracticeExportControls,
		Repeat,
		ScoreBar,
		ScoreInfoControls,
		ScoreLockButton,
		ScoreSpeedTrainer,
		ScoreStartTone,
		TempoControls,
		ToolGroup,
		ToolRow,
		ToolSwitch,
		TransposeControls,
		ZoomControls,
	},

	directives: { nodeText },

	props: {
		// The host shows no cross of its own (see ScoreViewer.vue).
		closable: {
			type: Boolean,
			default: false,
		},
	},

	emits: ['close', 'reconvert'],

	setup() {
		const ctx = inject(VIEWER_CONTEXT)
		const { loop, view } = ctx
		// The tool pages, once for group and pinned popover (reusableTemplate.js).
		const toolPage = createReusableTemplate()
		// The save form of the running loop (B5) is open - closed with the loop.
		const loopSaving = ref(false)
		watch(() => loop.active, (active) => {
			if (!active) {
				loopSaving.value = false
			}
		})

		/** What the zoom controls show (ZoomControls.vue props). */
		const zoomView = computed(() => {
			const { zoom, percent, min, max, presets } = ctx.display.activeZoom
			return { zoom, percent, min, max, presets }
		})

		return {
			...ctx,
			DefineToolPage: toolPage.Define,
			ReuseToolPage: toolPage.Reuse,
			MODE_TONIC,
			MODE_VOICE,
			loopSaving,
			zoomView,
			setSwitch: view.setSwitch,
		}
	},

	computed: {
		/**
		 * Die Gruppen der Leiste mit ihren sichtbaren Werkzeugen
		 * (lib/barGroups.js - die einzige Stelle, die das entscheidet).
		 */
		barGroups() {
			const { features, view } = this
			return visibleBarGroups({
				can: this.performance.can,
				hasRealPlayer: this.playback.hasRealPlayer,
				canFocusMyPart: view.canFocusMyPart,
				hasParts: this.session.scoreParts.length > 0,
				canCoach: view.myPartInScore,
				recordingEnabled: features.recording,
				intonationEnabled: features.intonation,
				setlistCanCreate: this.setlistNav.canCreate,
				isLeader: this.leaderRoles.isLeader,
				exportEnabled: features.practiceExport,
				offlineEnabled: features.offline,
				practiceLogEnabled: features.practiceLog,
				singScoreEnabled: features.singScore,
				offline: view.offline,
				standalone: view.standalonePage,
			})
		},

		/** The pinned tools on the bar now (E23, lib/barGroups.js). */
		barPins() {
			return visibleBarPins(this.barGroups, this.prefs.barPins, this.leaderRoles.isLeader)
		},

		/**
		 * What is on, for the pressed tools and the dots of the groups
		 * (lib/barGroups.js toolOn/groupActive - one answer for both).
		 */
		barState() {
			const { view } = this
			return {
				panels: this.panels.open,
				metronomeEnabled: this.metronome.enabled,
				autoScroll: this.prefs.autoScroll,
				loopActive: this.loop.active,
				trainerActive: this.trainer.active,
				singActive: view.singActive,
				coachActive: this.myPart.practice.coach,
				transpose: view.effectiveTranspose,
				focusMyPart: view.focusMyPart,
				showNoteNames: this.display.noteNameSystem !== null || this.display.countOfElid !== null,
				showNoteText: view.showNoteText,
				setlistEditorMode: this.setlistNav.editorMode,
			}
		},

		/** Der Punkt am „Mehr"-Knopf der kompakten Leiste. */
		anyToolActive() {
			return anyGroupActive(this.barState)
		},

		fullscreenLabel() {
			if (this.zoom.isFullscreen) {
				return this.t('Exit fullscreen')
			}
			return this.zoom.fullscreenPossible ? this.t('Fullscreen') : this.t('Fullscreen (inside the app)')
		},

		/**
		 * The parts and scores to choose from (E19), labelled: names are
		 * score content and stay as they are (E4); a generated part says so.
		 */
		variantSourceChoices() {
			return this.variant.options.map((option) => ({
				value: option.value,
				label: option.kind === 'full'
					? this.t('Full score')
					: option.kind === 'stored'
						? option.name
						: this.t('{part} (generated)', { part: option.name }),
			}))
		},

		/**
		 * Der laufende Loop als Bereich fuer den Export „nur der Loop" -
		 * Takte fuer die Anzeige, Partiturzeit fuer den Worker.
		 *
		 * @return {?{fromMeasure: number, toMeasure: number, fromMs: number, toMs: number}}
		 */
		exportLoopRange() {
			const { loop } = this
			const measures = this.session.measuresTimeline
			if (!loop.active || !measures) {
				return null
			}
			const fromMs = findMeasureStartTime(measures, loop.fromMeasure)
			const toMs = findMeasureStartTime(measures, loop.toMeasure + 1) ?? this.session.durationMs
			return fromMs === null ? null : { fromMeasure: loop.fromMeasure, toMeasure: loop.toMeasure, fromMs, toMs }
		},

		/** Wie das Vorgemerkte auf der Offline-Seite heisst (Material, E4). */
		pinTitle() {
			return this.session.scoreMeta?.title || this.setlistNav.current?.label || this.t('Score')
		},
	},

	methods: {
		// Einzelargument-Wrapper um translate() (siehe tools/l10n.mjs).
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		formatTime,
		seekValue,
		groupLabel,
		toolLabel,

		groupIcon(id) {
			return GROUP_ICONS[id]
		},

		toolIcon(id) {
			return TOOL_ICONS[id]
		},

		/**
		 * @param {string} id a tool of lib/barGroups.js
		 * @return {string} 'panel' | 'switch' | 'page' | 'action'
		 */
		toolKind(id) {
			return PINNABLE[id]
		},

		/**
		 * The current value at the end of a row (ToolRow.vue): "♩ 80", "12–16".
		 *
		 * @param {string} id
		 * @return {string}
		 */
		toolValue(id) {
			return toolValue(id, {
				loopActive: this.loop.active,
				loopFrom: this.loop.fromMeasure,
				loopTo: this.loop.toMeasure,
				tempoBpm: this.playback.effectiveTempoBpm,
				tempoGuessed: this.playback.tempoGuessed,
				transpose: this.view.effectiveTranspose,
				coachActive: this.myPart.practice.coach,
				noteNames: this.prefs.noteNames,
				countsOn: this.display.countOfElid !== null,
				layout: this.prefs.layout,
				myPartLabel: this.view.myPartLabel,
				exportRunning: this.practiceExport.running,
			}, this.t)
		},

		/**
		 * Whether a tool is on (lib/barGroups.js toolOn) - the same answer
		 * the dot of its group is made of.
		 *
		 * @param {string} id
		 * @return {boolean}
		 */
		toolOn(id) {
			return toolOn(id, this.barState)
		},

		/**
		 * @param {string} id
		 * @return {boolean} der Punkt am Gruppenknopf
		 */
		groupActive(id) {
			return groupActive(id, this.barState)
		},

		/**
		 * A tap on a tool, in its group or pinned. In a group, a page opens
		 * there and a panel or action closes the group - the card it opens
		 * is what someone wants to see next. Pinned buttons have no group.
		 *
		 * @param {string} id
		 * @param {{openPage: (id: string, title: string) => void, close: () => void}} [group]
		 */
		onToolTap(id, group) {
			const kind = PINNABLE[id]
			if (kind === 'page') {
				group?.openPage(id, this.toolLabel(id))
				return
			}
			if (kind === 'switch') {
				this.setSwitch(id, !this.toolOn(id))
				return
			}
			if (id === 'tuner' && this.panels.isOpen('tuner')) {
				// Closing the tuner also lets go of the microphone.
				this.view.closeTuner()
			} else if (id === 'newSetlist') {
				this.setlistNav.toggleEditor('new')
			} else if (id === 'print') {
				this.view.openPrintPage()
			} else if (kind === 'panel') {
				this.panels.toggle(id)
			}
			group?.close()
		},

		/**
		 * The pin of a row (ToolPin.vue). Not on the offline page: nothing
		 * can be stored there, and a pin that forgets itself on the next
		 * visit is worse than none.
		 *
		 * @param {string} id
		 * @return {{pinnable: boolean, pinned?: boolean, pinDisabled?: boolean}}
		 */
		pinProps(id) {
			if (this.view.offline || !(id in PINNABLE)) {
				return { pinnable: false }
			}
			return {
				pinnable: true,
				pinned: isPinned(this.prefs.barPins, id, this.leaderRoles.isLeader),
				pinDisabled: pinLimitReached(this.prefs.barPins, this.leaderRoles.isLeader),
			}
		},

		flipPin(id) {
			this.prefs.barPins = togglePin(this.prefs.barPins, id, this.leaderRoles.isLeader)
		},

		onPlayClick() {
			if (this.performance.can('play')) {
				this.playback.toggle()
			}
		},

		onSeekBarInput(event) {
			if (this.performance.can('seek')) {
				this.view.followNavigation('seek')
				this.playback.onSeekInput(event)
			}
		},

		/**
		 * Eigene Transposition. Gilt gerade die der Leitung, loest das das
		 * Folgen (V7) - sonst ueberschriebe der naechste Stand der Leitung die
		 * eigene Wahl ungefragt.
		 *
		 * @param {number} semitones
		 */
		onTransposeInput(semitones) {
			if (this.view.sessionTranspose !== null) {
				this.view.sessionTranspose = null
				this.view.followNavigation('transpose')
			}
			this.myPart.setPractice({ transpose: semitones })
			// Die Leitung transponiert fuer alle (H6, F6.3).
			if (this.follow.mine) {
				this.follow.sendTranspose(semitones)
			}
		},

		/**
		 * @param {{name: string, visibility: string, targetParts: ?Array}} choice
		 */
		async saveLoop(choice) {
			await this.annotations.create({
				measureNumber: Number(this.loop.fromMeasure),
				endMeasure: Number(this.loop.toMeasure),
				fraction: 0,
				elid: null,
				anchorEtag: null,
				content: choice.name,
				visibility: choice.visibility,
				kind: 'loop',
				targetParts: choice.targetParts,
			})
			if (!this.annotations.error) {
				this.loopSaving = false
			}
		},

		/**
		 * The second line of a saved loop in the list: its range, and whom
		 * it is for.
		 *
		 * @param {object} saved
		 * @return {string}
		 */
		savedLoopMeta(saved) {
			const parts = [saved.name ? `${saved.from}–${saved.to}` : '']
			if (saved.visibility === 'parts') {
				parts.push(this.t('For {voices}', { voices: saved.voices.join(', ') }))
			} else if (saved.visibility === 'shared' && !saved.mine) {
				parts.push(this.t('by {name}', { name: saved.authorName }))
			}
			return parts.filter(Boolean).join(' · ')
		},

		/**
		 * The zoom slider, for whichever zoom the layout on screen has.
		 *
		 * @param {Event} event the slider's input event
		 */
		onZoomControlInput(event) {
			this.display.activeZoom.input(Number(event.target.value))
		},

		/** @param {string} preset 'default' in the band, a page fit elsewhere */
		onZoomControlPreset(preset) {
			this.display.activeZoom.preset(preset)
		},

		/**
		 * Die Position fuer die eingefahrene Leiste - als Methode, damit
		 * ScoreBar eine gleichbleibende Funktion bekommt statt eines Werts,
		 * der sich in jedem Frame aendert (gelesen nur in LiveValue).
		 *
		 * @return {number}
		 */
		readPlaybackPercent() {
			return progressPercent(this.playback.displayTimeMs, this.session.durationMs)
		},

		/**
		 * Die Betriebsdiagnose und die erkannte Latenz fuer die Aufklapper -
		 * als Methoden, damit die Kindkomponenten eine gleichbleibende
		 * Funktion bekommen statt eines Werts, der sich in jedem Frame
		 * aendert (siehe TempoControls.vue, AppearanceControls.vue).
		 *
		 * @return {object}
		 */
		readAudioDiagnostics() {
			return this.playback.audioDiagnostics
		},

		/** @return {number} */
		readAutomaticLatencyMs() {
			return this.playback.automaticLatencyMs
		},
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>

<style scoped>
.scoreview-play {
	flex: 0 0 auto;
}

.scoreview-seek {
	flex: 1 1 120px;
	min-width: 80px;
}

/* Touch-Zielgroessen (">= 44px", see ScoreViewer.vue): the seek slider has
   no NcButton variable - its thumb is enlarged here directly. */
@media (pointer: coarse) {
	.scoreview-seek::-webkit-slider-thumb {
		width: 24px;
		height: 24px;
	}

	.scoreview-seek::-moz-range-thumb {
		width: 24px;
		height: 24px;
	}
}

.scoreview-time {
	flex: 0 0 auto;
	font-variant-numeric: tabular-nums;
	color: var(--color-text-maxcontrast);
}

/* Auf Telefonbreite zählt jeder Millimeter: die Laufzeitanzeige ist die
   entbehrlichste Angabe der Leiste (der Suchlauf daneben zeigt die Position
   ohnehin), die Taktangabe dagegen die wichtigste. An `--compact` statt an
   einer Media Query, damit es dieselbe Schwelle ist wie für den Umbau der
   Leiste - zwei Schwellen wären zwei Zustände zu viel. */
.scoreview-bar--compact .scoreview-time {
	display: none;
}

/*
 * Die schmalsten Telefone (360 px): Play, Taktfeld, Anfangston, Schloss
 * und „Mehr" muessen auf EINE Zeile - gemessen ragte „Mehr" sonst 38 px aus
 * dem Bild und war nicht mehr zu erreichen, und mit ihm Dunkelmodus, Notizen
 * und Probe. Weichen muss der Suchlauf: Er ist die einzige Angabe, die das
 * Taktfeld daneben schon traegt, und auf 80 px ohnehin kaum zu treffen. An
 * der Breite des Streifens statt an der des Fensters, weil der Viewer auch in
 * einem schmalen Rahmen stecken kann. Bei Studierbuchstaben (breiteres Feld
 * plus Knopf) geht dazu die Gesamtzahl der Takte.
 */
@container (max-width: 400px) {
	.scoreview-seek {
		display: none;
	}

	.scoreview-measure {
		gap: 2px;
	}

	.scoreview-measure-field--marks {
		width: 96px;
	}

	.scoreview-measure-field--marks + .scoreview-measure-total {
		display: none;
	}
}

.scoreview-measure {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	gap: 4px;
	color: var(--color-text-maxcontrast);
	font-variant-numeric: tabular-nums;
}

/*
 * Feste Breite MUSS an einen Wrapper, nicht an NcTextField selbst
 * (Nutzer-Rückmeldung "das Taktfeld ist über die ganze Breite"):
 * NcInputField bringt `.input-field[data-v-…] { width: 100% }` mit -
 * dieselbe Spezifität wie eine scoped Klassenregel hier, und die
 * Bibliotheks-CSS wird später eingebunden, gewinnt bei Gleichstand also.
 * Eine Regel wie `.scoreview-measure-input { width: 70px }` wirkt deshalb
 * nicht (gemessen: 1376px). Innerhalb eines schmalen Wrappers ist
 * `width: 100%` genau das Gewünschte.
 */
.scoreview-measure-field {
	display: block;
	width: 72px;
}

/* „47 (C+3)" braucht Platz fuer die Klammer. */
.scoreview-measure-field--marks {
	width: 104px;
}

.scoreview-marks {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	max-width: 280px;
	/* As tall as the room on screen (boundedPopover.css). */
	box-sizing: border-box;
	max-block-size: inherit;
	overflow-y: auto;
}

/* Der obere Abstand von NcInputField (margin-block-start: 6px) verschiebt das
   Feld in einer waagerechten Leiste gegen alles andere. */
.scoreview-measure-field :deep(.input-field) {
	margin-block-start: 0;
}

.scoreview-measure-total {
	white-space: nowrap;
}

/* Grundton | Meine Stimme als zusammenhaengende Knopfgruppe. */
.scoreview-tone-modes {
	display: flex;
}

/*
 * A little room between the pinned buttons and the groups: both are icon
 * buttons, and without it the pinned mixer reads as one more group.
 */
.scoreview-pinned + :not(.scoreview-pinned) {
	margin-inline-start: 8px;
}

/*
 * The line between the sections of a group: frequent tools above, what is
 * set once below. A rule, not a heading - the names of the rows already say
 * what they are, and a heading would cost a row on a phone held sideways.
 */
.scoreview-group-divider {
	margin: 4px 8px;
	border: none;
	border-block-start: 1px solid var(--color-border);
}

/*
 * Vollbild in der kompakten Leiste vorn im Werkzeug-Streifen: der erste
 * Griff nach „Mehr", nicht der letzte hinter drei Gruppen. Auf breiter
 * Leiste steht es als letzter Knopf, dort, wo es immer stand.
 */
.scoreview-bar--compact .scoreview-fullscreen,
.scoreview-bar--compact .scoreview-close {
	order: -1;
}

/* A saved loop in the loop page: name above, range and audience below. */
.scoreview-saved-loop {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	inline-size: 100%;
	margin: 0 0 4px 0;
	padding: 6px 8px;
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large, 8px);
	background: var(--color-main-background);
	color: var(--color-main-text);
	text-align: start;
	cursor: pointer;
}

.scoreview-saved-loop:hover:not(:disabled) {
	background: var(--color-background-hover);
}

.scoreview-saved-loop:disabled {
	cursor: default;
	opacity: 0.5;
}

.scoreview-saved-loop--dimmed {
	opacity: 0.55;
}

.scoreview-saved-loop-name {
	font-weight: bold;
}

.scoreview-saved-loop-meta {
	color: var(--color-text-maxcontrast);
	font-size: 0.9em;
}
</style>
