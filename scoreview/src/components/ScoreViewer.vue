<template>
	<!--
		Die Hervorhebungsfarbe haengt als CSS-Variable an der Wurzel, nicht an
		jeder Seite: ScorePage.vue erbt sie ueber die Kaskade, auch in das per
		v-html eingesetzte SVG hinein (Scoped-CSS greift dort nicht, geerbte
		Custom Properties schon). Aendert die Nutzerin die Farbe, faerbt sich
		damit alles Gefaerbte in einem Rutsch um - ohne dass eine einzige Seite
		neu rendern muss.
	-->
	<div ref="root" class="scoreview-viewer" :style="highlightStyle">
		<!--
			Die Setliste steht ueber allem, auch ueber „Wird konvertiert…" und
			einem Fehler: Im Konzert muss es auch an einem Stueck vorbei
			weitergehen, das gerade nicht geht.
		-->
		<SetlistBar
			:active="setlistActive"
			:title="setlistTitle"
			:entries="setlistEntries"
			:index="setlistIndex"
			:position="setlistPosition"
			:canEdit="setlistCanEdit"
			:canNavigate="can('nextPiece')"
			:canManage="can('settings')"
			:offers="setlistOffers"
			:offerDismissed="setlistOfferDismissed"
			@previous="onSetlistPrevious"
			@next="onSetlistNext"
			@goTo="onSetlistGoTo"
			@edit="openSetlistEditor('edit')"
			@close="closeSetlist"
			@accept="acceptSetlistOffer"
			@dismiss="setlistOfferDismissed = true" />
		<NcNoteCard v-if="setlistError" type="error" class="scoreview-hint">
			{{ setlistError }}
		</NcNoteCard>
		<ScoreStatus
			v-if="state === 'converting' || state === 'loading' || state === 'error'"
			:state="state"
			:clientProgress="clientProgress"
			:longWait="longWait"
			:errorText="errorText"
			:errorCode="errorCode"
			:errorMessage="errorMessage" />
		<template v-else>
			<!--
				Die Leiste: Wie sie steht (eingefahren, kompakt, Werkzeuge auf
				Abruf), regeln ScoreBar.vue und useBarLayout.js; was darin
				steht, ist hier verdrahtet.
			-->
			<ScoreBar
				v-model:toolsOpen="toolsOpen"
				:collapsed="barCollapsed"
				:compact="compactBar"
				:anyToolActive="anyToolActive"
				:readProgress="readPlaybackPercent"
				@show="showBar"
				@activity="scheduleBarCollapse">
				<template #transport>
					<NcButton
						class="scoreview-play"
						variant="primary"
						:disabled="!can('play')"
						:aria-label="isPlaying ? t('Pause') : t('Play')"
						:title="isPlaying ? t('Pause') : t('Play')"
						@click="onPlayClick">
						<template #icon>
							<Pause v-if="isPlaying" :size="20" />
							<Play v-else :size="20" />
						</template>
					</NcButton>
					<!-- Die Zeit liest nur LiveValue: sonst rendert der ganze
						Viewer in jedem Frame neu (siehe LiveValue.vue). -->
					<LiveValue v-slot="{ value }" :get="() => displayTimeMs">
						<input
							type="range"
							class="scoreview-seek"
							min="0"
							:max="durationMs"
							:value="value"
							:disabled="!can('seek')"
							:aria-label="t('Playback position')"
							@input="onSeekBarInput">
						<span class="scoreview-time">{{ formatTime(value) }} / {{ formatTime(durationMs) }}</span>
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
						<span class="scoreview-measure-field" :class="{ 'scoreview-measure-field--marks': rehearsalMarks.length > 0 }">
							<NcTextField
								v-model="measureInput"
								:type="rehearsalMarks.length > 0 ? 'text' : 'number'"
								min="1"
								:label="t('Measure')"
								:title="rehearsalMarks.length > 0
									? t('Measure – enter a number or a rehearsal mark (C, C+3) and press Enter to jump there')
									: t('Measure – enter a number and press Enter to jump there')"
								:disabled="!can('seek')"
								labelOutside
								@focus="onMeasureFieldFocus"
								@blur="onMeasureFieldBlur"
								@keyup.enter="jumpToMeasureInput" />
						</span>
						<span class="scoreview-measure-total">/ {{ totalMeasures || '–' }}</span>
					</span>
					<!--
						Der Aufklapper „Navigation": die Studierbuchstaben als Chips.
						Als Aufklapper statt als Leiste, weil die Leiste auf
						Telefonbreite keinen Platz fuer eine zweite Reihe hat; und nur,
						wenn die Partitur welche traegt.
					-->
					<NcPopover v-if="rehearsalMarks.length > 0 && can('seek')" v-model:shown="marksOpen">
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
									v-for="mark in rehearsalMarks"
									:key="mark.text"
									class="scoreview-mark-chip"
									:aria-label="t('Go to rehearsal mark {mark} (measure {n})', { mark: mark.text, n: mark.measure })"
									:title="t('Measure {n}', { n: mark.measure })"
									@click="jumpToMark(mark)">
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
						v-if="can('tone')"
						:mode="startToneMode"
						:sounding="startToneSounding"
						:toneName="startToneName"
						:unavailableReason="startToneUnavailable"
						@press="pressStartTone"
						@release="releaseStartTone" />
					<ScoreLockButton
						:active="performanceMode"
						:progress="performanceExitProgress"
						@down="lockDown"
						@cancel="cancelLockHold"
						@lockKeydown="lockKeydown"
						@lockKeyup="lockKeyup" />
					<!--
						Der rote Punkt: im Transport, nicht in den
						Werkzeugen - er muss auch im Aufführungsmodus und bei
						eingefahrenen Werkzeugen sichtbar und antippbar bleiben.
					-->
					<MicIndicator v-if="micActive" :consumers="micConsumers" @off="turnMicOff" />
				</template>
				<template #tools>
					<!--
						Im Aufführungsmodus bleiben nur Zoom und Vollbild;
						was gesperrt ist, verschwindet, statt ausgegraut
						dazustehen - ein grauer Knopf laedt zum Antippen ein.
					-->
					<NcPopover v-if="can('loop')">
						<template #trigger>
							<NcButton :pressed="loopActive" :aria-label="t('Loop')" :title="loopActive ? t('Loop on') : t('Loop off')">
								<template #icon>
									<Repeat :size="20" />
								</template>
							</NcButton>
						</template>
						<template #default>
							<div class="scoreview-popover">
								<div class="scoreview-popover-row">
									<NcTextField
										v-model.number="loopFromMeasure"
										type="number"
										min="1"
										:label="t('From measure')" />
									<NcTextField
										v-model.number="loopToMeasure"
										type="number"
										min="1"
										:label="t('To measure')" />
								</div>
								<NcButton wide :aria-label="t('Loop from current measure')" @click="setLoopFromMeasure(currentAnchor?.measureNumber)">
									<template #icon>
										<CrosshairsGps :size="20" />
									</template>
									{{ t('Loop from current measure') }}
								</NcButton>
								<NcButton
									wide
									:pressed="loopActive"
									:aria-label="loopActive ? t('Loop on') : t('Loop off')"
									@click="onToggleLoop">
									<template #icon>
										<Repeat :size="20" />
									</template>
									{{ loopActive ? t('Loop on') : t('Loop off') }}
								</NcButton>
								<ScoreSpeedTrainer
									v-if="loopActive && hasRealPlayer"
									v-model:startBpm="trainerStartBpm"
									v-model:targetBpm="trainerTargetBpm"
									v-model:stepBpm="trainerStepBpm"
									:minBpm="minTempoBpm"
									:maxBpm="maxTempoBpm"
									:active="trainerActive"
									:passes="trainerPasses"
									:currentBpm="effectiveTempoBpm"
									@toggle="toggleSpeedTrainer" />
							</div>
						</template>
					</NcPopover>
					<TempoPopover
						v-if="can('settings')"
						v-model:metronomeBeats="metronomeBeats"
						:hasRealPlayer="hasRealPlayer"
						:effectiveTempoBpm="effectiveTempoBpm"
						:tempoGuessed="tempoGuessed"
						:minTempoBpm="minTempoBpm"
						:maxTempoBpm="maxTempoBpm"
						:audioOffsetMs="audioOffsetMs"
						:readAutomaticLatencyMs="readAutomaticLatencyMs"
						@tempoInput="onTempoBpmInput"
						@audioOffsetInput="onAudioOffsetInput" />
					<NcButton
						v-if="can('settings')"
						:pressed="metronomeEnabled"
						:aria-label="metronomeEnabled ? t('Metronome on') : t('Metronome off')"
						:title="metronomeEnabled ? t('Metronome on') : t('Metronome off')"
						@click="metronomeEnabled = !metronomeEnabled">
						<template #icon>
							<Metronome :size="20" />
						</template>
					</NcButton>
					<!--
						Welcher Ton der Anfangston ist: der eigene oder der
						Grundton. Beschriftet statt nur ein Symbol - an diesem
						Knopf entscheidet sich, was man gleich hoert.
					-->
					<NcButton
						v-if="hasRealPlayer && can('tone')"
						class="scoreview-tone-mode"
						:aria-label="startToneMode === 'tonic' ? t('Starting note: key note of the current key. Switch to my voice') : t('Starting note: my voice. Switch to the key note')"
						:title="startToneMode === 'tonic' ? t('Starting note: key note of the current key. Switch to my voice') : t('Starting note: my voice. Switch to the key note')"
						@click="toggleStartToneMode">
						{{ startToneMode === 'tonic' ? t('Key note') : t('My note') }}
					</NcButton>
					<ZoomPopover
						:zoom="zoom"
						:percent="zoomPercent"
						:min="minZoom"
						:max="maxZoom"
						@input="onZoomInput"
						@preset="applyZoomPreset" />
					<AppearancePopover
						v-if="can('settings')"
						v-model:highlightMode="highlightMode"
						v-model:highlightColor="highlightColor"
						v-model:noteTheme="noteTheme"
						:rendererBackend="rendererBackend"
						:mscoreVersion="mscoreVersion"
						:canReconvert="canReconvert"
						:readDiagnostics="readAudioDiagnostics"
						@reconvert="reconvertScore" />
					<NcButton
						v-if="hasRealPlayer && can('mixer')"
						:pressed="showMixer"
						:aria-label="t('Mixer')"
						:title="t('Mixer')"
						@click="showMixer = !showMixer">
						<template #icon>
							<Tune :size="20" />
						</template>
					</NcButton>
					<!--
						Erscheint nur, wenn eine Stimme als „meine" gewaehlt ist UND
						sich die Notenzeilen den Stimmen ueberhaupt zuordnen lassen -
						sonst waere es ein Schalter, der nichts tut oder, schlimmer,
						die falsche Zeile markiert (siehe lib/staffBands.js).
					-->
					<NcButton
						v-if="canFocusMyPart && can('settings')"
						:pressed="focusMyPart"
						:aria-label="t('Show only my part')"
						:title="t('Show only my part')"
						@click="focusMyPart = !focusMyPart">
						<template #icon>
							<FormatAlignMiddle :size="20" />
						</template>
					</NcButton>
					<NcButton
						v-if="can('settings')"
						:pressed="showNoteText"
						:aria-label="t('Show notes in the score')"
						:title="t('Show notes in the score')"
						@click="showNoteText = !showNoteText">
						<template #icon>
							<CommentTextOutline :size="20" />
						</template>
					</NcButton>
					<NcButton
						v-if="can('annotate')"
						:pressed="showAnnotations"
						:aria-label="t('Notes')"
						:title="t('Notes')"
						@click="showAnnotations = !showAnnotations">
						<template #icon>
							<NotebookOutline :size="20" />
						</template>
					</NcButton>
					<!--
						Aufnahme und Intonation - nur, wenn die
						Administration eine der beiden eingeschaltet hat.
					-->
					<NcButton
						v-if="(recordingEnabled || intonationEnabled) && can('settings')"
						:pressed="showPractice"
						:aria-label="t('Recording and intonation')"
						:title="t('Recording and intonation')"
						@click="showPractice = !showPractice">
						<template #icon>
							<Microphone :size="20" />
						</template>
					</NcButton>
					<!--
						Unter 'settings', weil Ernennen und Abberufen verwalten und
						nichts mit dem Musizieren selbst zu tun haben - im
						Aufführungsmodus also gesperrt wie die anderen Werkzeuge.
					-->
					<NcButton
						v-if="can('settings')"
						:pressed="showRehearsal"
						:aria-label="t('Rehearsal')"
						:title="t('Rehearsal')"
						@click="showRehearsal = !showRehearsal">
						<template #icon>
							<AccountGroup :size="20" />
						</template>
					</NcButton>
					<!--
						„Neue Setliste" im Ordner der offenen Partitur
						(E11) - nur, wo dort angelegt werden darf.
						Bearbeiten sitzt an der Setlisten-Leiste selbst.
					-->
					<NcButton
						v-if="can('settings') && setlistCanCreate"
						:pressed="setlistEditorMode === 'new'"
						:aria-label="t('New setlist')"
						:title="t('New setlist')"
						@click="openSetlistEditor('new')">
						<template #icon>
							<PlaylistPlus :size="20" />
						</template>
					</NcButton>
					<!--
						Ein Knopf, der nichts tut, ist schlimmer als keiner: In der
						WebView der mobilen Nextcloud-App ist die Vollbild-API
						abgeschaltet (gemessen: document.fullscreenEnabled = false),
						und dort ist die Ansicht ohnehin schon Vollbild.
					-->
					<NcButton
						v-if="fullscreenPossible"
						:pressed="isFullscreen"
						:aria-label="isFullscreen ? t('Exit fullscreen') : t('Fullscreen')"
						:title="isFullscreen ? t('Exit fullscreen') : t('Fullscreen')"
						@click="toggleFullscreen">
						<template #icon>
							<FullscreenExit v-if="isFullscreen" :size="20" />
							<Fullscreen v-else :size="20" />
						</template>
					</NcButton>
				</template>
			</ScoreBar>
			<div class="scoreview-body">
				<!--
					„Folgt mir": wer leitet, ob dieses Geraet folgt, ob die
					Verbindung steht - ueber den Noten, damit es keine Hoehe kostet
					und im Aufführungsmodus sichtbar bleibt.
				-->
				<FollowBadge
					v-if="followActive"
					class="scoreview-follow"
					:leaderName="followLeaderName"
					:mine="followMine"
					:detached="!followFollowing"
					:offline="!followConnected"
					@resume="resumeFollow" />
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
					es nie und die Frist laeuft wie zuvor ab dem Loslassen.
				-->
				<div
					ref="scroll"
					class="scoreview-scroll"
					@pointerdown.passive="onScrollGestureStart"
					@pointerup.passive="onScrollGestureEnd"
					@pointercancel.passive="onScrollGestureEnd"
					@touchstart.passive="onScrollGestureStart"
					@touchend.passive="onScrollGestureEnd"
					@touchcancel.passive="onScrollGestureEnd"
					@scrollend.passive="noteManualScroll"
					@wheel="onViewerWheel">
					<NcNoteCard v-if="soundFontLoading" type="info" class="scoreview-hint">
						{{ t('Loading sound ({percent}%)…', { percent: soundFontLoadPercent }) }}
						<NcButton @click="skipSoundFontLoad">
							{{ t('Continue without sound') }}
						</NcButton>
					</NcNoteCard>
					<NcNoteCard v-else-if="!hasRealPlayer" type="warning" class="scoreview-hint">
						{{ t('No sound: {reason}', { reason: playbackError || t('Playback is not available.') }) }}
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
					<div
						class="scoreview-pages"
						@touchstart="onTouchStart"
						@touchmove="onTouchMove"
						@touchend="onTouchEnd">
						<ScorePage
							v-for="(url, i) in pageUrls"
							:key="url"
							:ref="(el) => setPageRef(el, i)"
							:svgUrl="url"
							:pageIndex="i"
							:cursorRect="cursorRect"
							:cursorElid="currentElid"
							:zoom="zoom"
							:markers="annotationMarkers"
							:stamps="annotationStamps"
							:loopMarkers="loopMarkers"
							:systemRects="systemRectsByPage[i] ?? NO_RECTS"
							:myPartIndex="myPartIndex"
							:focusMyPart="focusMyPart"
							:partCount="partCount"
							:showNoteText="showNoteText"
							:highlightMode="highlightMode"
							:noteTheme="resolvedNoteTheme"
							:noteMarks="intonationMarks"
							:liveNoteMarks="intonationLiveMarks"
							:needle="intonationNeedle"
							@noteClick="onNoteClick"
							@markerClick="onMarkerClick"
							@staffMapping="onStaffMapping"
							@loaded="onPageLoaded" />
					</div>
				</div>
				<!--
					Mixer und Notizen liegen als Karten UEBER dem Notenbild statt
					davor im Fluss: im Fluss kosteten sie Hoehe, sobald sie offen
					waren, und waren nur ganz oben zu sehen. Als Overlay kosten sie
					nichts, wenn sie zu sind, und bleiben erreichbar, wo immer man
					gerade liest.
				-->
				<div v-if="showMixerPanel || showAnnotations || showRehearsal || showPractice || armedStamp || setlistEditorMode" class="scoreview-panels">
					<!--
						Ein Stempel wartet auf den Tipp ins Notenbild. Das
						Notizen-Panel ist dafuer zu - es laege sonst ueber den Noten,
						in die getippt werden soll -, und dieser Hinweis sagt, was
						der naechste Tipp tut und wie man es laesst.
					-->
					<ScorePanel v-if="armedStamp" class="scoreview-armed">
						<span>{{ t('Tap the score where the {stamp} belongs.', { stamp: armedStampName }) }}</span>
						<NcButton :aria-label="t('Cancel')" @click="disarmStamp">
							<template #icon>
								<Close :size="20" />
							</template>
							{{ t('Cancel') }}
						</NcButton>
					</ScorePanel>
					<ScorePanel
						v-if="setlistEditorMode"
						:title="setlistEditorMode === 'new' ? t('New setlist') : t('Edit setlist')"
						@close="setlistEditorMode = null">
						<SetlistEditor
							:key="setlistEditorMode + ':' + (setlist?.etag ?? '')"
							:mode="setlistEditorMode"
							:setlist="setlist"
							:scoreFileId="standalonePage ? fileid : activeFileId"
							:folderFileId="setlistFolderFileId"
							:withoutFilePicker="standalonePage"
							:noAdding="standalonePage && setlistEditorMode !== 'new'"
							@saved="onSetlistSaved"
							@cancel="setlistEditorMode = null" />
					</ScorePanel>
					<ScorePanel v-if="showMixerPanel" :title="t('Mixer')" @close="showMixer = false">
						<!--
							Der Anfangston kam ohne gewaehlte Stimme hierher:
							Er raet nicht, sondern sagt, wo man sie waehlt.
						-->
						<NcNoteCard v-if="startToneNeedsPart" type="info">
							{{ t('Choose your voice first: tap the voice symbol next to your part.') }}
						</NcNoteCard>
						<NcCheckboxRadioSwitch v-model="stereoMyPart" type="switch">
							{{ t('My voice on the right, the others on the left') }}
						</NcCheckboxRadioSwitch>
						<ScoreMixer
							:channels="mixerChannels"
							:presetList="presetList"
							:myPartId="myPartId"
							@volumesChanged="onVolumesChanged"
							@programChanged="onProgramChanged"
							@focusChanged="onMyPartChanged" />
					</ScorePanel>
					<ScorePanel v-if="showAnnotations" :title="t('Notes')" @close="showAnnotations = false">
						<ScoreAnnotations
							:annotations="listedAnnotations"
							:currentAnchor="readCurrentAnchor"
							:error="annotationError"
							:isLeader="isLeader"
							:parts="scoreParts"
							:armedStamp="armedStamp ? armedStamp.stamp : null"
							@create="onAnnotationCreate"
							@update="onAnnotationUpdate"
							@delete="onAnnotationDelete"
							@jumpTo="onAnnotationJumpToOwn"
							@armStamp="onArmStamp" />
					</ScorePanel>
					<!--
						Eigene Aufnahmen und Intonation. Bleibt waehrend
						des Aufnehmens offen stehen - dort sitzt der Stopp-Knopf.
					-->
					<ScorePanel v-if="showPractice" :title="t('Recording and intonation')" @close="showPractice = false">
						<RecordingPanel
							v-model:withAccompaniment="recordWithAccompaniment"
							v-model:countIn="recordCountIn"
							v-model:recordingVolume="recordingVolume"
							v-model:accompanimentVolume="accompanimentVolume"
							:recordingEnabled="recordingEnabled"
							:intonationEnabled="intonationEnabled"
							:hasRealPlayer="hasRealPlayer"
							:recordings="recordings"
							:phase="recordPhase"
							:elapsedMs="recordElapsedMs"
							:confirmReplace="recordConfirmReplace"
							:maxPerScore="maxRecordingsPerScore"
							:pending="recordPending"
							:listening="recordListening"
							:error="recordError"
							:micError="micError"
							:browserUrl="browserUrl"
							:live="intonationLive"
							:needPart="intonationNeedPart"
							:analysis="intonationAnalysis"
							:analyzing="intonationAnalyzing"
							:progress="intonationProgress"
							:intonationError="intonationError"
							@start="startRecording()"
							@stop="stopRecording"
							@replace="answerRecordReplace"
							@retry="retryRecordSave"
							@discard="discardPendingRecording"
							@listen="onListenRecording"
							@stopListening="stopListeningRecording"
							@delete="removeRecording"
							@analyze="onAnalyzeRecording"
							@toggleLive="onToggleLiveIntonation"
							@clearAnalysis="clearIntonationAnalysis"
							@jump="onPracticeJump" />
					</ScorePanel>
					<!--
						Der Aufklapper „Probe": die Leitungen - hier sammelt
						sich, was eine Probe organisiert, statt jedes Stueck davon
						als eigenen Knopf in die Leiste zu setzen.
					-->
					<ScorePanel v-if="showRehearsal" :title="t('Rehearsal')" @close="showRehearsal = false">
						<LeaderPanel
							:leaders="leaders"
							:isLeader="isLeader"
							:candidates="leaderCandidates"
							:error="leaderError"
							:followEnabled="followEnabled"
							:followActive="followActive"
							:followMine="followMine"
							:followLeaderName="followLeaderName"
							:followBusy="followBusy"
							:followError="followError"
							:marks="rehearsalMarks"
							:loopActive="loopActive"
							@appoint="onLeaderAppoint"
							@revoke="onLeaderRevoke"
							@search="onLeaderSearch"
							@followStart="startFollow"
							@followEnd="endFollow"
							@followPosition="sendFollowPosition()"
							@followMark="sendFollowMark"
							@followLoop="sendFollowLoop"
							@followTone="sendFollowTone" />
					</ScorePanel>
				</div>
			</div>
		</template>
	</div>
