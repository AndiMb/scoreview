<template>
	<!--
		Mixer und Notizen liegen als Karten UEBER dem Notenbild statt
		davor im Fluss: im Fluss kosteten sie Hoehe, sobald sie offen
		waren, und waren nur ganz oben zu sehen. Als Overlay kosten sie
		nichts, wenn sie zu sind, und bleiben erreichbar, wo immer man
		gerade liest.
	-->
	<div v-if="panels.anyShown || annotations.armedStamp || annotations.drawSpec || setlistNav.editorMode" class="scoreview-panels">
		<!--
			Ein Stempel wartet auf den Tipp ins Notenbild. Das
			Notizen-Panel ist dafuer zu - es laege sonst ueber den Noten,
			in die getippt werden soll -, und dieser Hinweis sagt, was
			der naechste Tipp tut und wie man es laesst.
		-->
		<!--
			The pen is down (E22): the notes panel is closed, so it
			does not lie over the music being drawn on, and this bar
			says how drawing ends.
		-->
		<ScorePanel v-if="annotations.drawSpec" class="scoreview-armed">
			<span>{{ t('Draw on the music with finger, pen or mouse.') }}</span>
			<NcButton :disabled="annotations.drawStrokes.length === 0" @click="annotations.undoStroke">
				<template #icon>
					<Undo :size="20" />
				</template>
				{{ t('Undo') }}
			</NcButton>
			<NcButton variant="primary" :disabled="annotations.drawStrokes.length === 0" @click="annotations.saveDrawing">
				<template #icon>
					<Check :size="20" />
				</template>
				{{ t('Done') }}
			</NcButton>
			<NcButton :aria-label="t('Cancel')" @click="annotations.cancelDrawing">
				<template #icon>
					<Close :size="20" />
				</template>
				{{ t('Cancel') }}
			</NcButton>
		</ScorePanel>
		<ScorePanel v-if="annotations.armedStamp" class="scoreview-armed">
			<span>{{ t('Tap the score where the {stamp} belongs.', { stamp: armedStampName }) }}</span>
			<NcButton :aria-label="t('Cancel')" @click="annotations.disarmStamp">
				<template #icon>
					<Close :size="20" />
				</template>
				{{ t('Cancel') }}
			</NcButton>
		</ScorePanel>
		<ScorePanel
			v-if="setlistNav.editorMode"
			:title="setlistNav.editorMode === 'new' ? t('New setlist') : t('Edit setlist')"
			@close="setlistNav.closeEditor()">
			<SetlistEditor
				:key="setlistNav.editorMode + ':' + (setlistNav.setlist?.etag ?? '')"
				:mode="setlistNav.editorMode"
				:setlist="setlistNav.setlist"
				:scoreFileId="view.standalonePage ? originFileId : view.activeFileId"
				:folderFileId="setlistNav.folderFileId"
				:withoutFilePicker="view.standalonePage"
				:noAdding="view.standalonePage && setlistNav.editorMode !== 'new'"
				@saved="setlistNav.applySaved"
				@cancel="setlistNav.closeEditor()" />
		</ScorePanel>
		<ScorePanel v-if="panels.shown('partChoice')" :title="t('My part')" @close="panels.close('partChoice')">
			<!--
				Der Anfangston kam ohne gewaehlte Stimme hierher:
				Er raet nicht, sondern sagt, was fehlt.
			-->
			<NcNoteCard v-if="startTone.needPart" type="info">
				{{ t('Choose your part first.') }}
			</NcNoteCard>
			<MyPartControls
				:parts="session.scoreParts"
				:partId="myPart.myPartId"
				@update:partId="onMyPartChanged" />
		</ScorePanel>
		<ScorePanel v-if="panels.shown('mixer')" :title="t('Mixer')" @close="panels.close('mixer')">
			<!-- What the pressed voice symbol stands for, in words. -->
			<p class="scoreview-mixer-mypart">
				{{ myPart.myPartId !== null ? t('My part: {name}', { name: view.myPartLabel }) : t('No part chosen') }}
			</p>
			<NcCheckboxRadioSwitch v-model="prefs.stereoMyPart" type="switch">
				{{ t('My voice on the right, the others on the left') }}
			</NcCheckboxRadioSwitch>
			<ScoreMixer
				:channels="playback.mixerChannels"
				:presetList="playback.presetList"
				:mix="mix.state"
				@level="({ channels, level }) => mix.setLevel(channels, level)"
				@mute="mix.toggleMute"
				@solo="mix.toggleSolo"
				@focus="onMixerFocus"
				@program="mix.changeProgram" />
		</ScorePanel>
		<ScorePanel v-if="panels.shown('annotations')" :title="t('Notes')" @close="panels.close('annotations')">
			<ScoreAnnotations
				:annotations="annotations.listed"
				:currentAnchor="readCurrentAnchor"
				:error="annotations.error"
				:isLeader="leaderRoles.isLeader"
				:parts="session.scoreParts"
				:armedStamp="annotations.armedStamp ? annotations.armedStamp.stamp : null"
				@create="annotations.create"
				@update="annotations.update"
				@delete="annotations.remove"
				@jumpTo="onAnnotationJumpToOwn"
				@armStamp="onArmStamp"
				@startDrawing="onStartDrawing" />
		</ScorePanel>
		<!--
			Eigene Aufnahmen und Intonation. Bleibt waehrend
			des Aufnehmens offen stehen - dort sitzt der Stopp-Knopf.
		-->
		<ScorePanel v-if="panels.shown('recording')" :title="t('Recording and intonation')" @close="panels.close('recording')">
			<RecordingPanel
				v-model:withAccompaniment="recorder.withAccompaniment"
				v-model:countIn="recorder.countIn"
				v-model:recordingVolume="recorder.recordingVolume"
				v-model:accompanimentVolume="recorder.accompanimentVolume"
				:recordingEnabled="features.recording"
				:intonationEnabled="features.intonation"
				:referenceHz="prefs.referencePitch"
				:hasRealPlayer="playback.hasRealPlayer"
				:recordings="recorder.recordings"
				:sharedRecordings="view.visibleSharedRecordings"
				:isLeader="leaderRoles.isLeader"
				:parts="session.scoreParts"
				:phase="recorder.phase"
				:elapsedMs="recorder.elapsedMs"
				:confirmReplace="recorder.confirmReplace"
				:maxPerScore="features.maxRecordingsPerScore"
				:pending="recorder.pending"
				:listening="recorder.listening"
				:error="recorder.error"
				:micError="microphone.error"
				:browserUrl="browserUrl"
				:live="intonation.live"
				:needPart="intonation.needPart || waitMode.needPart"
				:analysis="intonation.analysis"
				:analyzing="intonation.analyzing"
				:progress="intonation.progress"
				:intonationError="intonation.error"
				:waitMode="waitMode.active"
				:waiting="waitMode.waiting"
				:waitBlocked="recorder.phase !== 'idle' || follow.following"
				@start="recorder.start()"
				@stop="recorder.stop"
				@replace="recorder.answerReplace"
				@retry="recorder.retrySave"
				@discard="recorder.discardPending"
				@listen="onListenRecording"
				@stopListening="recorder.stopListening"
				@delete="recorder.remove"
				@share="({ recording, targetParts }) => recorder.share(recording, targetParts)"
				@analyze="onAnalyzeRecording"
				@toggleLive="onToggleLiveIntonation"
				@toggleWaitMode="onToggleWaitMode"
				@clearAnalysis="intonation.clearAnalysis"
				@jump="onPracticeJump" />
		</ScorePanel>
		<!-- The practice log (E20): only the singer's own time. -->
		<ScorePanel v-if="panels.shown('practiceLog')" :title="t('Practice log')" @close="panels.close('practiceLog')">
			<PracticeLogPanel
				:summary="practiceLog.summary"
				:goal="practiceLog.goal"
				:isLeader="leaderRoles.isLeader"
				:savingGoal="practiceLog.savingGoal"
				:error="practiceLog.error"
				@setGoal="practiceLog.setGoal" />
		</ScorePanel>
		<!-- Scored singing (E24): closing the card leaves the lane running. -->
		<ScorePanel v-if="panels.shown('sing')" :title="t('Scored singing')" @close="panels.close('sing')">
			<SingPanel
				:active="singScore.active"
				:level="singScore.level"
				:view="sing.view"
				:unitLabel="sing.unitLabel"
				:needPart="intonation.needPart"
				:micError="microphone.error"
				:browserUrl="browserUrl"
				:error="singScore.error || intonation.error"
				:lastRun="singScore.lastRun"
				:history="singScore.history"
				@toggle="onSingToggle"
				@update:level="singScore.setLevel"
				@update:view="sing.setView"
				@jump="onPracticeJump"
				@loop="onSingLoop"
				@clear="singScore.clearResults"
				@dismiss="singScore.dismissResult" />
		</ScorePanel>
		<!-- The tuner (B3): closing the card stops the microphone. -->
		<ScorePanel v-if="panels.shown('tuner')" :title="t('Tuner')" @close="view.closeTuner">
			<TunerPanel
				:reading="tuner.reading"
				:active="tuner.active"
				:error="tuner.error"
				:micError="microphone.error"
				:nameSystem="display.nameSystem"
				:concertKey="tunerKey"
				:referenceHz="prefs.referencePitch"
				@update:referenceHz="prefs.referencePitch = $event"
				@toggle="tuner.toggle" />
		</ScorePanel>
		<!--
			Der Aufklapper „Probe": die Leitungen - hier sammelt
			sich, was eine Probe organisiert, statt jedes Stueck davon
			als eigenen Knopf in die Leiste zu setzen.
		-->
		<ScorePanel v-if="panels.shown('rehearsal')" :title="t('Rehearsal')" @close="panels.close('rehearsal')">
			<LeaderPanel
				:leaders="leaderRoles.leaders"
				:isLeader="leaderRoles.isLeader"
				:candidates="leaderRoles.candidates"
				:error="leaderRoles.error"
				:followEnabled="features.followSession"
				:followActive="follow.active"
				:followMine="follow.mine"
				:followLeaderName="follow.leaderName"
				:followBusy="follow.busy"
				:followError="follow.error"
				:marks="scoreFacts.marks"
				:loopActive="loop.active"
				@appoint="leaderRoles.appoint"
				@revoke="leaderRoles.revoke"
				@search="leaderRoles.search"
				@followStart="follow.start"
				@followEnd="follow.end"
				@followPosition="sendFollowPosition()"
				@followMark="sendFollowMark"
				@followLoop="follow.sendLoop"
				@followTone="follow.sendTone" />
		</ScorePanel>
	</div>
