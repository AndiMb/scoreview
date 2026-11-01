<template>
	<!--
		The highlight and note colours hang as CSS custom properties on the
		root: the overlays of every page (cursor, own-part band, markers)
		inherit them through the cascade. The notation itself sits in a
		document of its own (ScorePage.vue, scorePageFrame.js), where nothing
		inherits; it receives the same object as `svgVars`.
	-->
	<div
		ref="root"
		class="scoreview-viewer"
		:class="{ 'scoreview-viewer--page-fullscreen': zoom.pageFullscreen }"
		:style="prefs.highlightStyle">
		<!--
			Die Setliste steht ueber allem, auch ueber „Wird konvertiert…" und
			einem Fehler: Im Konzert muss es auch an einem Stueck vorbei
			weitergehen, das gerade nicht geht.
		-->
		<SetlistBar
			:active="setlistNav.active"
			:title="setlistTitle"
			:entries="setlistNav.entries"
			:index="setlistNav.index"
			:position="setlistNav.position"
			:canEdit="setlistCanEdit"
			:canNavigate="performance.can('nextPiece')"
			:canManage="performance.can('settings')"
			:offers="setlistNav.offers"
			:offerDismissed="setlistNav.offerDismissed"
			@previous="setlistNav.previous"
			@next="setlistNav.next"
			@goTo="setlistNav.goTo"
			@edit="setlistNav.toggleEditor('edit')"
			@close="setlistNav.close"
			@accept="setlistNav.acceptOffer"
			@dismiss="setlistNav.offerDismissed = true" />
		<NcNoteCard v-if="setlistNav.error" type="error" class="scoreview-hint">
			{{ setlistNav.error }}
		</NcNoteCard>
		<div
			v-if="conversion.state === 'converting' || conversion.state === 'loading' || conversion.state === 'error'"
			class="scoreview-status-host">
			<ScoreStatus
				:state="conversion.state"
				:clientProgress="conversion.clientProgress"
				:longWait="conversion.langeWartezeit"
				:errorText="conversion.errorText"
				:errorCode="conversion.errorCode"
				:errorMessage="conversion.errorMessage" />
			<!--
				Without a bar the way out floats above the status: it costs no
				height, and the status keeps its top padding free for it.
			-->
			<NcButton
				v-if="closable"
				class="scoreview-close scoreview-close--status"
				variant="tertiary"
				:aria-label="t('Close')"
				:title="t('Close')"
				@click="$emit('close')">
				<template #icon>
					<Close :size="20" />
				</template>
			</NcButton>
		</div>
		<template v-else>
			<!--
				Die Leiste (ViewerBar.vue): Transport, angeheftete Werkzeuge und
				die drei Gruppen, an den Composables des Viewers (viewerContext.js).
			-->
			<ViewerBar :closable="closable" @close="$emit('close')" @reconvert="reconvertScore" />
			<div class="scoreview-body" :class="{ 'scoreview-body--sing': singScore.active && sing.view === 'band' }">
				<!--
					„Folgt mir": wer leitet, ob dieses Geraet folgt, ob die
					Verbindung steht - ueber den Noten, damit es keine Hoehe kostet
					und im Aufführungsmodus sichtbar bleibt.
				-->
				<FollowBadge
					v-if="follow.active"
					class="scoreview-follow"
					:leaderName="follow.leaderName"
					:mine="follow.mine"
					:detached="!follow.following"
					:offline="!follow.connected"
					@resume="follow.resume" />
				<!--
					Die Leitung ist zum naechsten Stueck weiter, dieses Geraet folgt
					gerade nicht (D5): nur ein Hinweis, mitgehen per Tipp.
				-->
				<NcNoteCard v-if="leaderMovedTo" type="info" class="scoreview-follow-moved">
					{{ t('The leader has moved on to another piece.') }}
					<NcButton variant="primary" @click="follow.resume">
						{{ t('Go there') }}
					</NcButton>
				</NcNoteCard>
				<!--
					Manuelles Scrollen wird an der GESTE erkannt, nicht an
					scroll-Ereignissen (Begruendung ausfuehrlich in
					useAutoScroll.js): Mobile Browser blenden ihre
					Adressleiste beim Scrollen ein und aus und erzeugen dabei
					scroll-Ereignisse, die von keinem Finger stammen - die
					fruehere Zeitfenster-Heuristik deutete daraufhin das
					eigene Nachfuehren als Nutzereingriff. Pointer- UND
					Touch-Ereignisse, weil eine Pinch-Geste (die
					preventDefault ruft) den Pointer-Strom abbrechen kann.
					`scrollend` kennt nicht jeder Browser; wo es fehlt, feuert
					es nie und die Frist laeuft wie zuvor ab dem Loslassen. Es
					feuert auch nach dem eigenen Nachfuehren - das zaehlt nicht
					als Eingriff (useAutoScroll.js#onScrollEnd).
				-->
				<!--
					Autoscroll switched off (issue #12) and the playing position
					gone from the screen: one tap back to it. Outside the
					scrolling element, so it stays put while the score moves.
				-->
				<NcButton
					v-if="showBackToCursor"
					class="scoreview-back-to-cursor"
					variant="primary"
					@click="revealCursor">
					<template #icon>
						<CrosshairsGps :size="20" />
					</template>
					{{ t('Back to the playing position') }}
				</NcButton>
				<div
					ref="scroll"
					class="scoreview-scroll"
					:class="{ 'scoreview-scroll--band': display.activeLayout === 'band' }"
					@pointerdown.passive="autoScroller.onUserGestureStart"
					@pointerup.passive="autoScroller.onUserGestureEnd"
					@pointercancel.passive="autoScroller.onUserGestureEnd"
					@touchstart.passive="autoScroller.onUserGestureStart"
					@touchend.passive="autoScroller.onUserGestureEnd"
					@touchcancel.passive="autoScroller.onUserGestureEnd"
					@scrollend.passive="onViewerScrollEnd"
					@wheel="onViewerWheel">
					<NcNoteCard v-if="playback.soundFontLoading" type="info" class="scoreview-hint">
						{{ t('Loading sound ({percent}%)…', { percent: playback.soundFontLoadPercent }) }}
						<NcButton @click="playback.skipSoundFontLoad">
							{{ t('Continue without sound') }}
						</NcButton>
					</NcNoteCard>
					<NcNoteCard v-else-if="!playback.hasRealPlayer" type="warning" class="scoreview-hint">
						{{ t('No sound: {reason}', { reason: playback.playbackError || t('Playback is not available.') }) }}
						{{ t('The score cursor keeps running independently of this.') }}
					</NcNoteCard>
					<!--
						Pinch-Zoom: eigene, zweifingrige Geste statt der nativen
						Browser-Seiten-Zoom (die waere fuer die ganze
						Nextcloud-Oberflaeche, nicht nur die Partitur) - siehe
						onTouchMove(), das den Browser-Zoom waehrend der Geste bewusst
						unterdrueckt (preventDefault). Einfingriges Scrollen bleibt
						unangetastet (kein preventDefault dafuer), "Wischen zum
						Blaettern" ist deshalb bewusst NICHT als zusaetzliche
						Horizontal-Geste umgesetzt: das vertikale Scrollen deckt das
						Blaettern in diesem fortlaufenden Einspaltenlayout bereits ab,
						eine eigene Wischgeste haette zudem mit Nextcloud Viewers
						eigener Wisch-zum-naechsten-Datei-Geste auf Mobilgeraeten
						kollidieren koennen.
					-->
					<!--
						Angebot auf Handybreite (D9): einmal, die Antwort wird
						gemerkt (bandOffered).
					-->
					<NcNoteCard v-if="variant.status === 'loading'" type="info" class="scoreview-hint">
						{{ t('Engraving the chosen part or page format …') }}
					</NcNoteCard>
					<NcNoteCard v-else-if="variant.status === 'error'" type="warning" class="scoreview-hint">
						{{ variant.errorText }}
						<div class="scoreview-hint-actions">
							<NcButton @click="variant.retry()">
								{{ t('Try again') }}
							</NcButton>
							<NcButton @click="variant.dismissError()">
								{{ t('Dismiss') }}
							</NcButton>
						</div>
					</NcNoteCard>
					<NcNoteCard v-if="variant.offerPhonePages" type="info" class="scoreview-hint">
						{{ t('This score can be engraved on pages the size of a phone screen, with larger notes.') }}
						<div class="scoreview-hint-actions">
							<NcButton variant="primary" @click="variant.answerPhoneOffer(true)">
								{{ t('Use phone pages') }}
							</NcButton>
							<NcButton @click="variant.answerPhoneOffer(false)">
								{{ t('No, thanks') }}
							</NcButton>
						</div>
					</NcNoteCard>
					<NcNoteCard v-if="offerBand" type="info" class="scoreview-hint">
						{{ t('On a phone, the system band shows the staves side by side in landscape.') }}
						<div class="scoreview-hint-actions">
							<NcButton variant="primary" @click="answerBandOffer(true)">
								{{ t('Try the system band') }}
							</NcButton>
							<NcButton @click="answerBandOffer(false)">
								{{ t('No, thanks') }}
							</NcButton>
						</div>
					</NcNoteCard>
					<!-- Die gewaehlte Darstellung geht nicht (N3): sagen, warum. -->
					<NcNoteCard v-if="prefs.layout !== display.activeLayout" type="info" class="scoreview-hint">
						{{ t('Lyrics view is not available: {reason} Showing the pages instead.', { reason: display.lyricsUnavailable }) }}
					</NcNoteCard>
					<LyricsView
						v-if="display.activeLayout === 'lyrics' && session.timeline"
						ref="lyrics"
						:follow="followCursor"
						:syllables="session.pictureMeta?.lyricSyllables ?? []"
						:staves="myStaves"
						:partNames="lyricsPartNames"
						:timeline="session.timeline"
						:measureRectsByPage="session.systemRectsByPage"
						:focusKeys="loopFocusKeys"
						:readTimeMs="readDisplayTimeMs"
						:subscribeFrame="session.onFrame"
						:canSeek="performance.can('seek')"
						@seek="onLyricsSeek"
						@loop="onLyricsLoop"
						@cursorVisible="layoutCursorShown = $event" />
					<!--
						The cursor, the sounding element and the intonation
						needle change with every note. Read in the template of the
						viewer, each change re-rendered all of it - toolbar,
						panels, a hundred t() calls. LiveValue reads them itself
						(readLive()), so a note change re-renders only the band or
						the page list.
					-->
					<LiveValue
						v-else-if="display.activeLayout === 'band'"
						v-slot="{ value: live }"
						:get="readLive">
						<SystemBand
							ref="band"
							:pageUrls="session.pageUrls"
							:systemRectsByPage="session.systemRectsByPage"
							:pageProps="sharedPageProps"
							:loopRects="loopMeasureRects"
							:loopDimRectsByPage="loopDimRectsByPage"
							:cursorRect="live.cursorRect"
							:cursorElid="live.cursorElid"
							:needle="live.needle"
							:liveNoteMarks="live.liveNoteMarks"
							:follow="followCursor"
							:forced="session.cursorForced"
							:zoom="bandZoom.zoom"
							@touchstart.passive="bandZoom.onTouchStart"
							@touchmove.passive="bandZoom.onTouchMove"
							@touchend.passive="bandZoom.onTouchEnd"
							@touchcancel.passive="bandZoom.onTouchEnd"
							@noteClick="onNoteClick"
							@markerClick="onMarkerClick"
							@indexed="onPageIndexed"
							@cursorVisible="layoutCursorShown = $event" />
					</LiveValue>
					<LiveValue
						v-else
						v-slot="{ value: live }"
						:get="readLive">
						<div
							class="scoreview-pages"
							:class="spreadClasses"
							@touchstart.passive="zoom.onTouchStart"
							@touchmove.passive="zoom.onTouchMove"
							@touchend.passive="zoom.onTouchEnd">
							<ScorePage
								v-for="(url, i) in session.pageUrls"
								:key="url"
								:ref="autoScroller.pageRef(i)"
								:svgUrl="url"
								:pageIndex="i"
								v-bind="sharedPageProps"
								:cursorRect="onCursorPage(i, live.cursorRect, live.cursorRect)"
								:cursorElid="onCursorPage(i, live.cursorElid, live.cursorRect)"
								:zoom="zoom.zoom"
								:drawMode="annotations.drawSpec !== null"
								:pendingStrokes="annotations.drawStrokes"
								:systemRects="session.systemRectsByPage[i] ?? NO_RECTS"
								:loopDimRects="loopDimRectsByPage[i] ?? NO_RECTS"
								:liveNoteMarks="onCursorPage(i, live.liveNoteMarks, live.cursorRect) ?? NO_MARKS"
								:needle="onCursorPage(i, live.needle, live.cursorRect)"
								@indexed="onPageIndexed"
								@noteClick="onNoteClick"
								@markerClick="onMarkerClick"
								@staffMapping="onStaffMapping"
								@stroke="annotations.addStroke"
								@loaded="zoom.onPageLoaded" />
						</div>
					</LiveValue>
				</div>
				<!--
					The singing lane (E24): under the score as a band, or over it
					as a stage. The score stays mounted underneath - switching back
					costs no new page load.
				-->
				<SingLane
					v-if="singScore.active"
					:mode="sing.view"
					:readTimeMs="readDisplayTimeMs"
					:subscribeFrame="session.onFrame"
					:tempoFactor="playback.tempo"
					:notes="singLaneNotes"
					:results="singScore.results"
					:readFrames="singScore.framesForLane"
					:syllablesFor="sing.view === 'stage' && sing.lyricsBlocks.length > 0 ? sing.syllablesFor : null"
					:livePct="singScore.livePct"
					:levelLabel="sing.levelLabel"
					:unitLabel="sing.unitLabel"
					:liveOnly="singScore.run?.state === 'liveOnly'" />
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
							:scoreFileId="standalonePage ? fileid : activeFileId"
							:folderFileId="setlistNav.folderFileId"
							:withoutFilePicker="standalonePage"
							:noAdding="standalonePage && setlistNav.editorMode !== 'new'"
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
							{{ myPart.myPartId !== null ? t('My part: {name}', { name: myPartLabel }) : t('No part chosen') }}
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
							:sharedRecordings="visibleSharedRecordings"
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
					<ScorePanel v-if="panels.shown('tuner')" :title="t('Tuner')" @close="closeTuner">
						<TunerPanel
							:reading="tuner.reading"
							:active="tuner.active"
							:error="tuner.error"
							:micError="microphone.error"
							:nameSystem="tunerNameSystem"
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
			</div>
		</template>
	</div>
</template>

<script>
import { getLanguage } from '@nextcloud/l10n'
import { generateUrl, getRootUrl } from '@nextcloud/router'
import { computed, defineAsyncComponent, getCurrentInstance, inject, nextTick, provide, reactive, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import Check from 'vue-material-design-icons/Check.vue'
import Close from 'vue-material-design-icons/Close.vue'
import CrosshairsGps from 'vue-material-design-icons/CrosshairsGps.vue'
import Undo from 'vue-material-design-icons/Undo.vue'
import FollowBadge from './FollowBadge.vue'
import LiveValue from './LiveValue.vue'
import LyricsView from './LyricsView.vue'
import MyPartControls from './MyPartControls.vue'
import ScoreAnnotations from './ScoreAnnotations.vue'
import ScoreMixer from './ScoreMixer.vue'
import ScorePage from './ScorePage.vue'
import ScorePanel from './ScorePanel.vue'
import { stampName } from './ScoreStamps.vue'
import ScoreStatus from './ScoreStatus.vue'
import SetlistBar from './SetlistBar.vue'
import SetlistEditor from './SetlistEditor.vue'
import SystemBand from './SystemBand.vue'
import TunerPanel from './TunerPanel.vue'
import ViewerBar from './ViewerBar.vue'
import { forward } from '../composables/forward.js'
import { useAnnotations } from '../composables/useAnnotations.js'
import { useAutoScroll } from '../composables/useAutoScroll.js'
import { useBandZoom } from '../composables/useBandZoom.js'
import { useBarLayout } from '../composables/useBarLayout.js'
import { useConversionStatus } from '../composables/useConversionStatus.js'
import { useFollowSession } from '../composables/useFollowSession.js'
import { useFullscreenContainer } from '../composables/useFullscreenContainer.js'
import { useIntonation } from '../composables/useIntonation.js'
import { useLeaders } from '../composables/useLeaders.js'
import { useLoop } from '../composables/useLoop.js'
import { useMeasureNavigation } from '../composables/useMeasureNavigation.js'
import { useMediaSession } from '../composables/useMediaSession.js'
import { useMetronome } from '../composables/useMetronome.js'
import { useMicrophone } from '../composables/useMicrophone.js'
import { useMix } from '../composables/useMix.js'
import { useMyPart } from '../composables/useMyPart.js'
import { useMyPartSound } from '../composables/useMyPartSound.js'
import { useOffline } from '../composables/useOffline.js'
import { usePaging } from '../composables/usePaging.js'
import { usePerformanceMode } from '../composables/usePerformanceMode.js'
import { usePlayback } from '../composables/usePlayback.js'
import { usePracticeExport } from '../composables/usePracticeExport.js'
import { usePracticeLog } from '../composables/usePracticeLog.js'
import { useRecorder } from '../composables/useRecorder.js'
import { useScoreDisplay } from '../composables/useScoreDisplay.js'
import { useScoreFacts } from '../composables/useScoreFacts.js'
import { NO_RECTS, useScoreSession } from '../composables/useScoreSession.js'
import { useScoreVariant } from '../composables/useScoreVariant.js'
import { useSetlist } from '../composables/useSetlist.js'
import { useSingScore } from '../composables/useSingScore.js'
import { useSingView } from '../composables/useSingView.js'
import { useSpeedTrainer } from '../composables/useSpeedTrainer.js'
import { useStartTone } from '../composables/useStartTone.js'
import { useTuner } from '../composables/useTuner.js'
import { PANELS, useViewerPanels } from '../composables/useViewerPanels.js'
import { useViewerPreferences } from '../composables/useViewerPreferences.js'
import { useWaitMode } from '../composables/useWaitMode.js'
import { useWakeLock } from '../composables/useWakeLock.js'
import { useZoom } from '../composables/useZoom.js'
import nodeText from '../directives/nodeText.js'
import { readInitialState } from '../initialState.js'
import { translate } from '../l10n.js'
import { capabilitiesOf } from '../lib/capabilities.js'
import { normalizeFeatures } from '../lib/featureFlags.js'
import { resolveKey } from '../lib/keyMap.js'
import { loopDimRects, loopMeasureRects, loopSystemKeys } from '../lib/loopFocus.js'
import { staffPartNames } from '../lib/lyricsLayout.js'
import { browserFileUrl } from '../lib/micAccess.js'
import { nameOf } from '../lib/noteNames.js'
import { noteNameSystem } from '../lib/noteNameSystem.js'
import { spellingMap } from '../lib/noteSpellingIndex.js'
import { channelsOfPart } from '../lib/panLayout.js'
import { keyAt, keyByElid } from '../lib/scoreFacts.js'
import {
	findElementAtPoint,
	findNearestOccurrenceTimeMs,
	resolveMeasurePosition,
} from '../lib/scoreLayout.js'
import { revealsCursor } from '../lib/scrollPlan.js'
import { visibleSharedRecordings } from '../lib/sharedRecordings.js'
import { createStaffMappingReports } from '../lib/staffMappingReports.js'
import { VIEWER_CONTEXT } from './viewerContext.js'

// MuseScores eigene Vorgabe für Partituren ohne Tempoangabe (docs/architecture.md
// M8: metadata.tempo kann 0 sein, z.B. bei repeat-test.mscz) - dient nur als
// Bezugswert für die BPM-Anzeige/-Eingabe, gekennzeichnet über tempoGuessed.
const DEFAULT_TEMPO_BPM = 120

// The live intonation marks of every page off the cursor: one empty list, so
// that those pages see no changed prop while someone sings (B3).
const NO_MARKS = Object.freeze([])

/*
 * Panels that only open online and on request load as chunks of their own
 * (webpack's async chunks, public path from publicPath.js): most visits never
 * open them, and in the mobile apps' page (standalone.js, one file otherwise)
 * they were a large part of what every visit downloaded. Kept static: what
 * the offline page (E14) can show - lyrics, notes, the tuner. Its service
 * worker caches only what the page has loaded before, so a chunk first asked
 * for offline would not be there.
 */
const LeaderPanel = defineAsyncComponent(() => import(/* webpackChunkName: "panel-leader" */ './LeaderPanel.vue'))
const PracticeLogPanel = defineAsyncComponent(() => import(/* webpackChunkName: "panel-practice-log" */ './PracticeLogPanel.vue'))
const RecordingPanel = defineAsyncComponent(() => import(/* webpackChunkName: "panel-recording" */ './RecordingPanel.vue'))
const SingLane = defineAsyncComponent(() => import(/* webpackChunkName: "panel-sing" */ './SingLane.vue'))
const SingPanel = defineAsyncComponent(() => import(/* webpackChunkName: "panel-sing" */ './SingPanel.vue'))
export default {
	name: 'ScoreViewer',

	directives: { nodeText },

	components: {
		FollowBadge,
		LeaderPanel,
		LiveValue,
		MyPartControls,
		PracticeLogPanel,
		RecordingPanel,
		SingLane,
		SingPanel,
		ScorePage,
		ScorePanel,
		ScoreMixer,
		ScoreAnnotations,
		ScoreStatus,
		NcButton,
		NcNoteCard,
		NcCheckboxRadioSwitch,
		Check,
		Close,
		Undo,
		CrosshairsGps,
		SetlistBar,
		SetlistEditor,
		LyricsView,
		SystemBand,
		TunerPanel,
		ViewerBar,
	},

	// The scrolling container for the pages' load/unload observers
	// (ScorePage.vue).
	provide() {
		return {
			scoreviewScrollRoot: () => this.$refs.scroll ?? null,
		}
	},

	props: {
		// Von OCA.Viewer übergeben (siehe registerHandler in src/viewer.js).
		// Die Partitur, mit der der Viewer oeffnet - welche gerade offen ist,
		// steht in `activeFileId` (Setliste, siehe setup()).
		fileid: {
			type: [Number, String],
			required: true,
		},

		// Geoeffnet ueber eine Setlisten-Datei (Weg 1, E11): ihre fileId und,
		// wenn schon gelesen, ihr Inhalt (src/viewer.js).
		setlistId: {
			type: [Number, String],
			default: null,
		},

		setlistData: {
			type: Object,
			default: null,
		},

		// Laeuft auf der Offline-Seite (E14): Was den Server braucht, faellt
		// weg - ein Kontextwert fuer barGroups/interactionPolicy, keine Weiche
		// im Viewer-Code.
		offline: {
			type: Boolean,
			default: false,
		},

		// The host can close but shows no cross of its own (the page of the
		// mobile apps): the viewer then shows one and fires `close`. How to
		// close - app bridge or history - stays the host's business.
		closable: {
			type: Boolean,
			default: false,
		},
	},

	/**
	 * Feuert einmal, sobald hier wirklich etwas zu sehen ist - Notenbild ODER
	 * Fehlermeldung. Der einzige Abnehmer ist heute die eigenstaendige Seite
	 * (StandaloneFrame.vue): Die mobile App blendet ihren Ladebildschirm erst
	 * darauf hin aus. Vorzeitig gemeldet laege er bei laufender Konvertierung
	 * minutenlang ueber einem leeren Viewer, und nach zehn Sekunden meldete
	 * die App zusaetzlich einen Timeout.
	 *
	 * Fuer die beiden anderen Einstiege folgenlos - ein Ereignis, das niemand
	 * abhoert, kostet nichts.
	 */
	emits: ['ready', 'pieceChange', 'close'],

	/**
	 * Die Bereiche des Viewers als Composables, hier verdrahtet.
	 *
	 * Vue 3 lays the setup() return out on the instance and unwraps its
	 * refs. The composables come back as namespaces (see `shared` at the
	 * end): the options API below reads `this.session.timeline` and writes
	 * `this.focusMyPart = x`, while the composables use the same refs
	 * directly. Der Zustand der offenen Partitur, den fast alle teilen,
	 * liegt in useScoreSession.js.
	 *
	 * @param props
	 */
	setup(props) {
		// The order of the composables below is load-bearing: each takes
		// getters onto the ones built before it. Where two need each other,
		// one side gets a forward() (composables/forward.js) and the
		// partner binds it once it exists:
		//   spreadNow       - zoom and paging -> what the picture shows (useScoreDisplay)
		//   onLoopWrap      - loop -> speed trainer
		//   isFollowing     - performance mode -> "Folgt mir"
		//   noteNavigation  - measure navigation -> "Folgt mir"
		// Until bound, each answers with its fallback; all are bound before
		// the first render.
		// Die gerade offene Partitur. Anfangs die aus `fileid`; eine Setliste
		// wechselt sie IM Viewer, statt ihn neu einhaengen zu lassen - nur so
		// bleiben Aufführungsmodus, Dunkelmodus, Zoom und der geladene
		// SoundFont ueber den Stueckwechsel erhalten. Alles, was an der
		// Datei haengt, liest deshalb hier, nicht an der Prop.
		const activeFileId = ref(props.fileid)
		const session = useScoreSession()
		const { timeline, measuresTimeline, systemRectsByPage, currentEtag, durationMs, clock, scoreMeta } = session

		// `onReady` wartet einen Tick: load() misst am Ende die Seitenbreite
		// fuer das Zoom-Preset, die Seiten muessen dafuer schon gerendert sein.
		const conversion = useConversionStatus({
			fileId: () => activeFileId.value,
			onReady: async (body) => {
				await nextTick()
				await session.load(body)
			},
		})

		// rootEl/scrollEl als Funktionen statt als Refs: die Elemente existieren
		// erst nach dem Einhaengen, das Scroll-Element sogar erst im Zustand
		// "ready" (v-if im Template) - beim Anlegen der Composables sind beide
		// Template-Refs noch leer.
		const root = ref(null)
		const scroll = ref(null)
		const rootElement = () => root.value
		const scrollElement = () => scroll.value
		// Two pages side by side (A2): the rule needs the active layout, which
		// needs the capabilities of the picture - known further down. The
		// width comes from the zoom's own ResizeObserver.
		const pagesWidthPx = ref(0)
		const spreadNow = forward(() => false)
		// The system band's own zoom (D in the band design): a factor on its
		// default size, not a page width.
		const bandZoom = useBandZoom({ el: () => scroll.value?.querySelector('.scoreview-band') ?? null })
		const zoomApi = useZoom({
			rootEl: rootElement,
			scrollEl: scrollElement,
			spread: spreadNow.call,
			onWidth: (px) => {
				pagesWidthPx.value = px
			},
		})
		// Anzeigeeinstellungen der Nutzerin (Farbe/Form der Hervorhebung).
		// Kein Bezug zur Partitur - deshalb ohne Abhaengigkeiten und ohne
		// Ruecksetzen beim Dateiwechsel.
		const preferences = useViewerPreferences()
		const autoScroll = useAutoScroll({ scrollEl: scrollElement, enabled: () => preferences.autoScroll.value })
		const playback = usePlayback({ clock, durationMs, defaultTempoBpm: DEFAULT_TEMPO_BPM })
		// The playback sounds at the reference the tuner and intonation hear
		// against (lib/referencePitch.js).
		watch(preferences.referencePitch, (a4) => playback.setReferencePitch(a4), { immediate: true })
		// Tonarten, Taktarten und Studierbuchstaben - fuer Metronom, Anfangston
		// UND Taktnavigation aus demselben gelesenen MIDI. Before the
		// metronome, which counts in the meter of each measure.
		const scoreFacts = useScoreFacts({
			midiData: () => playback.midiData.value,
			meta: () => scoreMeta.value,
			measuresTimeline: () => measuresTimeline.value,
		})
		const metronome = useMetronome({
			measuresTimeline: () => measuresTimeline.value,
			durationMs: () => durationMs.value,
			meterAt: (index) => scoreFacts.meters.value[index] ?? null,
			baseTempoBpm: () => playback.baseTempoBpm.value,
			effectiveTempoBpm: () => playback.effectiveTempoBpm.value,
			tempoFactor: () => playback.tempo.value,
			isPlaying: () => playback.isPlaying.value,
			play: () => clock.value?.play(),
			// Der Klick geht durch dieselbe Pufferkette wie die Musik, wo es
			// eine gibt - sonst waeren es auf Android zwei unabhaengig
			// gepufferte Ausgabe-Streams (siehe lib/metronomeClick.js).
			audioContext: playback.getAudioContext,
			holdAudio: playback.holdAudio,
		})

		// „Meine Stimme" je Partitur, serverseitig gemerkt - geladen im
		// fileid-Watcher, nicht in reset(): „Neu konvertieren" setzt den
		// Viewer zurueck, behaelt aber dieselbe Datei und damit dieselbe Wahl.
		const myPart = useMyPart({ fileId: () => activeFileId.value })

		// Die Transposition, die gerade klingt (H6): die eigene der Partitur,
		// solange keine Leitung eine fuer alle setzt (P7, „Folgt mir"). Sie
		// geht an den Synthesizer; Anfangston und Intonation lesen denselben
		// Wert, damit Name und Sollton zum Klang passen.
		const sessionTranspose = ref(null)
		const effectiveTranspose = computed(() => sessionTranspose.value ?? myPart.practice.value.transpose)
		watch(effectiveTranspose, (n) => playback.setTranspose(n), { immediate: true })

		// The display variant (E19): a part, phone pages, concert pitch,
		// notation transposed with the sound. Which one is wanted comes from
		// here; where it is made, from useConversionStatus.
		// reactive(): the template and the options API read its refs unwrapped.
		const variant = reactive(useScoreVariant({
			fileId: () => activeFileId.value,
			meta: () => scoreMeta.value,
			myPartId: () => myPart.myPartId.value,
			practice: () => myPart.practice.value,
			setPractice: myPart.setPractice,
			transpose: () => effectiveTranspose.value,
			supported: () => conversion.variantsSupported.value,
			requestVariant: conversion.requestVariant,
			applyPicture: session.applyPicture,
			shownKey: () => session.variantKey.value,
		}))

		// Die Leitungen der Partitur. Wie „Meine Stimme" im
		// fileid-Watcher geladen: Sie haengen an der Datei, nicht an ihrer
		// Konvertierung, und „Neu konvertieren" aendert an ihnen nichts.
		const leaders = useLeaders({ fileId: () => activeFileId.value })

		// Nach „Meine Stimme" und den Leitungen: Welche Stimmnotiz jemand
		// sieht, haengt an beidem (lib/annotationFilter.js).
		const annotations = useAnnotations({
			fileId: () => activeFileId.value,
			timeline: () => timeline.value,
			measuresTimeline: () => measuresTimeline.value,
			currentEtag: () => currentEtag.value,
			durationMs: () => durationMs.value,
			seek: (timeMs) => clock.value?.seek(timeMs),
			parts: () => session.scoreParts.value,
			pictureParts: () => session.pictureParts.value,
			pictureElid: (elid) => session.elids.value.toPicture(elid),
			myPartId: () => myPart.myPartId.value,
			isLeader: () => leaders.isLeader.value,
		})

		// Der Speed-Trainer zaehlt an den Loop-Durchlaeufen, braucht aber selbst
		// den Loop-Zustand - der Rueckruf wird deshalb nachgereicht.
		const onLoopWrap = forward(() => {})
		const loop = useLoop({
			measuresTimeline: () => measuresTimeline.value,
			durationMs: () => durationMs.value,
			isPlaying: () => clock.value?.isPlaying() ?? false,
			seek: (timeMs) => clock.value?.seek(timeMs),
			startCountIn: (targetMs) => metronome.startCountIn(targetMs, DEFAULT_TEMPO_BPM),
			clearCountIn: metronome.clearCountIn,
			onWrap: onLoopWrap.call,
		})

		const speedTrainer = useSpeedTrainer({
			loopActive: () => loop.active.value,
			effectiveTempoBpm: () => playback.effectiveTempoBpm.value,
			minTempoBpm: () => playback.minTempoBpm.value,
			maxTempoBpm: () => playback.maxTempoBpm.value,
			setTempoBpm: playback.setTempoBpm,
			manualTempoChanges: () => playback.manualTempoChanges.value,
		})
		onLoopWrap.to(speedTrainer.onLoopWrap)

		// Aufführungsmodus: die Tasten laufen ueber denselben Handler wie am
		// Viewer (onKeydown), nur zusaetzlich am document - siehe dort.
		// `following` kommt aus „Folgt mir", das erst weiter unten entsteht,
		// weil es selbst die Policy von hier braucht - der Rueckruf wird deshalb
		// nachgereicht.
		// Die beiden Rueckrufe in den Options-Teil sind die letzten Wege ueber
		// die Instanz: Tastaturkuerzel und das Schliessen beim Einschalten
		// greifen auf fast jeden Bereich des Viewers zu - sie gehoeren in die
		// Orchestrierung, nicht in ein eigenes Composable.
		const vm = getCurrentInstance()
		const isFollowing = forward(() => false)
		const performance = usePerformanceMode({
			rootEl: rootElement,
			onKeydown: (event) => vm?.proxy?.onKeydown(event),
			onEnter: () => vm?.proxy?.onPerformanceEnter(),
			following: isFollowing.call,
			offline: () => props.offline,
		})

		// The cards over the score (useViewerPanels.js), one state for all.
		const panels = reactive(useViewerPanels({
			adopt: { annotations: annotations.visible, rehearsal: leaders.visible },
			shownIf: {
				// The mixer shows with real playback AND resolved channels -
				// without both an empty card would stand over the score.
				mixer: () => playback.hasRealPlayer.value && playback.mixerChannels.value.length > 0,
				// „Meine Stimme" as a card of its own (issue #18): reachable
				// without sound, unlike the mixer. Both set the one choice
				// (useMyPart.js) - two places to make it, one state, so they
				// cannot disagree.
				partChoice: () => session.scoreParts.value.length > 0,
			},
		}))

		// The switches of the bar by tool id (lib/barGroups.js PINNABLE,
		// kind 'switch'). Welche Stimme "meine" ist, setzt die Stimmwahl
		// (useMyPart); `focusMyPart` only says whether the score dims the
		// other staves - the same choice steers sound AND highlight.
		const focusMyPart = ref(false)
		const showNoteText = ref(false)
		const switches = {
			metronome: metronome.enabled,
			autoScroll: preferences.autoScroll,
			myPart: focusMyPart,
			noteText: showNoteText,
		}

		/**
		 * @param {string} id a tool of kind 'switch'
		 * @param {boolean} on
		 */
		function setSwitch(id, on) {
			if (switches[id]) {
				switches[id].value = on
			}
		}

		/**
		 * Die Stimmauswahl oeffnen - wenn der Anfangston oder die Intonation
		 * keine Stimme fand.
		 */
		function openVoiceSelection() {
			if (!performance.can('settings')) {
				return
			}
			panels.set('partChoice', true)
		}

		const paging = usePaging({
			scrollEl: scrollElement,
			pages: autoScroll.pages,
			measureRects: (pageIndex) => systemRectsByPage.value[pageIndex] ?? [],
			onManualScroll: autoScroll.noteManualScroll,
			spread: spreadNow.call,
		})

		const startTone = useStartTone({
			clock: () => clock.value,
			hasRealPlayer: () => playback.hasRealPlayer.value,
			parsedMidi: () => scoreFacts.parsed.value,
			facts: () => scoreFacts.facts.value,
			measuresTimeline: () => measuresTimeline.value,
			displayTimeMs: () => playback.displayTimeMs.value,
			durationMs: () => durationMs.value,
			mixerChannels: () => playback.mixerChannels.value,
			myPartId: () => myPart.myPartId.value,
			permitted: () => performance.can('tone'),
			onNeedPart: openVoiceSelection,
			transpose: () => effectiveTranspose.value,
		})

		// Taktanzeige und Sprung nach Takten. Eigenes Navigieren loest das
		// Folgen einer Leitung - „Folgt mir" entsteht aber erst weiter unten,
		// weil es selbst die Sprungfunktionen von hier braucht; der Rueckruf
		// wird deshalb nachgereicht, wie `isFollowing` oben.
		const noteNavigation = forward(() => {})
		const navigation = useMeasureNavigation({
			measuresTimeline: () => measuresTimeline.value,
			durationMs: () => durationMs.value,
			displayTimeMs: () => playback.displayTimeMs.value,
			currentElid: () => session.elids.value.toBase(session.currentElid.value),
			currentEtag: () => currentEtag.value,
			clock: () => clock.value,
			marks: () => scoreFacts.marks.value,
			totalMeasures: () => session.totalMeasures.value,
			can: performance.can,
			onNavigate: noteNavigation.call,
			forceAutoScrollFor: session.forceAutoScrollFor,
		})

		// Die Schalter der Administration - fehlen sie, ist alles aus.
		const features = normalizeFeatures(readInitialState('features'))

		// „Folgt mir" (C). Sprung, Loop und Ton gehen ueber eigene Wege statt
		// ueber die Handler der Leiste: Diese melden eigenes Navigieren und
		// loesten damit das Folgen - ein Sprung der Leitung darf das nicht.
		// Wohin die Leitung umgezogen ist - nur fuer Geloeste, sonst null.
		const leaderMovedTo = ref(null)
		// Begleit-Token in den mobilen Apps (E8) - nur dort bereitgestellt.
		const ensureCompanion = inject('scoreviewCompanion', null)
		const follow = useFollowSession({
			fileId: () => activeFileId.value,
			// Offline gibt es keine Leitung, die etwas schickte (E14).
			enabled: () => features.followSession && !props.offline,
			standalone: () => readInitialState('standalone')?.directEditing === true,
			ready: () => !!clock.value && !!measuresTimeline.value,
			permitted: (action) => performance.can(action),
		}, {
			seekToMeasure: navigation.followSeek,
			setLoop: (from, to) => loop.setRange(from, to),
			clearLoop: () => loop.clear(),
			playTone: () => startTone.startToneFor(),
			currentPosition: navigation.followPosition,
			currentLoop: () => (loop.active.value
				? { from: Number(loop.fromMeasure.value), to: Number(loop.toMeasure.value) }
				: null),
			// H6: Die Leitung setzt die Transposition fuer alle; null = eigene.
			setTranspose: (semitones) => {
				sessionTranspose.value = semitones
			},
			openPiece: (target) => openFollowPiece(target),
			leaderMoved: (target) => {
				leaderMovedTo.value = target
			},
			// Stummes Mitblaettern: Die Leitung meldet ihre Wiedergabe, die
			// Folgenden haengen nur die Anzeige daran - ohne Ton (E10).
			leaderPlayback: () => (clock.value
				? { playing: playback.isPlaying.value, timeMs: playback.displayTimeMs.value, rate: playback.tempo.value }
				: null),
			followPlayback: (getter) => {
				playback.followTime(getter)
				// The leader's time moves without own playback - the
				// sleeping time loop has to run for it.
				session.wakeTimeDisplay()
			},
			holdAt: (timeMs) => {
				// Wer selbst spielt, wird nicht angehalten.
				if (!playback.isPlaying.value) {
					playback.seek(timeMs)
				}
			},
		})
		isFollowing.to(() => follow.following.value)
		// With autoscroll switched off (issue #12) an own jump still has to
		// show where it landed - the same window a jump of the leader gets
		// (useMeasureNavigation.followSeek). Switched on, nothing changes.
		const revealJump = () => {
			if (!preferences.autoScroll.value) {
				session.forceAutoScrollFor(1500)
			}
		}
		noteNavigation.to((kind) => {
			if (revealsCursor(kind)) {
				revealJump()
			}
			follow.noteNavigation(kind)
		})
		// The leader reports start and stop at once; its watch beat only
		// runs while playing (useFollowSession.updatePlaybackWatch).
		watch(() => playback.isPlaying.value, () => follow.playbackChanged())

		const standalonePage = readInitialState('standalone')?.directEditing === true
		const setlist = useSetlist({
			fileId: () => activeFileId.value,
			// Schaltet die Leitung einer laufenden Sitzung weiter, zieht die
			// Sitzung mit um (H7) - erst dann wechselt das Stueck, damit die
			// Folgenden dort schon eine Sitzung vorfinden.
			setFileId: (id) => {
				if (follow.mine.value && String(id) !== String(activeFileId.value)) {
					follow.move(Number(id), setlist.setlist.value?.id ?? null).finally(() => {
						activeFileId.value = id
					})
					return
				}
				activeFileId.value = id
			},
			standalone: () => standalonePage,
			originFileId: () => props.fileid,
			can: performance.can,
		})
		// Eine andere Partitur von aussen (Prop): Gehoert sie nicht zur
		// offenen Setliste, ist die Liste vorbei.
		watch(() => props.fileid, (neu) => {
			activeFileId.value = neu
			if (setlist.active.value && !setlist.entries.value.some((e) => String(e.fileId) === String(neu))) {
				setlist.close()
			}
		})

		/**
		 * Zum Stueck der Leitung (H7): ueber die Setliste, wenn es darin steht
		 * (sie zeigt dann die richtige Stelle), sonst als einzelnes Stueck.
		 *
		 * @param {{fileId: number, setlistId: ?number}} target
		 */
		async function openFollowPiece(target) {
			try {
				await ensureCompanion?.(target.fileId)
			} catch {
				// Ohne Token antwortet das Stueck 404 - der Viewer zeigt das.
			}
			const i = setlist.entries.value.findIndex((e) => String(e.fileId) === String(target.fileId))
			if (setlist.active.value && i >= 0) {
				setlist.showEntry(i)
			} else {
				activeFileId.value = target.fileId
			}
		}

		// Erst hier, nach „Folgt mir": Der Watcher fragt sofort.
		// Wach auch im Aufführungsmodus, wenn gar nichts spielt - und
		// waehrend einer Folgesitzung: Am Notenstaender wird gesungen, nicht
		// getippt, und ein dunkler Bildschirm verpasste den naechsten Sprung.
		// Only while leading or following, though: a detached device takes
		// no jumps, and the screen is the largest consumer of all.
		useWakeLock({ wanted: () => playback.isPlaying.value || performance.active.value || follow.mine.value || follow.following.value })

		useMyPartSound({
			hasRealPlayer: () => playback.hasRealPlayer.value,
			mixerChannels: () => playback.mixerChannels.value,
			myPartId: () => myPart.myPartId.value,
			stereoMyPart: () => preferences.stereoMyPart.value,
			applyChannelPans: playback.applyChannelPans,
			coach: () => myPart.practice.value.coach,
			setProgram: playback.setProgram,
		})

		const mix = useMix({
			hasRealPlayer: () => playback.hasRealPlayer.value,
			mixerChannels: playback.mixerChannels,
			baseVolumes: () => scoreFacts.parsed.value?.channelVolumes ?? null,
			myPartId: () => myPart.myPartId.value,
			othersLevel: () => myPart.practice.value.othersLevel,
			applyChannelVolumes: playback.applyChannelVolumes,
			setProgram: playback.setProgram,
		})

		// Die Mikrofonstrecke (docs/architecture.md, Abschnitt Mikrofon) - eine fuer Aufnahme, Intonation und
		// spaeter das Mitverfolgen, am AudioContext der Wiedergabe.
		const microphone = useMicrophone({ audioContext: playback.getAudioContext, holdAudio: playback.holdAudio })
		// The tuner (B3) on the same chain - it needs no score, only the
		// microphone; the key of the score only spells its note.
		const tuner = useTuner({ microphone, referenceHz: () => preferences.referencePitch.value })
		const myChannels = () => channelsOfPart(playback.mixerChannels.value, myPart.myPartId.value)
		const clockPlaying = () => clock.value?.isPlaying() ?? false

		const recorder = useRecorder({
			fileId: () => activeFileId.value,
			enabled: () => features.recording && !props.offline,
			microphone,
			clock: () => clock.value,
			audioContext: playback.getAudioContext,
			holdAudio: playback.holdAudio,
			isPlaying: clockPlaying,
			playing: () => playback.isPlaying.value,
			play: async () => {
				await clock.value?.play()
			},
			pause: () => clock.value?.pause(),
			seek: playback.seek,
			// Derselbe Einzaehler wie vor dem Loop (useMetronome.js).
			startCountIn: (targetMs) => metronome.startCountIn(targetMs, DEFAULT_TEMPO_BPM),
			clearCountIn: metronome.clearCountIn,
			currentTimeMs: () => clock.value?.getCurrentTimeMs() ?? 0,
			tempoFactor: () => playback.tempo.value,
			setTempoFactor: playback.setTempoFactor,
			latencyMs: () => playback.latencyMs.value,
			setAccompanimentGain: playback.setAccompanimentGain,
			maxPerScore: () => features.maxRecordingsPerScore,
			maxSeconds: () => features.maxRecordingSeconds,
			referenceHz: () => preferences.referencePitch.value,
		})

		// The practice log (E20): practising is the score sounding or the
		// singer recording - not the notes merely being open.
		const practiceLog = usePracticeLog({
			fileId: () => activeFileId.value,
			enabled: () => features.practiceLog && !props.offline,
			active: () => playback.isPlaying.value || recorder.phase.value === 'recording',
		})

		// Whether staves map to parts at all - "yes" once any loaded page
		// says so (lib/staffMappingReports.js, onStaffMapping).
		const staffMappingOk = ref(false)
		const staffMappingReports = createStaffMappingReports()
		// A new picture brings new pages, and they report again.
		watch(session.pageUrls, () => {
			staffMappingReports.clear()
			staffMappingOk.value = false
		})
		// Die Stimme, die als „meine" gilt, als Index in meta.parts - also in
		// derselben Reihenfolge, in der die Notenzeilen im System stehen.
		const myPartIndex = computed(() => {
			if (myPart.myPartId.value === null) {
				return null
			}
			// In the picture, not in the score: a part drawn on its own is
			// staff 0 there, whatever its place in the full score (E19).
			const index = session.pictureParts.value.findIndex((part) => String(part.id) === String(myPart.myPartId.value))
			return index === -1 ? null : index
		})
		// Whether the score has my part at all - for what plays, not for what is drawn.
		const myPartInScore = computed(() => myPart.myPartId.value !== null
			&& session.scoreParts.value.some((part) => String(part.id) === String(myPart.myPartId.value)))
		// Die Notenzeile der eigenen Stimme fuer die Intonation (`st-N`, M10) -
		// nur, wo die Zeilen sich den Stimmen zuordnen lassen (eine Zeile je
		// Stimme, siehe lib/staffBands.js). Sonst bleibt es bei Nadel und
		// Liste, statt die Zeile der Nachbarstimme zu faerben.
		const intonationStaff = computed(() => (staffMappingOk.value && myPartIndex.value !== null ? myPartIndex.value : null))

		// Sperrbildschirm und Medientasten (H5) - die Handler setzt mounted(),
		// weil sie die Sprungfunktionen der Komponente brauchen.
		// „Offline vormerken" (H9). Wem der Eintrag gehoert (S10), steht im
		// Seitenkopf, den Nextcloud fuer jede angemeldete Seite setzt.
		const offlineStore = useOffline({ uid: () => document.head?.dataset?.user ?? '' })

		const mediaSession = useMediaSession({
			isPlaying: () => playback.isPlaying.value,
			metadata: () => {
				const part = session.scoreParts.value.find((p) => String(p.id) === String(myPart.myPartId.value))
				return { title: scoreMeta.value?.title || '', artist: scoreMeta.value?.composer || '', album: part?.name || '' }
			},
			exportAvailable: () => features.practiceExport,
		})

		// Was die Artefakte hergeben (E15): Liedtext, Schreibweisen, Kennungen.
		// Ob das SVG Kennungen traegt, meldet die erste indizierte Seite.
		const svgHasSegIds = ref(false)
		// On the picture's meta: spellings and syllables carry the elids and
		// staves of the pages on screen (E19).
		const capabilities = computed(() => capabilitiesOf({ meta: session.pictureMeta.value, svgHasSegIds: svgHasSegIds.value }))
		const spellings = computed(() => (capabilities.value.spellings ? spellingMap(session.pictureMeta.value?.noteSpellings) : null))

		// What the picture shows now: layout, spread, note names, counts.
		const scoreDisplay = useScoreDisplay({
			capabilities: () => capabilities.value,
			pictureMeta: () => session.pictureMeta.value,
			preferences,
			meters: () => scoreFacts.meters.value,
			myPartIndex: () => myPartIndex.value,
			staffMappingOk: () => staffMappingOk.value,
			pagesWidthPx: () => pagesWidthPx.value,
		})
		spreadNow.to(() => scoreDisplay.spreadMode.value !== 'off')

		/**
		 * The zoom of the layout on screen, behind one shape: the band has a
		 * zoom of its own, a factor on its default size with that one preset
		 * (useBandZoom); pages and lyrics share the page zoom (useZoom).
		 * Keys, wheel and the controls ask this and never the layout.
		 */
		const activeZoom = computed(() => {
			if (scoreDisplay.activeLayout.value === 'band') {
				return {
					zoom: bandZoom.zoom.value,
					percent: bandZoom.percent.value,
					min: bandZoom.min,
					max: bandZoom.max,
					presets: ['default'],
					zoomIn: bandZoom.zoomIn,
					zoomOut: bandZoom.zoomOut,
					// Back to the default size, as "width" is for pages.
					fit: bandZoom.reset,
					preset: () => bandZoom.reset(),
					input: bandZoom.input,
					inputDone: bandZoom.inputDone,
					wheel: bandZoom.wheel,
				}
			}
			return {
				zoom: zoomApi.zoom.value,
				percent: zoomApi.percent.value,
				min: zoomApi.min,
				max: zoomApi.max,
				presets: ['width', 'page', 'actual'],
				zoomIn: () => zoomApi.by(zoomApi.step),
				zoomOut: () => zoomApi.by(1 / zoomApi.step),
				// Back to the page width - and following the window again,
				// as on opening.
				fit: () => zoomApi.applyPreset('width'),
				preset: zoomApi.applyPreset,
				input: zoomApi.input,
				inputDone: zoomApi.inputDone,
				wheel: zoomApi.wheel,
			}
		})
		const display = reactive({ ...scoreDisplay, activeZoom })

		// Uebe-Track als MP3 (H1/H10) - mit der Mischung, die gerade klingt.
		const myPartName = () => session.scoreParts.value.find((p) => String(p.id) === String(myPart.myPartId.value))?.name ?? null
		const practiceExport = usePracticeExport({
			fileId: () => activeFileId.value,
			midi: () => playback.midiData.value,
			soundFont: playback.getSoundFont,
			mix: playback.currentMix,
			base: () => ({
				transpose: effectiveTranspose.value,
				referencePitch: playback.referencePitch.value,
				rate: playback.tempo.value,
				measures: measuresTimeline.value,
				meters: scoreFacts.meters.value,
				durationMs: durationMs.value,
				baseBpm: playback.baseTempoBpm.value,
			}),
			score: () => ({ title: scoreMeta.value?.title || '', composer: scoreMeta.value?.composer || '' }),
			myPartName,
			coach: () => myPart.practice.value.coach,
			mixerChannels: () => playback.mixerChannels.value,
			parts: () => session.scoreParts.value.map((p) => ({ partId: String(p.id), name: p.name })),
			othersLevel: () => myPart.practice.value.othersLevel,
			baseVolumes: () => scoreFacts.parsed.value?.channelVolumes ?? null,
		})

		// Die Sollwerte der Intonation klingen, wie gespielt wird: Wer einen
		// Ton tiefer uebt, singt auch einen Ton tiefer richtig (F6.2).
		const transposedNotes = computed(() => {
			const notes = scoreFacts.parsed.value?.notes ?? null
			const shift = effectiveTranspose.value
			return notes === null || shift === 0 ? notes : notes.map((note) => ({ ...note, pitch: note.pitch + shift }))
		})

		const intonation = useIntonation({
			microphone,
			clock: () => clock.value,
			isPlaying: clockPlaying,
			displayTimeMs: () => playback.displayTimeMs.value,
			latencyMs: () => playback.latencyMs.value,
			tempoFactor: () => playback.tempo.value,
			notes: () => transposedNotes.value,
			myChannels,
			events: () => timeline.value?.events ?? [],
			myStaff: () => intonationStaff.value,
			measureOf: (ms) => resolveMeasurePosition(measuresTimeline.value, ms, durationMs.value)?.measureNumber ?? null,
			loadAudio: recorder.loadAudio,
			referenceHz: () => preferences.referencePitch.value,
		})

		// Wait mode (C2). My part is silent for the whole mode; its level stays
		// in the mix (useMix.js) and comes back when the mode ends.
		const waitMode = useWaitMode({
			clock: () => clock.value,
			tempoFactor: () => playback.tempo.value,
			targets: () => transposedNotes.value,
			// Untransposed: the synthesizer shifts what it plays itself (setTranspose).
			synthNotes: () => scoreFacts.parsed.value?.notes ?? null,
			myChannels,
			intonation,
			setMineMuted: (muted) => mix.silence(muted ? myChannels() : null),
		})
		// My staff, where staves map to parts - for the lyrics and the stage.
		const myStaves = computed(() => (myPartIndex.value !== null && staffMappingOk.value ? [myPartIndex.value] : null))

		// Scored singing (E24): the live intonation's frames, judged per note.
		const singScore = useSingScore({
			fileId: () => activeFileId.value,
			enabled: () => features.intonation && features.singScore && !props.offline,
			intonation,
			notes: () => transposedNotes.value,
			myChannels,
			measureOf: (ms) => resolveMeasurePosition(measuresTimeline.value, ms, durationMs.value)?.measureNumber ?? null,
			loopRange: () => (loop.active.value
				? { from: Number(loop.fromMeasure.value), to: Number(loop.toMeasure.value), startMs: loop.startMs.value, endMs: loop.endMs.value }
				: null),
			durationMs: () => durationMs.value,
			// Reactive: the end of a run is a watcher on it (clock.isPlaying() is not).
			isPlaying: () => playback.isPlaying.value,
			positionMs: () => clock.value?.getCurrentTimeMs() ?? null,
			waitModeActive: () => waitMode.active.value,
		})
		// What the singing lane shows besides the judged notes.
		const sing = reactive(useSingView({
			pictureMeta: () => session.pictureMeta.value,
			myStaves: () => myStaves.value,
			timeline: () => timeline.value,
			loop: () => ({ active: loop.active.value, from: loop.fromMeasure.value, to: loop.toMeasure.value }),
			savedLoops: () => annotations.savedLoops.value,
			level: () => singScore.level.value,
		}))

		// F-C2.2: no metronome, speed trainer, recording or following a leader
		// alongside. Whatever is switched on last wins.
		watch(waitMode.active, (on) => {
			if (on) {
				metronome.enabled.value = false
				if (speedTrainer.active.value) {
					speedTrainer.stop()
				}
			}
		})
		watch(() => metronome.enabled.value, (on) => on && waitMode.stop())
		watch(() => speedTrainer.active.value, (on) => on && waitMode.stop())
		watch(() => recorder.phase.value, (phase) => (phase === 'starting' || phase === 'recording') && waitMode.stop())
		watch(() => follow.following.value, (following) => following && waitMode.stop())

		session.connect({
			applyMetadata: playback.applyMetadata,
			loadAnnotations: annotations.load,
			ensureMidi: scoreFacts.ensureMidi,
			restoreZoom: zoomApi.restore,
			observeViewport: zoomApi.observeViewport,
			useRealPlayer: playback.useRealPlayer,
			setNoSoundFontConfigured: playback.setNoSoundFontConfigured,
			useSilentClock: playback.useSilentClock,
			updateAutoScroll: autoScroll.update,
			onError: (message) => {
				conversion.state.value = 'error'
				conversion.errorMessage.value = message
			},
			sampleTime: playback.sampleTime,
			displayTimeMs: () => playback.displayTimeMs.value,
			currentTimeMs: () => playback.currentTimeMs.value,
			wrapLoop: loop.wrapIfDue,
			tickMetronome: metronome.tick,
			stopPolling: conversion.stop,
			destroyMetronome: metronome.destroy,
			destroyPlayback: playback.destroy,
			stopZoomObserver: zoomApi.stop,
			isFollowing: playback.hasExternalTime,
		})

		// Erst hier, weil der Inhaltsschluessel der Leiste auf Modus, Folgen,
		// Leitung und Mikrofon schaut - die entstehen weiter oben.
		const bar = useBarLayout({
			rootEl: rootElement,
			isFullscreen: () => zoomApi.isFullscreen.value,
			isPlaying: () => playback.isPlaying.value,
			isPerformance: () => performance.active.value,
			isFollowing: () => follow.following.value,
			// NcPopover marks its trigger, wherever the popover itself is teleported to.
			isBusy: () => rootElement()?.querySelector('.scoreview-bar [aria-expanded="true"]') !== null,
			// Alles, was die Breite der Leiste aendert: Rechte und Modus
			// bestimmen die Gruppen, Studierbuchstaben und Mikrofon den
			// Transport. Aendert sich davon etwas, wird breit neu versucht.
			contentKey: () => [
				performance.active.value,
				follow.following.value,
				leaders.isLeader.value,
				scoreFacts.marks.value.length > 0,
				microphone.active.value,
			].join('|'),
		})

		// --- Shared with the bar ------------------------------------------
		// The single-argument wrapper the l10n extraction looks for.
		const t = (text, vars) => translate('scoreview', text, vars)
		// What more than one part of the viewer needs: the keys, the lyrics
		// view and the bar (ViewerBar.vue) start the same loop and print the
		// same way.

		/** The name of "my part" in the bar and the mixer. */
		const myPartLabel = computed(() => {
			if (myPart.myPartId.value === null) {
				return t('None')
			}
			const part = session.scoreParts.value.find((p) => String(p.id) === String(myPart.myPartId.value))
			return part?.name || String(myPart.myPartId.value)
		})

		/**
		 * Ob „nur meine Zeile" ueberhaupt etwas bewirken kann. Ohne diese
		 * Pruefung stuende dort ein Schalter, der bei einem Klavierauszug oder
		 * einer Partitur mit ausgeblendeten leeren Zeilen wirkungslos bliebe.
		 */
		const canFocusMyPart = computed(() => myPartIndex.value !== null && staffMappingOk.value)

		const setlistTitle = computed(() => setlist.setlist.value?.title ?? '')
		const startKey = computed(() => scoreFacts.facts.value?.keys?.[0] ?? null)

		// Focus on the loop (B4) - a session switch, it dies with the loop, so
		// the next loop starts with the whole score in view.
		const loopFocus = ref(false)
		watch(loop.active, (active) => {
			if (!active) {
				loopFocus.value = false
			}
		})

		/** Eigener Loop loest das Folgen. */
		function toggleLoopByUser() {
			if (performance.can('loop')) {
				noteNavigation.call('loop')
				loop.toggle()
			}
		}

		/**
		 * A saved loop (B5) becomes the running loop and the playback
		 * position moves to its start - no count-in, like a range sent by
		 * the leader.
		 *
		 * @param {{from: number, to: number}} saved
		 */
		function applySavedLoop(saved) {
			if (!performance.can('loop')) {
				return
			}
			noteNavigation.call('loop')
			if (loop.setRange(saved.from, saved.to)) {
				navigation.jumpToMeasure(saved.from)
			}
		}

		/**
		 * The print page (E16) in a new tab - the viewer in Files holds only
		 * the pages in reach, so printing happens on a page that holds all.
		 * Only where the bar offers it (lib/barGroups.js): with a session,
		 * in the browser, outside performance mode.
		 */
		function openPrintPage() {
			if (!performance.can('settings') || standalonePage || props.offline) {
				return
			}
			// What is on screen: a part or phone pages print as such (E19).
			const key = session.variantKey.value
			const url = generateUrl('/apps/scoreview/print/{fileId}', { fileId: activeFileId.value })
			window.open(key ? `${url}?variant=${encodeURIComponent(key)}` : url, '_blank', 'noopener')
		}

		function closeTuner() {
			panels.close('tuner')
			tuner.stop()
		}

		const popoverContainer = useFullscreenContainer().container

		// The composables as namespaces, the same proxies for the bar
		// (components/viewerContext.js) and for this component. reactive()
		// unwraps their refs, so the template reads `playback.isPlaying` and
		// the options API writes `this.loop.fromMeasure = n` as it would a
		// flat ref. They hold only refs, computeds and functions; large data
		// (timeline, MIDI, the clock) sits in shallowRefs, which reactive()
		// hands out unwrapped and raw, not deep-proxied.
		const shared = {
			playback: reactive(playback),
			loop: reactive(loop),
			trainer: reactive(speedTrainer),
			metronome: reactive(metronome),
			navigation: reactive(navigation),
			startTone: reactive(startTone),
			performance: reactive(performance),
			microphone: reactive(microphone),
			prefs: reactive(preferences),
			zoom: reactive(zoomApi),
			myPart: reactive(myPart),
			annotations: reactive(annotations),
			// Not `leaders`: that is the composable's own list of them.
			leaderRoles: reactive(leaders),
			follow: reactive(follow),
			session: reactive(session),
			scoreFacts: reactive(scoreFacts),
			conversion: reactive(conversion),
			bar: reactive(bar),
			practiceExport: reactive(practiceExport),
			panels,
			setlistNav: reactive(setlist),
			variant,
			display,
			// Plain: the administration's switches do not change while open.
			features,
		}
		provide(VIEWER_CONTEXT, {
			...shared,
			offlineStore: reactive(offlineStore),
			view: reactive({
				activeFileId,
				standalonePage,
				offline: computed(() => props.offline),
				popoverContainer,
				myPartInScore,
				myPartLabel,
				canFocusMyPart,
				startKey,
				sessionTranspose,
				effectiveTranspose,
				focusMyPart,
				showNoteText,
				singActive: singScore.active,
				loopFocus,
				setlistTitle,
				followNavigation: noteNavigation.call,
				toggleLoop: toggleLoopByUser,
				applySavedLoop,
				openPrintPage,
				closeTuner,
				setSwitch,
			}),
		})

		return {
			...shared,
			waitMode: reactive(waitMode),
			practiceLog: reactive(practiceLog),
			tuner: reactive(tuner),
			mix: reactive(mix),
			recorder: reactive(recorder),
			intonation: reactive(intonation),
			singScore: reactive(singScore),
			bandZoom: reactive(bandZoom),
			// Named apart from the switch `prefs.autoScroll`, which says
			// whether it follows at all; this is the following itself.
			autoScroller: reactive(autoScroll),
			paging: reactive(paging),
			sing,
			mediaSession,
			// The viewer's own state, derived values and actions.
			root,
			scroll,
			focusMyPart,
			showNoteText,
			openVoiceSelection,
			staffMappingOk,
			staffMappingReports,
			myPartIndex,
			activeFileId,
			standalonePage,
			myPartLabel,
			setlistTitle,
			loopFocus,
			toggleLoopByUser,
			applySavedLoop,
			openPrintPage,
			closeTuner,
			leaderMovedTo,
			svgHasSegIds,
			spellings,
			scoreFactsKeys: computed(() => scoreFacts.facts.value?.keys ?? []),
			elidKeys: computed(() => keyByElid(timeline.value, scoreFacts.facts.value?.keys ?? [], measuresTimeline.value, durationMs.value)),
			// Released by leaders (E21), filtered by part like part notes.
			visibleSharedRecordings: computed(() => visibleSharedRecordings(recorder.sharedRecordings.value, myPart.myPartId.value, session.scoreParts.value, leaders.isLeader.value)),
			NO_RECTS,
			NO_MARKS,
			myStaves,
			// My notes, for the bars of the singing lane.
			singLaneNotes: computed(() => {
				const channels = new Set(myChannels() ?? [])
				return (transposedNotes.value ?? []).filter((n) => channels.has(n.channel))
			}),

			followNavigation: noteNavigation.call,
			revealJump,
		}
	},

	data() {
		return {
			// Siehe emits: genau einmal, egal wie oft der Zustand danach noch
			// wechselt.
			readyGemeldet: false,
			// Band and lyrics report whether the playing position is on screen
			// (their `cursorVisible`) - for the button back to it.
			layoutCursorShown: true,
			// Fensterbreite beim Oeffnen - fuer das einmalige Angebot des
			// Systembands auf Handybreite (D9).
			viewerWidth: 0,
		}
	},

	computed: {
		// Band and lyrics scroll along when the user wants it, and for an own
		// jump or one of the leader even when not (useScoreSession.cursorForced).
		followCursor() {
			return this.prefs.autoScroll || this.session.cursorForced
		},

		showBackToCursor() {
			if (this.prefs.autoScroll || !this.session.cursorRect) {
				return false
			}
			return this.display.activeLayout === 'band' || this.display.activeLayout === 'lyrics'
				? !this.layoutCursorShown
				: this.autoScroller.cursorOutOfView
		},

		setlistCanEdit() {
			return this.setlistNav.setlist?.canEdit === true && !this.standalonePage && !this.offline
		},

		armedStampName() {
			return this.annotations.armedStamp ? stampName(this.annotations.armedStamp.stamp) : ''
		},

		partCount() {
			return this.session.pictureParts.length
		},

		// --- Leiste ---------------------------------------------------------

		spreadClasses() {
			return {
				'scoreview-pages--spread': this.display.spreadMode !== 'off',
				'scoreview-pages--first-right': this.display.spreadMode === 'right',
			}
		},

		/** Part names for the rows of the all-parts lyrics (lyricsLayout.staffPartNames). */
		lyricsPartNames() {
			const meta = this.session.pictureMeta
			return staffPartNames(this.session.pictureParts, [...(meta?.noteSpellings ?? []), ...(meta?.lyricSyllables ?? [])])
		},

		/**
		 * Auf Handybreite einmal das Systemband anbieten (D9) - und ebenso,
		 * wenn der Platz in der Hoehe knapp ist: Ein Telefon quer ist breiter
		 * als 600 px, zeigt in der Seitenansicht mit „Breite einpassen" aber
		 * nur einen Teil eines Systems (issue #15).
		 */
		offerBand() {
			return !this.prefs.bandOffered && this.prefs.layout === 'pages' && ((this.viewerWidth > 0 && this.viewerWidth < 600) || this.bar.tight)
		},

		/**
		 * The props every ScorePage gets, in the band and in the page list -
		 * one list, so the two cannot drift apart. Not in it: what changes
		 * with every note (cursor, note, needle, live marks - the band passes
		 * them only to the system with the cursor) and drawing, which only
		 * the page list offers.
		 */
		sharedPageProps() {
			return {
				markers: this.annotations.markers,
				stamps: this.annotations.stamps,
				drawings: this.annotations.drawings,
				loopMarkers: this.loop.markers,
				myPartIndex: this.myPartIndex,
				focusMyPart: this.focusMyPart,
				partCount: this.partCount,
				showNoteText: this.showNoteText,
				highlightMode: this.prefs.highlightMode,
				noteTheme: this.prefs.resolvedNoteTheme,
				svgVars: this.prefs.highlightStyle,
				noteMarks: this.intonation.marks,
				spellings: this.spellings,
				noteNameSystem: this.display.noteNameSystem,
				noteNameStaves: this.display.noteNameStaves,
				keyOfElid: this.keyOfElid,
				countOfElid: this.display.countOfElid,
				countStaves: this.display.countStaves,
			}
		},

		/**
		 * How the tuner names its note: like the note names in the score, or
		 * - with those switched off - as the interface language would.
		 */
		tunerNameSystem() {
			return noteNameSystem(this.prefs.noteNames, getLanguage())
		},

		/** The key at the current position - it decides between F♯ and G♭. */
		tunerKey() {
			return keyAt(this.scoreFactsKeys, this.navigation.currentAnchor?.measureNumber ?? 1)?.concertKey ?? 0
		},

		/** The looped measures' rectangles while the focus is on (lib/loopFocus.js). */
		loopMeasureRects() {
			if (!this.loopFocus || !this.loop.active || !this.session.measuresTimeline) {
				return null
			}
			return loopMeasureRects(this.session.measuresTimeline.elements, this.loop.fromMeasure, this.loop.toMeasure)
		},

		loopDimRectsByPage() {
			return this.loopMeasureRects ? loopDimRects(this.session.measuresTimeline.elements, this.loop.fromMeasure, this.loop.toMeasure) : []
		},

		loopFocusKeys() {
			return this.loopMeasureRects ? loopSystemKeys(this.loopMeasureRects) : null
		},

		/** „Im Browser oeffnen" (E8): Nextclouds Kurzlink auf diese Datei. */
		browserUrl() {
			return browserFileUrl(window.location.origin, getRootUrl(), this.activeFileId)
		},
	},

	watch: {
		// The presets fit one page or the pair: when the spread comes or goes,
		// a chosen fit is fitted again (a zoom of one's own stays as it is).
		'display.spreadMode': function() {
			const preset = this.zoom.preset
			if (preset === 'width' || preset === 'page') {
				this.$nextTick(() => this.zoom.applyPreset(preset))
			}
		},

		/**
		 * Sichtbar heisst: Noten oder Fehlermeldung. Beides beendet das
		 * Warten - fuer die App ist der Unterschied keiner, ihr Ladebildschirm
		 * gehoert in beiden Faellen weg.
		 *
		 * `$nextTick`, damit das Notenbild beim Melden wirklich im DOM steht
		 * und nicht erst im selben Tick eingehaengt wird.
		 *
		 * @param {string} neu Der neue Zustand aus useConversionStatus
		 */
		'conversion.state': function(neu) {
			if (this.readyGemeldet || (neu !== 'ready' && neu !== 'error')) {
				return
			}
			this.readyGemeldet = true
			this.$nextTick(() => this.$emit('ready', neu))
		},

		activeFileId: {
			immediate: true,
			handler() {
				// Eine andere Partitur faengt von vorn an - auch mit dem
				// Melden.
				this.readyGemeldet = false
				this.reset()
				this.conversion.poll()
				this.myPart.load()
				this.leaderRoles.reset()
				this.leaderRoles.load()
				this.follow.restart()
				this.setlistNav.loadOffers()
				this.recorder.load()
			},
		},

		'setlistNav.current': function() {
			this.announcePiece()
		},

		// Nach einem Zoomwechsel steht das aktuelle System woanders - ohne
		// dieses Nachziehen bliebe es bis zum nächsten Notenwechsel verschoben
		// (bei angehaltener Wiedergabe: für immer). Bewusst mit force: ein
		// Zoomwechsel ist eine ausdrückliche Handlung, keine Störung des
		// Lesens wie ein manueller Scroll.
		'zoom.zoom': function() {
			this.$nextTick(() => this.autoScroller.update(this.session.cursorRect, true))
		},

		// Switched back on: straight to the playing position, not only at the
		// next note - when paused there is none.
		'prefs.autoScroll': function(on) {
			if (on) {
				this.$nextTick(() => this.revealCursor())
			}
		},

		'display.activeLayout': function() {
			this.layoutCursorShown = true
		},
	},

	mounted() {
		// Der Scroll-Listener sitzt im Template (@scroll.passive an
		// .scoreview-scroll): das scrollende Element ist ein Kind, das erst im
		// Zustand "ready" existiert, this.$el scrollt selbst nicht.
		document.addEventListener('fullscreenchange', this.zoom.onFullscreenChange)
		// Tastaturkürzel NICHT passiv: Leertaste/Pfeiltasten sollen die Seite
		// nicht zusätzlich scrollen (siehe onKeydown - preventDefault nur für
		// die tatsächlich behandelten Tasten, alles andere bleibt unangetastet,
		// insbesondere Nextclouds eigene Kürzel).
		this.$el.addEventListener('keydown', this.onKeydown)
		this.bar.observe()
		this.viewerWidth = window.innerWidth
		this.mediaSession.setHandlers({
			play: () => !this.playback.isPlaying && this.performance.can('play') && this.playback.toggle(),
			pause: () => this.playback.isPlaying && this.performance.can('play') && this.playback.toggle(),
			previous: () => this.performance.can('seek') && this.navigation.jumpRelative(-1),
			next: () => this.performance.can('seek') && this.navigation.jumpRelative(1),
		})
		if (this.setlistId !== null) {
			// Weg 1: Der Einstieg hat das erste spielbare Stueck schon
			// als `fileid` gesetzt - die Liste setzt dort an.
			this.setlistNav.open(this.setlistId, { at: this.fileid, data: this.setlistData })
		}
	},

	beforeUnmount() {
		// Dieselbe Reihenfolge wie in reset() - why it matters is written
		// there. Below the session, only listeners and handles are left.
		this.recorder.destroy()
		this.waitMode.reset()
		this.singScore.reset()
		this.intonation.destroy()
		this.practiceExport.cancel()
		this.bandZoom.stop()
		this.session.cleanup()
		this.microphone.turnOff()
		document.removeEventListener('fullscreenchange', this.zoom.onFullscreenChange)
		this.zoom.disposeFullscreen()
		this.$el.removeEventListener('keydown', this.onKeydown)
		this.bar.stop()
		this.mediaSession.dispose()
	},

	methods: {
		/**
		 * What changes with every note, read by LiveValue around the band
		 * and the page list instead of by this template (see there).
		 *
		 * @return {{cursorRect: ?object, cursorElid: ?number, needle: ?object, liveNoteMarks: Array}}
		 */
		readLive() {
			return {
				cursorRect: this.session.cursorRect,
				cursorElid: this.session.currentElid,
				needle: this.intonation.needle,
				liveNoteMarks: this.intonation.liveMarks,
			}
		},

		/**
		 * A value that only the page under the cursor needs (cursor, sounding
		 * elid, live needle and live intonation marks) - every other page
		 * gets null. Vue re-renders a
		 * child whenever one of its props changes, so handing the cursor to
		 * all pages re-rendered every mounted page on every note step; this
		 * way only the page the cursor enters or leaves updates.
		 *
		 * @param {number} pageIndex
		 * @param {?(object|number)} value
		 * @param {?object} [cursorRect] the cursor to compare against - the
		 *   one LiveValue read (see readLive())
		 * @return {?(object|number)}
		 */
		onCursorPage(pageIndex, value, cursorRect = this.session.cursorRect) {
			return cursorRect?.page === pageIndex ? value : null
		},

		// --- Werkzeuge der Leiste (E23) ----------------------------------

		// Einzelargument-Wrapper um @nextcloud/l10n translate() (siehe
		// tools/l10n.mjs zur Extraktion) - hier statt auf Modulebene definiert,
		// damit t() dort ausgewertet wird, wo der Text gebraucht wird
		// (Template/computed), nicht einmalig beim Modulimport.
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
				this.focusMyPart = false
			}
		},

		/**
		 * Beim Einschalten des Aufführungsmodus alles schliessen, was dort
		 * gesperrt ist - ein offener Mixer bliebe sonst bedienbar stehen.
		 */
		onPerformanceEnter() {
			// The tuner stays: it changes nothing in the score or the sound.
			this.panels.closeAll(PANELS.filter((id) => id !== 'tuner'))
			this.annotations.disarmStamp()
			this.annotations.cancelDrawing()
			this.setlistNav.closeEditor()
			this.bar.toolsOpen = false
			this.startTone.release()
		},

		// --- Setliste -----------------------------------------------------

		/**
		 * Meldet dem Einstieg, welches Stueck gerade offen ist - ScoreModal
		 * setzt daraus seine Ueberschrift. Ohne Setliste bleibt es beim
		 * Dateinamen, den der Einstieg selbst kennt.
		 */
		announcePiece() {
			const entry = this.setlistNav.current
			this.$emit('pieceChange', entry ? { label: entry.label, setlistTitle: this.setlistTitle } : null)
		},

		// --- Aufnahme und Intonation ------------------------------------------

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
				this.openVoiceSelection()
			}
		},

		async onToggleWaitMode() {
			await this.ensureIntonationMidi()
			await this.waitMode.toggle()
			if (this.waitMode.needPart) {
				this.openVoiceSelection()
			}
		},

		async onAnalyzeRecording(recording) {
			await this.ensureIntonationMidi()
			await this.intonation.analyze(recording === 'pending' ? { id: 'pending', ...this.recorder.pending.meta } : recording)
			if (this.intonation.needPart) {
				this.openVoiceSelection()
			}
		},

		/**
		 * Abhoeren ist eigenes Navigieren (Sprung an den Anfang der
		 * Aufnahme) - das loest das Folgen einer Leitung.
		 *
		 * @param {object|'pending'} recording
		 */
		onListenRecording(recording) {
			this.followNavigation('seek')
			this.recorder.listen(recording)
		},

		async onSingToggle() {
			await this.ensureIntonationMidi()
			await this.singScore.toggle()
			if (this.intonation.needPart) {
				this.openVoiceSelection()
			}
		},

		/**
		 * A loop over one measure to practise, from the result.
		 *
		 * @param {number} measure
		 */
		onSingLoop(measure) {
			this.applySavedLoop({ from: measure, to: measure })
		},

		/**
		 * Aus der Problemliste an die Stelle springen.
		 *
		 * @param {number} onMs Partiturzeit der Note
		 */
		onPracticeJump(onMs) {
			if (this.performance.can('seek') && this.session.clock) {
				this.followNavigation('seek')
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
		 * Klick auf einen Notizmarker springt an dessen Stelle - im
		 * Aufführungsmodus also gesperrt wie jeder andere Sprung.
		 *
		 * @param {number} id
		 */
		onMarkerClick(id) {
			if (this.performance.can('seek')) {
				this.followNavigation('annotationJump')
				this.annotations.jumpToById(id)
			}
		},

		/**
		 * Meldung der Seiten, ob sich Notenzeilen ueberhaupt Stimmen zuordnen
		 * lassen (siehe lib/staffBands.js).
		 *
		 * @param {boolean} moeglich
		 * @param {number} page index of the reporting page
		 */
		onStaffMapping(moeglich, page) {
			this.staffMappingOk = this.staffMappingReports.report(page, moeglich)
			if (!this.staffMappingOk) {
				this.focusMyPart = false
			}
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

		/**
		 * „Neu konvertieren": erst den eigenen Zustand abbauen, dann den Server
		 * die gespeicherte Konvertierung verwerfen lassen. Die Reihenfolge ist
		 * nicht beliebig - ohne den eigenen reset() liefe die Wiedergabe auf
		 * Artefakten weiter, die es serverseitig im naechsten Moment nicht
		 * mehr gibt.
		 */
		async reconvertScore() {
			this.reset()
			await this.conversion.reconvert()
		},

		/**
		 * Back to "nothing loaded" for the next piece or a reconversion.
		 *
		 * The order of the first block is fixed, and beforeUnmount repeats it:
		 * 1. The recording first - a running one is finished and saved while
		 *    its AudioContext, which belongs to the playback, still lives.
		 * 2. Wait mode, scored singing, intonation - they listen to the
		 *    microphone and read the clock; they stop before the clock goes,
		 *    and singing before the intonation whose frames it judges.
		 * 3. The practice-track export - it belongs to the piece it began on.
		 * 4. The session - it tears down the playback and forgets the loaded
		 *    conversion, so a load still under way counts as stale from here.
		 * What follows is plain state without resources; its order is free.
		 */
		reset() {
			this.recorder.reset()
			this.waitMode.reset()
			this.singScore.reset()
			this.intonation.reset()
			// A practice-track export belongs to the piece it was started on.
			this.practiceExport.cancel()
			// Baut die Wiedergabe ab und vergisst die geladene Konvertierung
			// (useScoreSession.js) - ein noch laufendes Laden gilt ab hier
			// als veraltet.
			this.session.reset()
			this.variant.reset()
			this.startTone.reset()
			this.trainer.reset()
			this.conversion.reset()
			this.playback.reset()
			this.panels.close('mixer')
			this.panels.close('partChoice')
			this.autoScroller.reset()
			this.focusMyPart = false
			this.staffMappingReports.clear()
			this.staffMappingOk = false
			this.navigation.reset()
			this.scoreFacts.reset()
			this.loop.reset()
			this.zoom.reset()
			this.annotations.reset()
			this.metronome.reset()
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
			this.revealJump()
			this.navigation.jumpToMeasure(mark.measure)
			return this.follow.sendPosition({ measure: mark.measure, mark: mark.text })
		},

		/**
		 * Sprung zu einer Notiz aus der Liste - eigenes Navigieren.
		 *
		 * @param {object} annotation
		 */
		onAnnotationJumpToOwn(annotation) {
			this.followNavigation('annotationJump')
			this.annotations.jumpTo(annotation)
		},

		// Tastaturkürzel für die Probe - greifen, wenn der Viewer den Fokus
		// hat (Listener auf this.$el, siehe mounted()) oder, im
		// Aufführungsmodus, von überall (usePerformanceMode.js). Nie, wenn der
		// Fokus in einem Eingabefeld liegt - sonst würde z.B. das
		// Pfeiltasten-Navigieren im Takt-Eingabefeld gestohlen.
		//
		// Welche Taste was tut, steht in EINER Tabelle (lib/keyMap.js), ob es
		// gerade wirken darf, in lib/interactionPolicy.js - hier nur die
		// Ausführung.
		onKeydown(event) {
			const tag = event.target?.tagName
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) {
				return
			}
			const binding = resolveKey(event, { performance: this.performance.active })
			if (!binding) {
				return
			}
			if (binding.preventDefault) {
				event.preventDefault()
			}
			if (binding.action !== null && !this.performance.can(binding.action)) {
				return
			}
			const commands = {
				togglePlay: () => this.playback.toggle(),
				nextMeasure: () => this.navigation.jumpRelative(1),
				previousMeasure: () => this.navigation.jumpRelative(-1),
				toggleLoop: () => this.toggleLoopByUser(),
				zoomIn: () => this.display.activeZoom.zoomIn(),
				zoomOut: () => this.display.activeZoom.zoomOut(),
				zoomWidth: () => this.display.activeZoom.fit(),
				// Im Systemband blaettert das Pedal ein System weiter (H8).
				pageDown: () => this.activeView().next(),
				pageUp: () => this.activeView().previous(),
				// Diese Tasten scrollen nativ weiter. Gemeldet wird nur, DASS
				// gescrollt wird - der Browser meldet für Tastatur-Scrollen
				// keine Geste, und ohne diesen Hinweis führte die App der
				// Wiedergabe sofort wieder nach (siehe useAutoScroll.js).
				scroll: () => this.autoScroller.noteManualScroll(),
				print: () => this.openPrintPage(),
				blocked: () => {},
			}
			commands[binding.command]?.()
		},

		// Umkehrung von M4: Klick auf eine Note springt dorthin -
		// ScorePage.vue liefert nur die Klickposition in SVG-Einheiten, die
		// eigentliche Element-/Zeit-Auflösung passiert hier mit der vollen
		// timeline (scoreLayout.js).
		/**
		 * Vorzeichen an einem Segment - fuer das bewegliche Do
		 * (scoreFacts.keyByElid, einmal je Partitur gebaut).
		 *
		 * @param {number} elid
		 * @return {number}
		 */
		keyOfElid(elid) {
			return this.elidKeys(elid)
		},

		/** Die gehoerte Zeit als Funktion - fuer Ansichten, die je Rahmen lesen. */
		readDisplayTimeMs() {
			return this.playback.displayTimeMs
		},

		/** @param {number} ms aus der Liedtext-Ansicht */
		onLyricsSeek(ms) {
			if (!this.session.clock || !this.performance.can('seek')) {
				return
			}
			this.followNavigation('seek')
			this.session.clock.seek(ms)
		},

		/**
		 * Ueber Woerter gezogen: ein Loop ueber die Takte dazwischen.
		 *
		 * @param {{fromMs: number, toMs: number}} range
		 */
		onLyricsLoop({ fromMs, toMs }) {
			if (!this.performance.can('loop')) {
				return
			}
			const from = resolveMeasurePosition(this.session.measuresTimeline, fromMs, this.session.durationMs)?.measureNumber
			const to = resolveMeasurePosition(this.session.measuresTimeline, toMs, this.session.durationMs)?.measureNumber
			if (!from || !to) {
				return
			}
			this.loop.fromMeasure = Math.min(from, to)
			this.loop.toMeasure = Math.max(from, to)
			if (!this.loop.active) {
				this.toggleLoopByUser()
			}
		},

		/** @param {boolean} accepted */
		answerBandOffer(accepted) {
			this.prefs.bandOffered = true
			if (accepted) {
				this.prefs.layout = 'band'
			}
		},

		/** @param {{segIds: boolean}} info aus ScorePage.indexSegments */
		onPageIndexed({ segIds }) {
			if (segIds) {
				this.svgHasSegIds = true
			}
		},

		/**
		 * „Note antippen = Ton hoeren" (D13): bei stehender Wiedergabe den
		 * getroffenen Kopf anspielen und seinen Namen zeigen. Der Synthesizer
		 * transponiert den Ton selbst (player.js), der Name bleibt die
		 * geschriebene Note.
		 *
		 * @param {{pitch: number, tpc: number, elid: number, left: number, top: number}} note
		 * @param {?function(string): void} showName from the tapped ScorePage
		 */
		async playTappedNote(note, showName) {
			if (this.playback.isPlaying || !this.performance.can('tone') || !this.session.clock?.startTone) {
				return
			}
			const system = noteNameSystem(this.prefs.noteNames, getLanguage())
			showName?.(nameOf({ tpc: note.tpc, system, concertKey: this.keyOfElid(note.elid) }))
			await this.session.clock.startTone(note.pitch)
			setTimeout(() => this.session.clock?.stopTone?.(), 700)
		},

		onNoteClick({ page, x, y, note, showName }) {
			// Liegt ein Stempel bereit, setzt der Tipp ihn - und springt nicht
			// zusaetzlich dorthin.
			if (this.annotations.armedStamp) {
				if (this.performance.can('annotate')) {
					this.annotations.placeArmedStamp({ page, x, y })
				}
				return
			}
			// Im Aufführungsmodus der haeufigste Fehlgriff ueberhaupt: ein Tipp
			// auf die Noten, um zu blaettern.
			if (!this.session.timeline || !this.session.clock || !this.performance.can('noteClick')) {
				return
			}
			const elid = findElementAtPoint(this.session.timeline.elements, page, x, y)
			if (elid === null) {
				return
			}
			// Bezugspunkt ist die gehörte Stelle: Getippt wird auf das, was
			// gerade klingt, nicht auf das, was schon im Ausgabepuffer steht.
			const timeMs = findNearestOccurrenceTimeMs(this.session.timeline.events, elid, this.playback.displayTimeMs)
			if (timeMs !== null) {
				this.followNavigation('noteClick')
				this.session.clock.seek(timeMs)
			}
			if (note) {
				this.playTappedNote(note, showName)
			}
		},

		// --- Leiste -----------------------------------------------------------

		/**
		 * Das Mausrad hat zwei Bedeutungen: mit Strg zoomt es (useZoom), ohne
		 * ist es gewoehnliches Scrollen - und damit ein Nutzereingriff, der
		 * das automatische Nachfuehren pausieren muss.
		 *
		 * @param {WheelEvent} event
		 */
		onViewerWheel(event) {
			if (!event.ctrlKey) {
				this.autoScroller.noteManualScroll()
				return
			}
			// The score zooms, not the Nextcloud page around it.
			event.preventDefault()
			this.display.activeZoom.wheel(event)
		},

		/**
		 * The lyrics view scrolls the viewer's element, so only it learns
		 * here that its syllable may have left the screen. Pages measure in
		 * useAutoScroll, the band in its own scroller.
		 */
		onViewerScrollEnd() {
			this.autoScroller.onScrollEnd()
			if (!this.prefs.autoScroll && this.display.activeLayout === 'lyrics') {
				this.$refs.lyrics?.reportVisibility()
			}
		},

		/**
		 * The layout on screen behind one shape: back to the playing
		 * position, one step on and back. The band steps by system (H8),
		 * pages and lyrics scroll by a screen.
		 *
		 * @return {{reveal: () => void, next: () => void, previous: () => void}}
		 */
		activeView() {
			const pages = { next: () => this.paging.page(1), previous: () => this.paging.page(-1) }
			switch (this.display.activeLayout) {
				case 'band': return {
					reveal: () => this.$refs.band?.reveal(),
					next: () => this.$refs.band?.next(),
					previous: () => this.$refs.band?.previous(),
				}
				case 'lyrics': return { ...pages, reveal: () => this.$refs.lyrics?.reveal() }
				default: return { ...pages, reveal: () => this.autoScroller.update(this.session.cursorRect, true) }
			}
		},

		/** To the playing position, whatever the layout - the button and the switch. */
		revealCursor() {
			this.activeView().reveal()
		},
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>

<style src="./boundedPopover.css"></style>

<style scoped>
/*
 * Flex-Spalte statt eines einzigen scrollenden Kastens: die Leiste ist ein
 * Geschwister des Scroll-Elements, kein sticky Kind darin. Damit kann sie
 * nicht wegscrollen, und die Panels lassen sich über dem Notenbild
 * platzieren, statt es nach unten zu schieben.
 */
.scoreview-viewer {
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	box-sizing: border-box;
	background: var(--color-main-background);
	/* No browser pinch zoom anywhere in the viewer, not only over the pages
	 * (see .scoreview-pages): iOS Safari ignores user-scalable=no, and a pinch
	 * that starts on the bar enlarges the whole Nextcloud page. Autoscroll
	 * only knows its own scroll container, so it then stops following
	 * sideways while the score runs off the screen (issue #13). Repeated on
	 * every own scroll container below rather than trusting the ancestor
	 * intersection to cross them. */
	touch-action: pan-x pan-y;
}

/* Fullscreen inside the page (useZoom.js, issue #20): above Nextcloud's
 * header and the Files viewer's modal, the whole window. dvh, not vh: on
 * phones vh counts the browser's bars as if they were gone.
 * The z-index competes inside the viewer's .modal-mask (9998), not with the
 * page: NcModal puts its header at 10001 and the file arrows at 10000 there.
 * Below them, the header covered the top row of the bar on the iPhone, and
 * only its ✕ still answered (issue #15). */
.scoreview-viewer--page-fullscreen {
	position: fixed;
	inset: 0;
	z-index: 10010;
	height: 100dvh;
}

.scoreview-mixer-mypart {
	margin: 0 0 4px;
	font-weight: bold;
}

/*
 * Touch-Zielgroessen (">= 44px") - gemessen statt angenommen:
 * Nextclouds eigenes --default-clickable-area liegt in dieser Instanz bei
 * 34px, NICHT bei 44px. NcButton liest diese Variable zur Laufzeit
 * (--button-size: var(--default-clickable-area)) - ein Override hier auf
 * dem gemeinsamen Wurzelelement wirkt dadurch auf alle NcButtons in
 * dieser Komponente UND in ScoreMixer.vue/ScoreAnnotations.vue
 * (CSS-Variablen vererben sich durchs echte DOM, unabhaengig von Vues
 * Style-Scoping-Grenzen). Nur unter (pointer: coarse) (Touch-Geraete),
 * damit die Maus-Bedienung auf dem Desktop kompakt bleibt.
 */
@media (pointer: coarse) {
	.scoreview-viewer {
		--default-clickable-area: 44px;
	}

	/* Range-Regler (Seek/Tempo/Zoom) haben keine eigene NcButton-Variable -
	   der Daumen wird hier direkt vergroessert. */
	.scoreview-viewer input[type="range"]::-webkit-slider-thumb {
		width: 24px;
		height: 24px;
	}

	.scoreview-viewer input[type="range"]::-moz-range-thumb {
		width: 24px;
		height: 24px;
	}
}

.scoreview-hint {
	margin-bottom: 8px;
}

.scoreview-status-host {
	position: relative;
}

.scoreview-close--status {
	position: absolute;
	inset-block-start: 4px;
	inset-inline-end: 8px;
}

.scoreview-body {
	position: relative;
	flex: 1 1 auto;
	/* Ohne min-height: 0 wächst ein Flex-Kind mit überlangem Inhalt über den
	   Container hinaus, statt zu scrollen. */
	min-height: 0;
}

.scoreview-scroll {
	height: 100%;
	/* Senkrecht IMMER mit Balken: sonst ändert sich die verfügbare Breite in
	   dem Moment, in dem der Inhalt hoch genug wird - und der an die Breite
	   gekoppelte Zoom (setUpViewportObserver) würde sich selbst anstoßen. */
	overflow-y: scroll;
	overflow-x: auto;
	box-sizing: border-box;
	padding: 12px;
	/* See .scoreview-viewer - also covers the lyrics view, which scrolls here. */
	touch-action: pan-x pan-y;
}

/*
 * The band fills what the hints above it leave (F2): it scrolls by itself,
 * and with `height: 100%` below a hint its lowest staves fell off the screen.
 */
.scoreview-body--sing {
	display: flex;
	flex-direction: column;
}

.scoreview-body--sing > .scoreview-scroll {
	flex: 1 1 0;
	height: auto;
	min-height: 0;
}

.scoreview-scroll--band {
	display: flex;
	flex-direction: column;
	overflow-y: hidden;
}

.scoreview-scroll--band > .scoreview-hint {
	flex: 0 0 auto;
}

.scoreview-scroll--band > .scoreview-band {
	flex: 1 1 0;
	height: auto;
	min-height: 0;
}

/*
 * Block statt Flex-Spalte: eine Seite kann breiter als der Container sein
 * (Zoom, siehe ScorePage.vue). In einer zentrierenden Flex-Spalte wäre der
 * überstehende linke Teil nicht mehr erreichbar - bei einem Blockelement
 * mit `margin: 0 auto` fällt die Zentrierung im Überlauf einfach weg, und
 * der Scrollbereich deckt die ganze Seite ab.
 */
.scoreview-pages {
	display: block;
	/* The browser's own pinch zoom would enlarge the whole Nextcloud page;
	 * here two fingers zoom the score (useZoom.js). Declared in CSS instead
	 * of preventDefault() so the touch listeners can be passive - a
	 * non-passive touchmove made every one-finger scroll over the score wait
	 * for the main thread. The rest of the viewer has the same rule (see
	 * .scoreview-viewer); here it is the one that matters, because two
	 * fingers on the pages are the app's own zoom gesture. */
	touch-action: pan-x pan-y;
}

/*
 * Two pages side by side (A2, lib/spreadLayout.js): a grid of two
 * columns as wide as the pages. `safe center` for the same reason the
 * single column is a block - zoomed beyond the pair, the row overflows,
 * and plain centring would push its left part out of reach. ScorePage
 * keeps its width and aspect ratio; only its margin goes, the grid gap
 * (SPREAD_GAP_PX) takes over.
 */
.scoreview-pages--spread {
	display: grid;
	grid-template-columns: repeat(2, max-content);
	justify-content: safe center;
	gap: 16px;
}

.scoreview-pages--spread > :deep(.score-page) {
	margin: 0;
}

/* Page 1 alone on the right, like the first page of a booklet. */
.scoreview-pages--first-right > :deep(.score-page:first-child) {
	grid-column: 2;
}

/*
 * Over the score like the badge below, at the bottom corner where it covers
 * the least of what is being read.
 */
.scoreview-back-to-cursor {
	position: absolute;
	bottom: 16px;
	inset-inline-end: 24px;
	z-index: 15;
}

/*
 * Die Anzeige von „Folgt mir" liegt ueber dem Notenbild (FollowBadge.vue) -
 * oben am Rand, unter den Panels: Ein offener Mixer ist eine bewusste
 * Handlung und darf sie ueberdecken, das Notenbild nicht.
 */
.scoreview-follow {
	position: absolute;
	top: 6px;
	inset-inline-start: 12px;
	z-index: 15;
}

/* Der Hinweis „Leitung ist weiter" unter der Anzeige von „Folgt mir". */
.scoreview-follow-moved {
	position: absolute;
	top: 48px;
	inset-inline-start: 12px;
	z-index: 15;
	max-width: min(90%, 28em);
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

<style>
/*
 * iOS zooms the whole page into any field that gets focus with a font smaller
 * than 16px, and does not zoom back out - NcTextField brings 15px. Afterwards
 * the score is wider than the screen while autoscroll, which only knows its
 * own scroll container, sees nothing to follow (issue #13).
 *
 * Not scoped, because two of the places are not in this component's DOM:
 * NcPopover (loop, speed trainer) and NcModal (setlist editor) mount on
 * <body>. Every selector is tied to an own class, so nothing outside the app
 * is touched. `any-pointer` rather than `pointer`: an iPad with a trackpad
 * reports a fine primary pointer and zooms all the same. The input types are
 * listed instead of excluded, so a future slider or colour picker does not
 * pick the rule up.
 */
@media (any-pointer: coarse) {
	:is(.scoreview-viewer, .scoreview-popover, .scoreview-setlist-editor)
		:is(input:not([type]), input[type="text"], input[type="number"], input[type="search"], textarea) {
		font-size: 16px;
	}
}

/*
 * Nextcloud's Viewer keeps a header's height free below every file
 * (`.viewer .modal-wrapper .modal-container { bottom: var(--header-height) }`),
 * and through it the file list showed. On a phone held sideways that is 50 of
 * 325 px. A score has nothing to put there, so its viewer reaches the bottom.
 * Tied by :has() to this app's own root, so other files keep the Viewer's
 * layout; one class more than the Viewer's rule, not !important.
 */
.viewer.modal-mask .modal-wrapper .modal-container:has(> .modal-container__content .scoreview-viewer) {
	bottom: 0;
}

/*
 * @nextcloud/dialogs 8 moves its toasts past the app navigation while it
 * believes that is open, and believes so unless it finds
 * `.app-navigation--closed`. Files on a phone marks its collapsed navigation
 * `app-navigation--close`, so the lock-screen hint (useMediaSession.js) sat
 * 300 px in and ran off a 412 px screen. Below Nextcloud's mobile breakpoint
 * the navigation always overlays the content, so the offset is never right
 * there. The class is a CSS-module name; matching its stable part keeps this
 * working across dialogs builds, and `body` outranks the module's own rule.
 */
@media (max-width: 1024px) {
	body [class*="_toastContainer_navOpen_"] {
		inset-inline-start: var(--body-container-margin);
	}
}
</style>