</template>

<script>
import { loadState } from '@nextcloud/initial-state'
import { translate } from '@nextcloud/l10n'
import { getRootUrl } from '@nextcloud/router'
import { computed, getCurrentInstance, nextTick, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcPopover from '@nextcloud/vue/components/NcPopover'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import AccountGroup from 'vue-material-design-icons/AccountGroup.vue'
import BookmarkOutline from 'vue-material-design-icons/BookmarkOutline.vue'
import Close from 'vue-material-design-icons/Close.vue'
import CommentTextOutline from 'vue-material-design-icons/CommentTextOutline.vue'
import CrosshairsGps from 'vue-material-design-icons/CrosshairsGps.vue'
import FormatAlignMiddle from 'vue-material-design-icons/FormatAlignMiddle.vue'
import Fullscreen from 'vue-material-design-icons/Fullscreen.vue'
import FullscreenExit from 'vue-material-design-icons/FullscreenExit.vue'
import Metronome from 'vue-material-design-icons/Metronome.vue'
import Microphone from 'vue-material-design-icons/Microphone.vue'
import NotebookOutline from 'vue-material-design-icons/NotebookOutline.vue'
import Pause from 'vue-material-design-icons/Pause.vue'
import Play from 'vue-material-design-icons/Play.vue'
import PlaylistPlus from 'vue-material-design-icons/PlaylistPlus.vue'
import Repeat from 'vue-material-design-icons/Repeat.vue'
import Tune from 'vue-material-design-icons/Tune.vue'
import AppearancePopover from './AppearancePopover.vue'
import FollowBadge from './FollowBadge.vue'
import LeaderPanel from './LeaderPanel.vue'
import LiveValue from './LiveValue.vue'
import MicIndicator from './MicIndicator.vue'
import RecordingPanel from './RecordingPanel.vue'
import ScoreAnnotations from './ScoreAnnotations.vue'
import ScoreBar from './ScoreBar.vue'
import ScoreLockButton from './ScoreLockButton.vue'
import ScoreMixer from './ScoreMixer.vue'
import ScorePage from './ScorePage.vue'
import ScorePanel from './ScorePanel.vue'
import ScoreSpeedTrainer from './ScoreSpeedTrainer.vue'
import { stampName } from './ScoreStamps.vue'
import ScoreStartTone from './ScoreStartTone.vue'
import ScoreStatus from './ScoreStatus.vue'
import SetlistBar from './SetlistBar.vue'
import SetlistEditor from './SetlistEditor.vue'
import TempoPopover from './TempoPopover.vue'
import ZoomPopover from './ZoomPopover.vue'
import { useAnnotations } from '../composables/useAnnotations.js'
import { useAutoScroll } from '../composables/useAutoScroll.js'
import { useBarLayout } from '../composables/useBarLayout.js'
import { useConversionStatus } from '../composables/useConversionStatus.js'
import { useFollowSession } from '../composables/useFollowSession.js'
import { useIntonation } from '../composables/useIntonation.js'
import { useLeaders } from '../composables/useLeaders.js'
import { useLoop } from '../composables/useLoop.js'
import { useMeasureNavigation } from '../composables/useMeasureNavigation.js'
import { useMetronome } from '../composables/useMetronome.js'
import { useMicrophone } from '../composables/useMicrophone.js'
import { useMyPart } from '../composables/useMyPart.js'
import { useMyPartSound } from '../composables/useMyPartSound.js'
import { usePaging } from '../composables/usePaging.js'
import { usePerformanceMode } from '../composables/usePerformanceMode.js'
import { usePlayback } from '../composables/usePlayback.js'
import { useRecorder } from '../composables/useRecorder.js'
import { useScoreFacts } from '../composables/useScoreFacts.js'
import { NO_RECTS, useScoreSession } from '../composables/useScoreSession.js'
import { useSetlist } from '../composables/useSetlist.js'
import { useSpeedTrainer } from '../composables/useSpeedTrainer.js'
import { useStartTone } from '../composables/useStartTone.js'
import { useViewerPreferences } from '../composables/useViewerPreferences.js'
import { useWakeLock } from '../composables/useWakeLock.js'
import { useZoom } from '../composables/useZoom.js'
import { normalizeFeatures } from '../lib/featureFlags.js'
import { resolveKey } from '../lib/keyMap.js'
import { browserFileUrl } from '../lib/micAccess.js'
import { channelsOfPart } from '../lib/panLayout.js'
import {
	findElementAtPoint,
	findNearestOccurrenceTimeMs,
	resolveMeasurePosition,
} from '../lib/scoreLayout.js'
import { MODE_TONIC, MODE_VOICE } from '../lib/startTone.js'
import { formatTime, progressPercent } from '../lib/viewerFormat.js'

// MuseScores eigene Vorgabe für Partituren ohne Tempoangabe (docs/architecture.md
// M8: metadata.tempo kann 0 sein, z.B. bei repeat-test.mscz) - dient nur als
// Bezugswert für die BPM-Anzeige/-Eingabe, gekennzeichnet über tempoGuessed.
const DEFAULT_TEMPO_BPM = 120

/**
 * Ein Anfangszustand der Seite, oder null. `loadState()` wirft bei einem
 * fehlenden Schluessel - und fehlen darf er: Das Viewer-Bundle laeuft auch
 * dort, wo niemand ihn hinterlegt hat (siehe useViewerPreferences.js).
 *
 * @param {string} key
 * @return {?object}
 */
function readInitialState(key) {
	try {
		return loadState('scoreview', key)
	} catch {
		return null
	}
}

export default {
	name: 'ScoreViewer',

	components: {
		AppearancePopover,
		BookmarkOutline,
		FollowBadge,
		LeaderPanel,
		LiveValue,
		MicIndicator,
		Microphone,
		RecordingPanel,
		ScorePage,
		ScorePanel,
		ScoreMixer,
		ScoreAnnotations,
		ScoreBar,
		ScoreLockButton,
		ScoreSpeedTrainer,
		ScoreStartTone,
		ScoreStatus,
		NcButton,
		NcTextField,
		NcNoteCard,
		NcPopover,
		NcCheckboxRadioSwitch,
		Play,
		Pause,
		Tune,
		NotebookOutline,
		Close,
		CommentTextOutline,
		FormatAlignMiddle,
		Repeat,
		Fullscreen,
		FullscreenExit,
		Metronome,
		CrosshairsGps,
		AccountGroup,
		PlaylistPlus,
		SetlistBar,
		SetlistEditor,
		TempoPopover,
		ZoomPopover,
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
	emits: ['ready', 'pieceChange'],

	/**
	 * Die Bereiche des Viewers als Composables, hier verdrahtet.
	 *
	 * Vue 3 legt setup()-Rueckgaben auf der Instanz aus und entpackt Refs
	 * dabei - der Options-API-Teil weiter unten liest also `this.timeline`
	 * und schreibt `this.showMixer = x`, waehrend die Composables dieselben
	 * Refs direkt benutzen. Der Zustand der offenen Partitur, den fast alle
	 * teilen, liegt in useScoreSession.js.
	 *
	 * @param props
	 */
	setup(props) {
		// Die gerade offene Partitur. Anfangs die aus `fileid`; eine Setliste
		// wechselt sie IM Viewer, statt ihn neu einhaengen zu lassen - nur so
		// bleiben Aufführungsmodus, Dunkelmodus, Zoom und der geladene
		// SoundFont ueber den Stueckwechsel erhalten. Alles, was an der
		// Datei haengt, liest deshalb hier, nicht an der Prop.
		const activeFileId = ref(props.fileid)
		const session = useScoreSession()
		const { timeline, measuresTimeline, systemRectsByPage, currentEtag, durationMs, clock, scoreMeta } = session

		// Einzeln und unter ihren eigenen Namen zurueckgegeben, nicht als
		// verschachteltes Objekt: Vue entpackt Refs nur auf der OBERSTEN Ebene
		// der setup()-Rueckgabe. `annotationsApi.visible` waere im Template ein
		// Ref-Objekt statt eines Wertes.
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
		const zoomApi = useZoom({
			rootEl: rootElement,
			scrollEl: scrollElement,
		})
		const autoScroll = useAutoScroll({ scrollEl: scrollElement })
		const playback = usePlayback({ clock, durationMs, defaultTempoBpm: DEFAULT_TEMPO_BPM })
		const bar = useBarLayout({
			rootEl: rootElement,
			isFullscreen: () => zoomApi.isFullscreen.value,
			isPlaying: () => playback.isPlaying.value,
		})

		const metronome = useMetronome({
			measuresTimeline: () => measuresTimeline.value,
			durationMs: () => durationMs.value,
			baseTempoBpm: () => playback.baseTempoBpm.value,
			effectiveTempoBpm: () => playback.effectiveTempoBpm.value,
			tempoFactor: () => playback.tempo.value,
			isPlaying: () => playback.isPlaying.value,
			play: () => clock.value?.play(),
			// Der Klick geht durch dieselbe Pufferkette wie die Musik, wo es
			// eine gibt - sonst waeren es auf Android zwei unabhaengig
			// gepufferte Ausgabe-Streams (siehe lib/metronomeClick.js).
			audioContext: playback.getAudioContext,
		})

		// Anzeigeeinstellungen der Nutzerin (Farbe/Form der Hervorhebung).
		// Kein Bezug zur Partitur - deshalb ohne Abhaengigkeiten und ohne
		// Ruecksetzen beim Dateiwechsel.
		const preferences = useViewerPreferences()

		// „Meine Stimme" je Partitur, serverseitig gemerkt - geladen im
		// fileid-Watcher, nicht in reset(): „Neu konvertieren" setzt den
		// Viewer zurueck, behaelt aber dieselbe Datei und damit dieselbe Wahl.
		const myPart = useMyPart({ fileId: () => activeFileId.value })

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
			myPartId: () => myPart.myPartId.value,
			isLeader: () => leaders.isLeader.value,
		})

		// Der Speed-Trainer zaehlt an den Loop-Durchlaeufen, braucht aber selbst
		// den Loop-Zustand - der Rueckruf wird deshalb nachgereicht.
		let onLoopWrap = () => {}
		const loop = useLoop({
			measuresTimeline: () => measuresTimeline.value,
			durationMs: () => durationMs.value,
			isPlaying: () => clock.value?.isPlaying() ?? false,
			seek: (timeMs) => clock.value?.seek(timeMs),
			startCountIn: (targetMs) => metronome.startCountIn(targetMs, DEFAULT_TEMPO_BPM),
			clearCountIn: metronome.clearCountIn,
			onWrap: () => onLoopWrap(),
		})

		const speedTrainer = useSpeedTrainer({
			loopActive: () => loop.active.value,
			effectiveTempoBpm: () => playback.effectiveTempoBpm.value,
			minTempoBpm: () => playback.minTempoBpm.value,
			maxTempoBpm: () => playback.maxTempoBpm.value,
			setTempoBpm: playback.setTempoBpm,
			manualTempoChanges: () => playback.manualTempoChanges.value,
		})
		onLoopWrap = speedTrainer.onLoopWrap

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
		let isFollowing = () => false
		const performance = usePerformanceMode({
			rootEl: rootElement,
			onKeydown: (event) => vm?.proxy?.onKeydown(event),
			onEnter: () => vm?.proxy?.onPerformanceEnter(),
			following: () => isFollowing(),
		})

		// Der Mixer als Karte ueber dem Notenbild. `showMixer` ist der
		// Schalter; zu sehen ist die Karte nur mit echter Wiedergabe UND
		// aufgelösten Kanälen - ohne beides bliebe eine leere Karte über dem
		// Notenbild stehen.
		const showMixer = ref(false)
		const showMixerPanel = computed(() => playback.hasRealPlayer.value && showMixer.value && playback.mixerChannels.value.length > 0)

		/**
		 * Die Stimmauswahl oeffnen - wenn der Anfangston oder die Intonation
		 * keine Stimme fand. Sie steckt im Mixer („Meine Stimme" je Zeile);
		 * eine zweite Auswahl fuer dieselbe Aussage waere eine Fehlerquelle
		 * (siehe `focusMyPart` in data()).
		 */
		function openVoiceSelection() {
			if (!performance.can('mixer')) {
				return
			}
			showMixer.value = true
		}

		const paging = usePaging({
			scrollEl: scrollElement,
			pages: autoScroll.pages,
			measureRects: (pageIndex) => systemRectsByPage.value[pageIndex] ?? [],
			onManualScroll: autoScroll.noteManualScroll,
		})

		// Tonarten und Studierbuchstaben - fuer Anfangston UND Taktnavigation
		// aus demselben gelesenen MIDI.
		const scoreFacts = useScoreFacts({
			midiData: () => playback.midiData.value,
			meta: () => scoreMeta.value,
			measuresTimeline: () => measuresTimeline.value,
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
		})

		// Taktanzeige und Sprung nach Takten. Eigenes Navigieren loest das
		// Folgen einer Leitung - „Folgt mir" entsteht aber erst weiter unten,
		// weil es selbst die Sprungfunktionen von hier braucht; der Rueckruf
		// wird deshalb nachgereicht, wie `isFollowing` oben.
		let noteNavigation = () => {}
		const navigation = useMeasureNavigation({
			measuresTimeline: () => measuresTimeline.value,
			durationMs: () => durationMs.value,
			displayTimeMs: () => playback.displayTimeMs.value,
			currentElid: () => session.currentElid.value,
			currentEtag: () => currentEtag.value,
			clock: () => clock.value,
			marks: () => scoreFacts.marks.value,
			totalMeasures: () => session.totalMeasures.value,
			can: performance.can,
			onNavigate: (kind) => noteNavigation(kind),
			forceAutoScrollFor: session.forceAutoScrollFor,
		})

		// Die Schalter der Administration - fehlen sie, ist alles aus.
		const features = normalizeFeatures(readInitialState('features'))

		// „Folgt mir" (C). Sprung, Loop und Ton gehen ueber eigene Wege statt
		// ueber die Handler der Leiste: Diese melden eigenes Navigieren und
		// loesten damit das Folgen - ein Sprung der Leitung darf das nicht.
		const follow = useFollowSession({
			fileId: () => activeFileId.value,
			enabled: () => features.followSession,
			standalone: () => readInitialState('standalone')?.directEditing === true,
			ready: () => !!clock.value && !!measuresTimeline.value,
			permitted: (action) => performance.can(action),
			seekToMeasure: navigation.followSeek,
			setLoop: (from, to) => loop.setRange(from, to),
			clearLoop: () => loop.clear(),
			playTone: () => startTone.startToneFor(),
			currentPosition: navigation.followPosition,
			currentLoop: () => (loop.active.value
				? { from: Number(loop.fromMeasure.value), to: Number(loop.toMeasure.value) }
				: null),
		})
		isFollowing = () => follow.following.value
		noteNavigation = follow.noteNavigation

		const standalonePage = readInitialState('standalone')?.directEditing === true
		const setlist = useSetlist({
			fileId: () => activeFileId.value,
			setFileId: (id) => {
				activeFileId.value = id
			},
			standalone: () => standalonePage,
			originFileId: () => props.fileid,
		})
		// Eine andere Partitur von aussen (Prop): Gehoert sie nicht zur
		// offenen Setliste, ist die Liste vorbei.
		watch(() => props.fileid, (neu) => {
			activeFileId.value = neu
			if (setlist.active.value && !setlist.entries.value.some((e) => String(e.fileId) === String(neu))) {
				setlist.close()
			}
		})

		// Erst hier, nach „Folgt mir": Der Watcher fragt sofort.
		// Wach auch im Aufführungsmodus, wenn gar nichts spielt - und
		// waehrend einer Folgesitzung: Am Notenstaender wird gesungen, nicht
		// getippt, und ein dunkler Bildschirm verpasste den naechsten Sprung.
		useWakeLock({ wanted: () => playback.isPlaying.value || performance.active.value || follow.active.value })

		useMyPartSound({
			hasRealPlayer: () => playback.hasRealPlayer.value,
			mixerChannels: () => playback.mixerChannels.value,
			myPartId: () => myPart.myPartId.value,
			stereoMyPart: () => preferences.stereoMyPart.value,
			mixerOpen: () => showMixerPanel.value,
			applyChannelVolumes: playback.applyChannelVolumes,
			applyChannelPans: playback.applyChannelPans,
		})

		// Die Mikrofonstrecke (docs/architecture.md, Abschnitt Mikrofon) - eine fuer Aufnahme, Intonation und
		// spaeter das Mitverfolgen, am AudioContext der Wiedergabe.
		const microphone = useMicrophone({ audioContext: playback.getAudioContext })
		const myChannels = () => channelsOfPart(playback.mixerChannels.value, myPart.myPartId.value)
		const clockPlaying = () => clock.value?.isPlaying() ?? false

		const recorder = useRecorder({
			fileId: () => activeFileId.value,
			enabled: () => features.recording,
			microphone,
			clock: () => clock.value,
			audioContext: playback.getAudioContext,
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
		})

		// Ob sich die Notenzeilen ueberhaupt Stimmen zuordnen lassen -
		// gemeldet von der ersten geladenen Seite (ScorePage.vue).
		const staffMappingOk = ref(false)
		// Die Stimme, die als „meine" gilt, als Index in meta.parts - also in
		// derselben Reihenfolge, in der die Notenzeilen im System stehen.
		const myPartIndex = computed(() => {
			if (myPart.myPartId.value === null) {
				return null
			}
			const index = session.scoreParts.value.findIndex((part) => String(part.id) === String(myPart.myPartId.value))
			return index === -1 ? null : index
		})
		// Die Notenzeile der eigenen Stimme fuer die Intonation (`st-N`, M10) -
		// nur, wo die Zeilen sich den Stimmen zuordnen lassen (eine Zeile je
		// Stimme, siehe lib/staffBands.js). Sonst bleibt es bei Nadel und
		// Liste, statt die Zeile der Nachbarstimme zu faerben.
		const intonationStaff = computed(() => (staffMappingOk.value && myPartIndex.value !== null ? myPartIndex.value : null))

		const intonation = useIntonation({
			microphone,
			clock: () => clock.value,
			isPlaying: clockPlaying,
			displayTimeMs: () => playback.displayTimeMs.value,
			latencyMs: () => playback.latencyMs.value,
			tempoFactor: () => playback.tempo.value,
			notes: () => scoreFacts.parsed.value?.notes ?? null,
			myChannels,
			events: () => timeline.value?.events ?? [],
			myStaff: () => intonationStaff.value,
			measureOf: (ms) => resolveMeasurePosition(measuresTimeline.value, ms, durationMs.value)?.measureNumber ?? null,
			loadAudio: recorder.loadAudio,
		})

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
		})

		return {
			root,
			scroll,
			showMixer,
			showMixerPanel,
			openVoiceSelection,
			staffMappingOk,
			myPartIndex,
			activeFileId,
			compactBar: bar.compact,
			toolsOpen: bar.toolsOpen,
			barCollapsed: bar.collapsed,
			showBar: bar.show,
			scheduleBarCollapse: bar.scheduleCollapse,
			observeBarWidth: bar.observe,
			stopBarLayout: bar.stop,
			standalonePage,
			setlist: setlist.setlist,
			setlistActive: setlist.active,
			setlistEntries: setlist.entries,
			setlistIndex: setlist.index,
			setlistPosition: setlist.position,
			setlistCurrent: setlist.current,
			setlistError: setlist.error,
			setlistOffers: setlist.offers,
			setlistOfferDismissed: setlist.offerDismissed,
			setlistFolderFileId: setlist.folderFileId,
			setlistCanCreate: setlist.canCreate,
			openSetlist: setlist.open,
			setlistNext: setlist.next,
			setlistPrevious: setlist.previous,
			setlistGoTo: setlist.goTo,
			closeSetlist: setlist.close,
			applySavedSetlist: setlist.applySaved,
			loadSetlistOffers: setlist.loadOffers,
			acceptSetlistOffer: setlist.acceptOffer,
			zoom: zoomApi.zoom,
			zoomFollowsWidth: zoomApi.followsWidth,
			isFullscreen: zoomApi.isFullscreen,
			fullscreenPossible: zoomApi.fullscreenPossible,
			zoomPercent: zoomApi.percent,
			minZoom: zoomApi.min,
			maxZoom: zoomApi.max,
			zoomStep: zoomApi.step,
			setZoom: zoomApi.set,
			zoomBy: zoomApi.by,
			onZoomInput: zoomApi.onInput,
			onWheel: zoomApi.onWheel,
			onPageLoaded: zoomApi.onPageLoaded,
			applyZoomPreset: zoomApi.applyPreset,
			toggleFullscreen: zoomApi.toggleFullscreen,
			onFullscreenChange: zoomApi.onFullscreenChange,
			onTouchStart: zoomApi.onTouchStart,
			onTouchMove: zoomApi.onTouchMove,
			onTouchEnd: zoomApi.onTouchEnd,
			resetZoom: zoomApi.reset,
			setPageRef: autoScroll.setPageRef,
			updateAutoScroll: autoScroll.update,
			onScrollGestureStart: autoScroll.onUserGestureStart,
			onScrollGestureEnd: autoScroll.onUserGestureEnd,
			noteManualScroll: autoScroll.noteManualScroll,
			resetAutoScroll: autoScroll.reset,
			metronomeEnabled: metronome.enabled,
			metronomeBeats: metronome.beats,
			startCountIn: metronome.startCountIn,
			clearCountIn: metronome.clearCountIn,
			resetMetronome: metronome.reset,
			loopFromMeasure: loop.fromMeasure,
			loopToMeasure: loop.toMeasure,
			loopActive: loop.active,
			loopMarkers: loop.markers,
			toggleLoop: loop.toggle,
			setLoopFromMeasure: loop.setFromCurrentMeasure,
			resetLoop: loop.reset,
			trainerStartBpm: speedTrainer.startBpm,
			trainerTargetBpm: speedTrainer.targetBpm,
			trainerStepBpm: speedTrainer.stepBpm,
			trainerActive: speedTrainer.active,
			trainerPasses: speedTrainer.passes,
			toggleSpeedTrainer: speedTrainer.toggle,
			resetSpeedTrainer: speedTrainer.reset,
			performanceMode: performance.active,
			performanceExitProgress: performance.exitProgress,
			can: performance.can,
			lockDown: performance.lockDown,
			cancelLockHold: performance.cancelHold,
			lockKeydown: performance.lockKeydown,
			lockKeyup: performance.lockKeyup,
			pageBy: paging.page,
			startToneMode: startTone.mode,
			startToneSounding: startTone.sounding,
			startToneName: startTone.lastToneName,
			startToneNeedsPart: startTone.needPart,
			startToneUnavailable: startTone.unavailableReason,
			pressStartTone: startTone.press,
			releaseStartTone: startTone.release,
			startToneFor: startTone.startToneFor,
			setStartToneMode: startTone.setMode,
			resetStartTone: startTone.reset,
			currentTimeMs: playback.currentTimeMs,
			displayTimeMs: playback.displayTimeMs,
			audioLatencyMs: playback.latencyMs,
			audioOffsetMs: playback.manualOffsetMs,
			automaticLatencyMs: playback.automaticLatencyMs,
			audioDiagnostics: playback.audioDiagnostics,
			setAudioOffsetMs: playback.setManualOffsetMs,
			onAudioOffsetInput: playback.onManualOffsetInput,
			isPlaying: playback.isPlaying,
			hasRealPlayer: playback.hasRealPlayer,
			playbackError: playback.playbackError,
			tempo: playback.tempo,
			baseTempoBpm: playback.baseTempoBpm,
			tempoGuessed: playback.tempoGuessed,
			effectiveTempoBpm: playback.effectiveTempoBpm,
			minTempoBpm: playback.minTempoBpm,
			maxTempoBpm: playback.maxTempoBpm,
			mixerChannels: playback.mixerChannels,
			presetList: playback.presetList,
			soundFontLoading: playback.soundFontLoading,
			soundFontLoadPercent: playback.soundFontLoadPercent,
			skipSoundFontLoad: playback.skipSoundFontLoad,
			togglePlay: playback.toggle,
			onSeekInput: playback.onSeekInput,
			onTempoBpmInput: playback.onTempoBpmInput,
			onVolumesChanged: playback.applyChannelVolumes,
			onProgramChanged: playback.setProgram,
			resetPlayback: playback.reset,
			myPartId: myPart.myPartId,
			loadMyPart: myPart.load,
			leaders: leaders.leaders,
			isLeader: leaders.isLeader,
			leaderError: leaders.error,
			leaderCandidates: leaders.candidates,
			showRehearsal: leaders.visible,
			loadLeaders: leaders.load,
			resetLeaders: leaders.reset,
			followEnabled: features.followSession,
			recordingEnabled: features.recording,
			intonationEnabled: features.intonation,
			maxRecordingsPerScore: features.maxRecordingsPerScore,
			micActive: microphone.active,
			micConsumers: microphone.consumers,
			micError: microphone.error,
			turnMicOff: microphone.turnOff,
			recordings: recorder.recordings,
			recordPhase: recorder.phase,
			recordElapsedMs: recorder.elapsedMs,
			recordWithAccompaniment: recorder.withAccompaniment,
			recordCountIn: recorder.countIn,
			recordConfirmReplace: recorder.confirmReplace,
			recordPending: recorder.pending,
			recordListening: recorder.listening,
			recordError: recorder.error,
			recordingVolume: recorder.recordingVolume,
			accompanimentVolume: recorder.accompanimentVolume,
			loadRecordings: recorder.load,
			startRecording: recorder.start,
			stopRecording: recorder.stop,
			answerRecordReplace: recorder.answerReplace,
			retryRecordSave: recorder.retrySave,
			discardPendingRecording: recorder.discardPending,
			listenRecording: recorder.listen,
			stopListeningRecording: recorder.stopListening,
			removeRecording: recorder.remove,
			resetRecorder: recorder.reset,
			destroyRecorder: recorder.destroy,
			intonationLive: intonation.live,
			intonationNeedle: intonation.needle,
			intonationMarks: intonation.marks,
			systemRectsByPage,
			NO_RECTS,
			intonationLiveMarks: intonation.liveMarks,
			intonationAnalysis: intonation.analysis,
			intonationAnalyzing: intonation.analyzing,
			intonationProgress: intonation.progress,
			intonationError: intonation.error,
			intonationNeedPart: intonation.needPart,
			toggleLiveIntonation: intonation.toggleLive,
			analyzeRecording: intonation.analyze,
			clearIntonationAnalysis: intonation.clearAnalysis,
			resetIntonation: intonation.reset,
			destroyIntonation: intonation.destroy,
			followActive: follow.active,
			followMine: follow.mine,
			followFollowing: follow.following,
			followLeaderName: follow.leaderName,
			followConnected: follow.connected,
			followBusy: follow.busy,
			followError: follow.error,
			followNavigation: follow.noteNavigation,
			resumeFollow: follow.resume,
			startFollow: follow.start,
			endFollow: follow.end,
			sendFollowPositionTo: follow.sendPosition,
			sendFollowLoop: follow.sendLoop,
			sendFollowTone: follow.sendTone,
			restartFollow: follow.restart,
			onLeaderAppoint: leaders.appoint,
			onLeaderRevoke: leaders.revoke,
			onLeaderSearch: leaders.search,
			saveMyPart: myPart.set,
			highlightColor: preferences.highlightColor,
			highlightMode: preferences.highlightMode,
			highlightStyle: preferences.highlightStyle,
			stereoMyPart: preferences.stereoMyPart,
			noteTheme: preferences.noteTheme,
			resolvedNoteTheme: preferences.resolvedNoteTheme,
			state: conversion.state,
			clientProgress: conversion.clientProgress,
			longWait: conversion.langeWartezeit,
			errorMessage: conversion.errorMessage,
			errorCode: conversion.errorCode,
			errorText: conversion.errorText,
			pollStatus: conversion.poll,
			requestReconvert: conversion.reconvert,
			resetConversion: conversion.reset,
			timeline,
			measuresTimeline,
			currentEtag,
			durationMs,
			clock,
			scoreMeta,
			pageUrls: session.pageUrls,
			scoreParts: session.scoreParts,
			totalMeasures: session.totalMeasures,
			rendererBackend: session.rendererBackend,
			mscoreVersion: session.mscoreVersion,
			canReconvert: session.canReconvert,
			midiUrl: session.midiUrl,
			cursorRect: session.cursorRect,
			currentElid: session.currentElid,
			resetSession: session.reset,
			measureInput: navigation.input,
			marksOpen: navigation.marksOpen,
			currentAnchor: navigation.currentAnchor,
			jumpToMeasure: navigation.jumpToMeasure,
			jumpToMeasureInput: navigation.jumpToInput,
			jumpRelativeMeasure: navigation.jumpRelative,
			jumpToMark: navigation.jumpToMark,
			onMeasureFieldFocus: navigation.onFieldFocus,
			onMeasureFieldBlur: navigation.onFieldBlur,
			resetMeasureNavigation: navigation.reset,
			cleanupSession: session.cleanup,
			forceAutoScrollFor: session.forceAutoScrollFor,
			annotations: annotations.annotations,
			listedAnnotations: annotations.listed,
			annotationError: annotations.error,
			showAnnotations: annotations.visible,
			annotationMarkers: annotations.markers,
			annotationStamps: annotations.stamps,
			armedStamp: annotations.armedStamp,
			armStamp: annotations.armStamp,
			disarmStamp: annotations.disarmStamp,
			placeArmedStamp: annotations.placeArmedStamp,
			rehearsalMarks: scoreFacts.marks,
			ensureScoreMidi: scoreFacts.ensureMidi,
			resetScoreFacts: scoreFacts.reset,
			onAnnotationCreate: annotations.create,
			onAnnotationUpdate: annotations.update,
			onAnnotationDelete: annotations.remove,
			onAnnotationJumpTo: annotations.jumpTo,
			onAnnotationJumpToById: annotations.jumpToById,
			resetAnnotations: annotations.reset,
		}
	},

	data() {
		return {
			// Siehe emits: genau einmal, egal wie oft der Zustand danach noch
			// wechselt.
			readyGemeldet: false,
			// Der Setlisten-Editor: 'edit' | 'new' | null (zu).
			setlistEditorMode: null,
			// Der Aufklapper „Aufnahme und Intonation".
			showPractice: false,
			// Welche Stimme "meine" ist (`myPartId`, aus useMyPart in setup())
			// wird ueber "Meine Stimme" im Mixer gesetzt (ScoreMixer.vue).
			// Dieselbe Wahl steuert Lautstaerke UND Markierung im Notenbild;
			// zwei getrennte Bedienelemente fuer dieselbe Aussage waeren eine
			// Fehlerquelle.
			focusMyPart: false,
			showNoteText: false,
		}
	},

	computed: {
		setlistTitle() {
			return this.setlist?.title ?? ''
		},

		setlistCanEdit() {
			return this.setlist?.canEdit === true && !this.standalonePage
		},

		armedStampName() {
			return this.armedStamp ? stampName(this.armedStamp.stamp) : ''
		},

		partCount() {
			return this.scoreParts.length
		},

		/**
		 * Ob „nur meine Zeile" ueberhaupt etwas bewirken kann. Ohne diese
		 * Pruefung stuende dort ein Schalter, der bei einem Klavierauszug oder
		 * einer Partitur mit ausgeblendeten leeren Zeilen wirkungslos bliebe.
		 */
		canFocusMyPart() {
			return this.myPartIndex !== null && this.staffMappingOk
		},

		// --- Leiste ---------------------------------------------------------

		/**
		 * Ob irgendein Werkzeug aktiv ist - der Punkt am „Mehr"-Knopf.
		 * Ohne ihn verschwaende ein laufendes Metronom hinter einem
		 * geschlossenen Menue, und niemand faende den Schalter dafuer wieder.
		 */
		anyToolActive() {
			return this.metronomeEnabled
				|| this.loopActive
				|| this.focusMyPart
				|| this.showNoteText
				|| this.showAnnotations
				|| this.showMixer
				|| this.showRehearsal
				|| this.showPractice
		},

		/** Fuer die eingefahrene Leiste, die nur noch die Position zeigt. */
		playbackPercent() {
			return progressPercent(this.displayTimeMs, this.durationMs)
		},

		/** „Im Browser oeffnen" (E8): Nextclouds Kurzlink auf diese Datei. */
		browserUrl() {
			return browserFileUrl(window.location.origin, getRootUrl(), this.activeFileId)
		},
	},

	watch: {
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
		state(neu) {
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
				this.pollStatus()
				this.loadMyPart()
				this.resetLeaders()
				this.loadLeaders()
				this.restartFollow()
				this.loadSetlistOffers()
				this.loadRecordings()
			},
		},

		setlistCurrent() {
			this.announcePiece()
		},

		// Nach einem Zoomwechsel steht das aktuelle System woanders - ohne
		// dieses Nachziehen bliebe es bis zum nächsten Notenwechsel verschoben
		// (bei angehaltener Wiedergabe: für immer). Bewusst mit force: ein
		// Zoomwechsel ist eine ausdrückliche Handlung, keine Störung des
		// Lesens wie ein manueller Scroll.
		zoom() {
			this.$nextTick(() => this.updateAutoScroll(this.cursorRect, true))
		},
	},

	mounted() {
		// Der Scroll-Listener sitzt im Template (@scroll.passive an
		// .scoreview-scroll): das scrollende Element ist ein Kind, das erst im
		// Zustand "ready" existiert, this.$el scrollt selbst nicht.
		document.addEventListener('fullscreenchange', this.onFullscreenChange)
		// Tastaturkürzel NICHT passiv: Leertaste/Pfeiltasten sollen die Seite
		// nicht zusätzlich scrollen (siehe onKeydown - preventDefault nur für
		// die tatsächlich behandelten Tasten, alles andere bleibt unangetastet,
		// insbesondere Nextclouds eigene Kürzel).
		this.$el.addEventListener('keydown', this.onKeydown)
		this.observeBarWidth()
		if (this.setlistId !== null) {
			// Weg 1: Der Einstieg hat das erste spielbare Stueck schon
			// als `fileid` gesetzt - die Liste setzt dort an.
			this.openSetlist(this.setlistId, { at: this.fileid, data: this.setlistData })
		}
	},

	beforeUnmount() {
		// Dieselbe Reihenfolge wie in reset(): Aufnahme und Intonation vor dem
		// Abbau der Wiedergabe, solange deren Kontext noch lebt.
		this.destroyRecorder()
		this.destroyIntonation()
		this.cleanupSession()
		this.turnMicOff()
		document.removeEventListener('fullscreenchange', this.onFullscreenChange)
		this.$el.removeEventListener('keydown', this.onKeydown)
		this.stopBarLayout()
	},

	methods: {
		// Einzelargument-Wrapper um @nextcloud/l10n translate() (siehe
		// tools/l10n.mjs zur Extraktion) - hier statt auf Modulebene definiert,
		// damit t() dort ausgewertet wird, wo der Text gebraucht wird
		// (Template/computed), nicht einmalig beim Modulimport.
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		/**
		 * Die Wahl aus dem Mixer uebernehmen. Wird sie zurueckgenommen, geht
		 * auch „nur meine Zeile" aus - sonst bliebe ein Notenbild zurueck, in
		 * dem alle Zeilen gedaempft sind und keine hervorgehoben.
		 *
		 * @param {?string} partId Stimme aus meta.parts, null = keine
		 */
		onMyPartChanged(partId) {
			this.saveMyPart(partId)
			if (partId === null) {
				this.focusMyPart = false
			}
		},

		toggleStartToneMode() {
			this.setStartToneMode(this.startToneMode === MODE_TONIC ? MODE_VOICE : MODE_TONIC)
		},

		/**
		 * Beim Einschalten des Aufführungsmodus alles schliessen, was dort
		 * gesperrt ist - ein offener Mixer bliebe sonst bedienbar stehen.
		 */
		onPerformanceEnter() {
			this.showMixer = false
			this.showAnnotations = false
			this.disarmStamp()
			this.showRehearsal = false
			this.showPractice = false
			this.setlistEditorMode = null
			this.toolsOpen = false
			this.releaseStartTone()
		},

		// --- Setliste -----------------------------------------------------

		/** Blaettern in der Setliste - auch im Aufführungsmodus (Policy `nextPiece`). */
		onSetlistNext() {
			if (this.can('nextPiece')) {
				this.setlistNext()
			}
		},

		onSetlistPrevious() {
			if (this.can('nextPiece')) {
				this.setlistPrevious()
			}
		},

		onSetlistGoTo(i) {
			if (this.can('nextPiece')) {
				this.setlistGoTo(i)
			}
		},

		/** @param {'edit'|'new'} mode */
		openSetlistEditor(mode) {
			if (!this.can('settings')) {
				return
			}
			this.setlistEditorMode = this.setlistEditorMode === mode ? null : mode
		},

		/**
		 * Gespeichert oder angelegt: Die Liste gilt ab jetzt, auch eine neue -
		 * wer eine Setliste anlegt, will sie gleich benutzen.
		 *
		 * @param {object} data Antwort von PUT/POST /api/setlists
		 */
		onSetlistSaved(data) {
			this.setlistEditorMode = null
			this.applySavedSetlist(data)
		},

		/**
		 * Meldet dem Einstieg, welches Stueck gerade offen ist - ScoreModal
		 * setzt daraus seine Ueberschrift. Ohne Setliste bleibt es beim
		 * Dateinamen, den der Einstieg selbst kennt.
		 */
		announcePiece() {
			const entry = this.setlistCurrent
			this.$emit('pieceChange', entry ? { label: entry.label, setlistTitle: this.setlistTitle } : null)
		},

		// --- Aufnahme und Intonation ------------------------------------------

		/**
		 * Die Intonation braucht die Noten der eigenen Stimme - ohne Ton hat
		 * das MIDI bis hierher niemand geladen.
		 */
		async ensureIntonationMidi() {
			await this.ensureScoreMidi(this.midiUrl, true)
		},

		async onToggleLiveIntonation() {
			await this.ensureIntonationMidi()
			await this.toggleLiveIntonation()
			if (this.intonationNeedPart) {
				this.openVoiceSelection()
			}
		},

		async onAnalyzeRecording(recording) {
			await this.ensureIntonationMidi()
			await this.analyzeRecording(recording === 'pending' ? { id: 'pending', ...this.recordPending.meta } : recording)
			if (this.intonationNeedPart) {
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
			this.listenRecording(recording)
		},

		/**
		 * Aus der Problemliste an die Stelle springen.
		 *
		 * @param {number} onMs Partiturzeit der Note
		 */
		onPracticeJump(onMs) {
			if (this.can('seek') && this.clock) {
				this.followNavigation('seek')
				this.clock.seek(onMs)
			}
		},

		onPlayClick() {
			if (this.can('play')) {
				this.togglePlay()
			}
		},

		onSeekBarInput(event) {
			if (this.can('seek')) {
				this.followNavigation('seek')
				this.onSeekInput(event)
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
			if (!this.can('annotate')) {
				return
			}
			this.armStamp(spec)
			this.showAnnotations = false
		},

		/**
		 * Klick auf einen Notizmarker springt an dessen Stelle - im
		 * Aufführungsmodus also gesperrt wie jeder andere Sprung.
		 *
		 * @param {number} id
		 */
		onMarkerClick(id) {
			if (this.can('seek')) {
				this.followNavigation('annotationJump')
				this.onAnnotationJumpToById(id)
			}
		},

		/**
		 * Meldung der Seiten, ob sich Notenzeilen ueberhaupt Stimmen zuordnen
		 * lassen (siehe lib/staffBands.js).
		 *
		 * @param {boolean} moeglich
		 */
		onStaffMapping(moeglich) {
			this.staffMappingOk = moeglich
			if (!moeglich) {
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
			return this.currentAnchor
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
			await this.requestReconvert()
		},

		reset() {
			// Vor dem Abbau der Wiedergabe: Eine laufende Aufnahme wird noch
			// abgeschlossen und gespeichert, solange ihr Kontext lebt.
			this.resetRecorder()
			this.resetIntonation()
			// Baut die Wiedergabe ab und vergisst die geladene Konvertierung
			// (useScoreSession.js) - ein noch laufendes Laden gilt ab hier
			// als veraltet.
			this.resetSession()
			this.resetStartTone()
			this.resetSpeedTrainer()
			this.resetConversion()
			this.resetPlayback()
			this.showMixer = false
			this.resetAutoScroll()
			this.focusMyPart = false
			this.staffMappingOk = false
			this.resetMeasureNavigation()
			this.resetScoreFacts()
			this.resetLoop()
			this.resetZoom()
			this.resetAnnotations()
			this.resetMetronome()
		},

		sendFollowPosition() {
			return this.sendFollowPositionTo(null)
		},

		/**
		 * „Alle zu C": Die Leitung springt selbst mit - sie soll sehen, was
		 * sie angesagt hat.
		 *
		 * @param {{measure:number, text:string}} mark
		 */
		sendFollowMark(mark) {
			this.jumpToMeasure(mark.measure)
			return this.sendFollowPositionTo({ measure: mark.measure, mark: mark.text })
		},

		/** Eigener Loop loest das Folgen. */
		onToggleLoop() {
			if (this.can('loop')) {
				this.followNavigation('loop')
				this.toggleLoop()
			}
		},

		/**
		 * Sprung zu einer Notiz aus der Liste - eigenes Navigieren.
		 *
		 * @param {object} annotation
		 */
		onAnnotationJumpToOwn(annotation) {
			this.followNavigation('annotationJump')
			this.onAnnotationJumpTo(annotation)
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
			const binding = resolveKey(event, { performance: this.performanceMode })
			if (!binding) {
				return
			}
			if (binding.preventDefault) {
				event.preventDefault()
			}
			if (binding.action !== null && !this.can(binding.action)) {
				return
			}
			const commands = {
				togglePlay: () => this.togglePlay(),
				nextMeasure: () => this.jumpRelativeMeasure(1),
				previousMeasure: () => this.jumpRelativeMeasure(-1),
				toggleLoop: () => this.onToggleLoop(),
				zoomIn: () => this.zoomBy(this.zoomStep),
				zoomOut: () => this.zoomBy(1 / this.zoomStep),
				// Zurück zur Seitenbreite - und wieder der Fenstergröße
				// folgend, wie beim Öffnen.
				zoomWidth: () => this.applyZoomPreset('width'),
				pageDown: () => this.pageBy(1),
				pageUp: () => this.pageBy(-1),
				// Diese Tasten scrollen nativ weiter. Gemeldet wird nur, DASS
				// gescrollt wird - der Browser meldet für Tastatur-Scrollen
				// keine Geste, und ohne diesen Hinweis führte die App der
				// Wiedergabe sofort wieder nach (siehe useAutoScroll.js).
				scroll: () => this.noteManualScroll(),
				blocked: () => {},
			}
			commands[binding.command]?.()
		},

		// Umkehrung von M4: Klick auf eine Note springt dorthin -
		// ScorePage.vue liefert nur die Klickposition in SVG-Einheiten, die
		// eigentliche Element-/Zeit-Auflösung passiert hier mit der vollen
		// timeline (scoreLayout.js).
		onNoteClick({ page, x, y }) {
			// Liegt ein Stempel bereit, setzt der Tipp ihn - und springt nicht
			// zusaetzlich dorthin.
			if (this.armedStamp) {
				if (this.can('annotate')) {
					this.placeArmedStamp({ page, x, y })
				}
				return
			}
			// Im Aufführungsmodus der haeufigste Fehlgriff ueberhaupt: ein Tipp
			// auf die Noten, um zu blaettern.
			if (!this.timeline || !this.clock || !this.can('noteClick')) {
				return
			}
			const elid = findElementAtPoint(this.timeline.elements, page, x, y)
			if (elid === null) {
				return
			}
			// Bezugspunkt ist die gehörte Stelle: Getippt wird auf das, was
			// gerade klingt, nicht auf das, was schon im Ausgabepuffer steht.
			const timeMs = findNearestOccurrenceTimeMs(this.timeline.events, elid, this.displayTimeMs)
			if (timeMs !== null) {
				this.followNavigation('noteClick')
				this.clock.seek(timeMs)
			}
		},

		// Fuers Template - eine reine Funktion aus lib/viewerFormat.js.
		formatTime,

		/**
		 * Die Position fuer die eingefahrene Leiste - als Methode, damit
		 * ScoreBar eine gleichbleibende Funktion bekommt statt eines Werts,
		 * der sich in jedem Frame aendert (gelesen nur in LiveValue).
		 *
		 * @return {number}
		 */
		readPlaybackPercent() {
			return this.playbackPercent
		},

		/**
		 * Die Betriebsdiagnose und die erkannte Latenz fuer die Aufklapper -
		 * als Methoden, damit die Kindkomponenten eine gleichbleibende
		 * Funktion bekommen statt eines Werts, der sich in jedem Frame
		 * aendert (siehe TempoPopover.vue, AppearancePopover.vue).
		 *
		 * @return {object}
		 */
		readAudioDiagnostics() {
			return this.audioDiagnostics
		},

		/** @return {number} */
		readAutomaticLatencyMs() {
			return this.automaticLatencyMs
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
				this.noteManualScroll()
			}
			this.onWheel(event)
		},
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>

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

.scoreview-play {
	flex: 0 0 auto;
}

.scoreview-seek {
	flex: 1 1 120px;
	min-width: 80px;
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
}

.scoreview-armed {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

/* Der obere Abstand von NcInputField (margin-block-start: 6px) verschiebt das
   Feld in einer waagerechten Leiste gegen alles andere. */
.scoreview-measure-field :deep(.input-field) {
	margin-block-start: 0;
}

.scoreview-measure-total {
	white-space: nowrap;
}

.scoreview-tone-mode {
	white-space: nowrap;
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
	/* Nur die Karten selbst fangen Klicks - der Zwischenraum gehört weiter
	   dem Notenbild darunter (Klick auf eine Note springt dorthin). */
	pointer-events: none;
}
</style>