</template>

<script>
import { getRootUrl } from '@nextcloud/router'
import { defineAsyncComponent } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import Check from 'vue-material-design-icons/Check.vue'
import Close from 'vue-material-design-icons/Close.vue'
import Undo from 'vue-material-design-icons/Undo.vue'
import MyPartControls from './MyPartControls.vue'
import ScoreAnnotations from './ScoreAnnotations.vue'
import ScoreMixer from './ScoreMixer.vue'
import ScorePanel from './ScorePanel.vue'
import { stampName } from './ScoreStamps.vue'
import SetlistEditor from './SetlistEditor.vue'
import TunerPanel from './TunerPanel.vue'
import { translate } from '../l10n.js'
import { browserFileUrl } from '../lib/micAccess.js'
import { keyAt } from '../lib/scoreFacts.js'
import { VIEWER_CONTEXT } from './viewerContext.js'

// The same async chunks as before the split (see ScoreViewer.vue): panels
// most visits never open, and that the offline page cannot fetch.
const LeaderPanel = defineAsyncComponent(() => import(/* webpackChunkName: "panel-leader" */ './LeaderPanel.vue'))
const PracticeLogPanel = defineAsyncComponent(() => import(/* webpackChunkName: "panel-practice-log" */ './PracticeLogPanel.vue'))
const RecordingPanel = defineAsyncComponent(() => import(/* webpackChunkName: "panel-recording" */ './RecordingPanel.vue'))
const SingPanel = defineAsyncComponent(() => import(/* webpackChunkName: "panel-sing" */ './SingPanel.vue'))

// What the template reads straight from the viewer's context (viewerContext.js).
const CONTEXT_KEYS = [
	'annotations',
	'display',
	'features',
	'follow',
	'intonation',
	'leaderRoles',
	'loop',
	'microphone',
	'mix',
	'myPart',
	'navigation',
	'panels',
	'performance',
	'playback',
	'practiceLog',
	'prefs',
	'recorder',
	'scoreFacts',
	'session',
	'setlistNav',
	'sing',
	'singScore',
	'startTone',
	'tuner',
	'view',
	'waitMode',
]

/**
 * The cards over the score (#67, from ScoreViewer.vue): mixer, notes,
 * recording, practice log, scored singing, tuner, rehearsal, the setlist
 * editor and the bars for a waiting stamp or the pen - with the handlers
 * that only these cards fire. They act on the viewer's composables through
 * its context (viewerContext.js), the same instances the bar uses.
 */
export default {
	name: 'ViewerPanels',

	components: {
		Check,
		Close,
		LeaderPanel,
		MyPartControls,
		NcButton,
		NcCheckboxRadioSwitch,
		NcNoteCard,
		PracticeLogPanel,
		RecordingPanel,
		ScoreAnnotations,
		ScoreMixer,
		ScorePanel,
		SetlistEditor,
		SingPanel,
		TunerPanel,
		Undo,
	},

	inject: {
		ctx: { from: VIEWER_CONTEXT },
	},

	props: {
		// The score the viewer was opened with (ScoreViewer's `fileid`): the
		// page of the mobile apps edits the setlist of that one.
		originFileId: {
			type: [Number, String],
			required: true,
		},
	},

	computed: {
		...Object.fromEntries(CONTEXT_KEYS.map((key) => [key, function() {
			return this.ctx[key]
		}])),

		armedStampName() {
			return this.annotations.armedStamp ? stampName(this.annotations.armedStamp.stamp) : ''
		},

		/** The key at the current position - it decides between F♯ and G♭. */
		tunerKey() {
			return keyAt(this.view.scoreFactsKeys, this.navigation.currentAnchor?.measureNumber ?? 1)?.concertKey ?? 0
		},

		/** „Im Browser oeffnen" (E8): Nextclouds Kurzlink auf diese Datei. */
		browserUrl() {
			return browserFileUrl(window.location.origin, getRootUrl(), this.view.activeFileId)
		},
	},

	methods: {
		// Single-argument wrapper, the call pattern tools/l10n.mjs looks for.
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		/**
		 * The voice symbol in the mixer - a part to remember, or a row
		 * without a part that only the mix knows (useMix.toggleFocus).
		 *
		 * @param {{key: string, partId: ?string, channels: number[]}} group
		 */
		onMixerFocus(group) {
			const partId = this.mix.toggleFocus(group)
			if (partId !== undefined) {
				this.onMyPartChanged(partId)
			}
		},

		/**
		 * Die Wahl aus dem Mixer uebernehmen. Wird sie zurueckgenommen, geht
		 * auch „nur meine Zeile" aus - sonst bliebe ein Notenbild zurueck, in
		 * dem alle Zeilen gedaempft sind und keine hervorgehoben.
		 *
		 * @param {?string} partId Stimme aus meta.parts, null = keine
		 */
		onMyPartChanged(partId) {
			this.myPart.set(partId)
			if (partId === null) {
				this.view.focusMyPart = false
			}
		},

		/**
		 * Die Intonation braucht die Noten der eigenen Stimme - ohne Ton hat
		 * das MIDI bis hierher niemand geladen.
		 */
		async ensureIntonationMidi() {
			await this.scoreFacts.ensureMidi(this.session.midiUrl, true)
		},

		async onToggleLiveIntonation() {
			await this.ensureIntonationMidi()
			await this.intonation.toggleLive()
			if (this.intonation.needPart) {
				this.view.openVoiceSelection()
			}
		},

		async onToggleWaitMode() {
			await this.ensureIntonationMidi()
			await this.waitMode.toggle()
			if (this.waitMode.needPart) {
				this.view.openVoiceSelection()
			}
		},

		async onAnalyzeRecording(recording) {
			await this.ensureIntonationMidi()
			await this.intonation.analyze(recording === 'pending' ? { id: 'pending', ...this.recorder.pending.meta } : recording)
			if (this.intonation.needPart) {
				this.view.openVoiceSelection()
			}
		},

		/**
		 * Abhoeren ist eigenes Navigieren (Sprung an den Anfang der
		 * Aufnahme) - das loest das Folgen einer Leitung.
		 *
		 * @param {object|'pending'} recording
		 */
		onListenRecording(recording) {
			this.view.followNavigation('seek')
			this.recorder.listen(recording)
		},

		async onSingToggle() {
			await this.ensureIntonationMidi()
			await this.singScore.toggle()
			if (this.intonation.needPart) {
				this.view.openVoiceSelection()
			}
		},

		/**
		 * A loop over one measure to practise, from the result.
		 *
		 * @param {number} measure
		 */
		onSingLoop(measure) {
			this.view.applySavedLoop({ from: measure, to: measure })
		},

		/**
		 * Aus der Problemliste an die Stelle springen.
		 *
		 * @param {number} onMs Partiturzeit der Note
		 */
		onPracticeJump(onMs) {
			if (this.performance.can('seek') && this.session.clock) {
				this.view.followNavigation('seek')
				this.session.clock.seek(onMs)
			}
		},

		/**
		 * Ein Stempel aus der Palette wartet auf den Tipp ins Notenbild. Das
		 * Panel geht dafuer zu: Es laege ueber genau den Noten, in die jetzt
		 * getippt werden soll.
		 *
		 * @param {{stamp:string, visibility:string, targetParts:?Array}} spec
		 */
		onArmStamp(spec) {
			if (!this.performance.can('annotate')) {
				return
			}
			this.annotations.armStamp(spec)
			this.panels.close('annotations')
		},

		/**
		 * Takes up the pen (E22). Drawing happens on pages: in the band and
		 * the lyrics view the pages are not there to draw on, so the view
		 * switches to pages - and stays there, like any other choice of the
		 * view; the drawings show in the band all the same.
		 *
		 * @param {{visibility:string, targetParts:?Array}} spec
		 */
		onStartDrawing(spec) {
			if (!this.performance.can('annotate')) {
				return
			}
			if (this.display.activeLayout !== 'pages') {
				this.prefs.layout = 'pages'
			}
			this.annotations.startDrawing(spec)
			this.panels.close('annotations')
		},

		/**
		 * Die Position fuer eine neue Notiz, erst im Moment des Klicks gelesen
		 * (siehe ScoreAnnotations.vue, Prop `currentAnchor`).
		 *
		 * @return {?object}
		 */
		readCurrentAnchor() {
			return this.navigation.currentAnchor
		},

		sendFollowPosition() {
			return this.follow.sendPosition(null)
		},

		/**
		 * „Alle zu C": Die Leitung springt selbst mit - sie soll sehen, was
		 * sie angesagt hat.
		 *
		 * @param {{measure:number, text:string}} mark
		 */
		sendFollowMark(mark) {
			this.view.revealJump()
			this.navigation.jumpToMeasure(mark.measure)
			return this.follow.sendPosition({ measure: mark.measure, mark: mark.text })
		},

		/**
		 * Sprung zu einer Notiz aus der Liste - eigenes Navigieren.
		 *
		 * @param {object} annotation
		 */
		onAnnotationJumpToOwn(annotation) {
			this.view.followNavigation('annotationJump')
			this.annotations.jumpTo(annotation)
		},
	},
}
</script>

<style scoped>
.scoreview-mixer-mypart {
	margin: 0 0 4px;
	font-weight: bold;
}

.scoreview-panels {
	position: absolute;
	top: 0;
	inset-inline-end: 0;
	bottom: 0;
	/*
	 * Muss über dem Notenbild liegen: .score-page-svg trägt z-index: 1 und
	 * .score-page-marker z-index: 2 (ScorePage.vue), und weil weder
	 * .scoreview-pages noch .score-page einen eigenen Stacking-Context
	 * eröffnen, konkurrieren die direkt mit diesem Element. Ohne einen klar
	 * höheren Wert malt das SVG durch die Panels hindurch (beim ersten
	 * Nachmessen genau so beobachtet: der Mixer wirkte durchsichtig).
	 */
	z-index: 20;
	width: min(420px, 100%);
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 8px;
	box-sizing: border-box;
	overflow-y: auto;
	/* An own scroll container - see .scoreview-viewer. */
	touch-action: pan-x pan-y;
	/* Nur die Karten selbst fangen Klicks - der Zwischenraum gehört weiter
	   dem Notenbild darunter (Klick auf eine Note springt dorthin). */
	pointer-events: none;
}
</style>
