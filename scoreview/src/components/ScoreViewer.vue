<template>
	<!--
		Die Hervorhebungsfarbe haengt als CSS-Variable an der Wurzel, nicht an
		jeder Seite: ScorePage.vue erbt sie ueber die Kaskade, auch in das per
		v-html eingesetzte SVG hinein (Scoped-CSS greift dort nicht, geerbte
		Custom Properties schon). Aendert die Nutzerin die Farbe, faerbt sich
		damit alles Gefaerbte in einem Rutsch um - ohne dass eine einzige Seite
		neu rendern muss.
	-->
	<div class="scoreview-viewer" :style="highlightStyle">
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
		<div v-if="state === 'converting' || state === 'loading'" class="scoreview-status">
			<NcLoadingIcon :size="32" :name="state === 'loading' ? t('Loading…') : t('Converting…')" />
			<!--
				Nur beim Rueckfall im Browser gefuellt: Dort dauert das erste
				Oeffnen laenger als sonst, weil die Engine geladen wird - ein
				stummer Kreisel liesse das wie einen Haenger aussehen.
				Serverseitig konvertiert bleibt die Zeile leer.
			-->
			<p v-if="conversionProgressText" class="scoreview-status-detail">
				{{ conversionProgressText }}
			</p>
		</div>
		<div v-else-if="state === 'error'" class="scoreview-status scoreview-error">
			<NcEmptyContent :name="t('Error')" :description="errorText">
				<template #icon>
					<AlertCircleOutline :size="48" />
				</template>
			</NcEmptyContent>
			<details v-if="errorCode && errorMessage" class="scoreview-error-detail">
				<summary>{{ t('Technical detail') }}</summary>
				<pre>{{ errorMessage }}</pre>
			</details>
		</div>
		<template v-else>
			<!--
				Eingefahrene Leiste: Im Vollbild zieht sie sich waehrend der
				Wiedergabe auf eine Fortschrittslinie zusammen (siehe
				scheduleBarCollapse) - auf dem Notenstaender zaehlt jede Zeile
				Noten. Bewusst NICHT ganz ausgeblendet mit "Tippen holt sie
				zurueck": Ein Tipp auf die Partitur springt bereits an die
				getippte Note (onNoteClick), zwei Bedeutungen fuer dieselbe
				Geste waeren ein Fehler. Die Linie ist eindeutig anzutippen und
				verraet weiter die Position.
			-->
			<button
				v-if="barCollapsed"
				type="button"
				class="scoreview-bar-line"
				:aria-label="t('Show playback controls')"
				:title="t('Show playback controls')"
				@click="showBar">
				<span class="scoreview-bar-line-fill" :style="{ inlineSize: playbackPercent + '%' }" />
			</button>
			<!--
				EINE Leiste, und zwar ausserhalb des Scroll-Bereichs. Als
				Geschwister eines eigenen Scroll-Elements ist "wegscrollen"
				strukturell unmoeglich - und der z-index-Wettlauf gegen die
				SVG-Seiten entfaellt.

				Zwei Streifen statt einer Knopfreihe: Auf Telefonbreite
				brauchte die volle Reihe rechnerisch ~780px (14 Bedienelemente
				bei 44px Touch-Zielgroesse) und brach damit auf drei Zeilen um -
				dauerhaft rund 18% der Bildschirmhoehe, auch im Vollbild.
				Draussen bleibt jetzt nur, was waehrend des Singens gebraucht
				wird; die Werkzeuge kommen auf Abruf. Auf breiten Schirmen
				stehen beide Streifen nebeneinander, dort aendert sich nichts.
			-->
			<div
				v-else
				class="scoreview-bar"
				:class="{ 'scoreview-bar--compact': compactBar }"
				@pointerdown="scheduleBarCollapse">
				<div class="scoreview-bar-transport">
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
					<input
						type="range"
						class="scoreview-seek"
						min="0"
						:max="durationMs"
						:value="displayTimeMs"
						:disabled="!can('seek')"
						:aria-label="t('Playback position')"
						@input="onSeekBarInput">
					<span class="scoreview-time">{{ formatTime(displayTimeMs) }} / {{ formatTime(durationMs) }}</span>
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
					<!--
						Der Zugang zu den Werkzeugen auf schmalen Schirmen. Der
						Punkt daran ist nicht Zierde: Laeuft das Metronom oder
						ist ein Loop aktiv, muss das sichtbar bleiben, ohne das
						Menue zu oeffnen - sonst sucht jemand mitten in der
						Probe nach einem Klick, den er nicht abstellen kann.
					-->
					<NcButton
						v-if="compactBar"
						class="scoreview-more"
						:pressed="toolsOpen"
						:aria-label="t('Tools')"
						:title="t('Tools')"
						@click="toolsOpen = !toolsOpen">
						<template #icon>
							<span class="scoreview-more-icon">
								<DotsHorizontal :size="20" />
								<span v-if="anyToolActive && !toolsOpen" class="scoreview-more-dot" />
							</span>
						</template>
					</NcButton>
				</div>
				<div v-if="!compactBar || toolsOpen" class="scoreview-bar-tools">
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
					<!--
						BPM statt Prozent (auf Basis von docs/architecture.md M8:
						metadata.tempo ist Viertel-BPM) - der Notensymbol-Text "♩ 80"
						statt "100%" ist die Einheit, die eine Chorleitung tatsaechlich
						ansagt. tempoGuessed markiert Partituren ohne eigene Tempoangabe
						(M8: tempo kann 0 sein) sichtbar als geschaetzt, statt eine
						Genauigkeit vorzutaeuschen, die nicht da ist. Der Regler dazu
						liegt im Popover - er wird einmal eingestellt, nicht dauernd.
					-->
					<NcPopover v-if="can('settings')">
						<template #trigger>
							<NcButton
								class="scoreview-tempo-button"
								:aria-label="t('Tempo and metronome')"
								:title="tempoGuessed ? t('No tempo marking in the score – 120 BPM assumed.') : t('Tempo and metronome')">
								♩ {{ effectiveTempoBpm }}{{ tempoGuessed ? '*' : '' }}
							</NcButton>
						</template>
						<template #default>
							<div class="scoreview-popover">
								<label v-if="hasRealPlayer" class="scoreview-popover-label">
									{{ t('Tempo (BPM)') }}: ♩ = {{ effectiveTempoBpm }}
									<input
										type="range"
										:min="minTempoBpm"
										:max="maxTempoBpm"
										step="1"
										:value="effectiveTempoBpm"
										:aria-label="t('Tempo (BPM)')"
										@input="onTempoBpmInput">
								</label>
								<fieldset class="scoreview-popover-group">
									<legend>{{ t('Metronome') }}</legend>
									<NcCheckboxRadioSwitch
										v-model="metronomeBeats"
										type="radio"
										value="all"
										name="scoreview-metronome-beats">
										{{ t('Every beat') }}
									</NcCheckboxRadioSwitch>
									<NcCheckboxRadioSwitch
										v-model="metronomeBeats"
										type="radio"
										value="downbeat"
										name="scoreview-metronome-beats">
										{{ t('Downbeat only') }}
									</NcCheckboxRadioSwitch>
								</fieldset>
								<!--
									Bild und Ton abgleichen. Der Cursor stuende sonst
									dort, wo die Musik erst noch hinkommt: Die Audiouhr
									meldet, was an das Ausgabegeraet UEBERGEBEN wurde,
									hoerbar wird es erst nach der Ausgabelatenz - ueber
									Bluetooth 150-300 ms, bei Viertel = 120 eine
									Achtelnote. Automatisch ausgeglichen wird, was der
									Browser meldet (lib/playbackTime.js); dieser Regler
									traegt den Rest, denn ob der Bluetooth-Anteil
									ueberhaupt gemeldet wird, haengt am Kopfhoerer.
									Geraeteweise gemerkt, nicht am Konto - Begruendung
									in usePlayback.js.
								-->
								<label v-if="hasRealPlayer" class="scoreview-popover-label">
									{{ t('Sync picture and sound') }}: {{ audioOffsetMs }} ms
									<input
										type="range"
										:min="minAudioOffsetMs"
										:max="maxAudioOffsetMs"
										step="10"
										:value="audioOffsetMs"
										:aria-label="t('Sync picture and sound')"
										@input="onAudioOffsetInput">
									<span class="scoreview-popover-hint">
										{{ t('Adjust while playing, until the highlighted note matches what you hear. Detected automatically: {ms} ms.', { ms: automaticLatencyRounded }) }}
									</span>
								</label>
							</div>
						</template>
					</NcPopover>
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
					<NcPopover>
						<template #trigger>
							<NcButton :aria-label="t('Zoom')" :title="t('Zoom')">
								<template #icon>
									<Magnify :size="20" />
								</template>
							</NcButton>
						</template>
						<template #default>
							<div class="scoreview-popover">
								<label class="scoreview-popover-label">
									{{ t('Zoom') }}: {{ zoomPercent }}%
									<input
										type="range"
										:min="minZoom"
										:max="maxZoom"
										step="0.05"
										:value="zoom"
										:aria-label="t('Zoom')"
										@input="onZoomInput">
								</label>
								<NcButton wide @click="applyZoomPreset('width')">
									<template #icon>
										<ArrowExpandHorizontal :size="20" />
									</template>
									{{ t('Fit page width') }}
								</NcButton>
								<NcButton wide @click="applyZoomPreset('page')">
									<template #icon>
										<FitToPage :size="20" />
									</template>
									{{ t('Fit whole page') }}
								</NcButton>
								<NcButton wide @click="applyZoomPreset('actual')">
									<template #icon>
										<Magnify :size="20" />
									</template>
									{{ t('Actual size') }}
								</NcButton>
							</div>
						</template>
					</NcPopover>
					<!--
						Darstellung: wie die klingende Stelle markiert wird - und,
						im selben Aufklapper, womit diese Seiten ueberhaupt gesetzt
						wurden. Beides gehoert zusammen: Es ist der Ort fuer
						"warum sieht das so aus".
					-->
					<NcPopover v-if="can('settings')">
						<template #trigger>
							<NcButton :aria-label="t('Appearance')" :title="t('Appearance')">
								<template #icon>
									<Palette :size="20" />
								</template>
							</NcButton>
						</template>
						<template #default>
							<div class="scoreview-popover">
								<fieldset class="scoreview-popover-group">
									<legend>{{ t('Playback highlight') }}</legend>
									<NcCheckboxRadioSwitch
										v-model="highlightMode"
										type="radio"
										value="notes"
										name="scoreview-highlight-mode">
										{{ t('Colour the sounding notes') }}
									</NcCheckboxRadioSwitch>
									<NcCheckboxRadioSwitch
										v-model="highlightMode"
										type="radio"
										value="bar"
										name="scoreview-highlight-mode">
										{{ t('Bar at the sounding position') }}
									</NcCheckboxRadioSwitch>
								</fieldset>
								<!--
									Vorschlaege UND freie Wahl: Eine Farbe, die auf
									weissem Papier neben schwarzer Druckfarbe wirklich
									traegt, ist im Farbwaehler nicht in zwei Klicks
									gefunden.
								-->
								<div class="scoreview-swatches" role="group" :aria-label="t('Highlight colour')">
									<button
										v-for="preset in highlightPresets"
										:key="preset.id"
										type="button"
										class="scoreview-swatch"
										:class="{ 'scoreview-swatch--active': preset.color === highlightColor }"
										:style="{ background: preset.color }"
										:aria-pressed="preset.color === highlightColor"
										:aria-label="presetLabel(preset.id)"
										:title="presetLabel(preset.id)"
										@click="highlightColor = preset.color" />
								</div>
								<label class="scoreview-popover-label">
									{{ t('Own colour') }}
									<input
										type="color"
										class="scoreview-color-input"
										:value="highlightColor"
										:aria-label="t('Own colour')"
										@input="onHighlightColorInput">
								</label>
								<!--
									Dunkelmodus der Noten. „Automatisch" folgt
									dem Nextcloud-Theme; die feste Wahl uebersteuert
									es, und beides bleibt am Konto gemerkt.
								-->
								<fieldset class="scoreview-popover-group">
									<legend>{{ t('Score colours') }}</legend>
									<NcCheckboxRadioSwitch
										v-model="noteTheme"
										type="radio"
										value="auto"
										name="scoreview-note-theme">
										{{ t('Follow the Nextcloud theme') }}
									</NcCheckboxRadioSwitch>
									<NcCheckboxRadioSwitch
										v-model="noteTheme"
										type="radio"
										value="light"
										name="scoreview-note-theme">
										{{ t('Dark notes on white') }}
									</NcCheckboxRadioSwitch>
									<NcCheckboxRadioSwitch
										v-model="noteTheme"
										type="radio"
										value="dark"
										name="scoreview-note-theme">
										{{ t('Light notes on dark') }}
									</NcCheckboxRadioSwitch>
								</fieldset>
								<!--
									Die Herkunft der Darstellung (E3). Rein
									beschreibend - der Viewer verzweigt nirgends
									danach, er sagt nur, womit diese Seiten gesetzt
									wurden. Das ist die Frage, die bei einem
									Satzunterschied zwischen zwei Instanzen als
									Erstes kommt.
								-->
								<p class="scoreview-origin">
									<span class="scoreview-origin-label">{{ t('Rendered by') }}</span>
									{{ rendererText }}
									<span v-if="mscoreVersion" class="scoreview-origin-note">
										{{ t('Score written with MuseScore {version}', { version: mscoreVersion }) }}
									</span>
								</p>
								<!--
									Genau hier, direkt unter der Herkunft: Das ist die
									Stelle, an der auffaellt, dass eine Partitur noch von
									einer aelteren Fassung gesetzt wurde. Nur mit
									Schreibrecht (canReconvert) - siehe
									ConversionController::reconvert().
								-->
								<NcButton
									v-if="canReconvert"
									class="scoreview-origin-action"
									:title="t('Discards the stored conversion and renders the score again with the current version of the app.')"
									@click="reconvertScore">
									<template #icon>
										<Refresh :size="20" />
									</template>
									{{ t('Convert again') }}
								</NcButton>
								<!--
									Was auf DIESEM Geraet gemessen wurde. Steht hier,
									weil es dieselbe Frage beantwortet wie die
									Herkunft darueber: "warum ist das so, wie es
									ist". Rein beschreibend, nichts verzweigt danach.

									Der Grund fuer die Anzeige: "die Wiedergabe
									synchronisiert nicht sauber" hat zwei ganz
									verschiedene Ursachen, die sich gleich anfuehlen -
									die Anzeige laeuft dem Ton voraus (dann steht hier
									eine Latenz), oder der Ton setzt aus, weil die
									Synthese auf dem Geraet nicht mitkommt (dann
									zaehlt hier etwas). Aus der Ferne ist das nicht zu
									unterscheiden, auf dem Geraet mit einem Blick.
								-->
								<details class="scoreview-diagnostics">
									<summary>{{ t('Playback diagnostics') }}</summary>
									<dl class="scoreview-diagnostics-list">
										<div v-if="audioDiagnostics.hasAudio">
											<dt>{{ t('Output latency') }}</dt>
											<dd>
												{{ audioDiagnostics.appliedLatencyMs }} ms
												<span class="scoreview-diagnostics-note">
													{{ t('measured {measured}, reported {reported}, by hand {manual}', {
														measured: formatMs(audioDiagnostics.measuredLatencyMs),
														reported: formatMs(audioDiagnostics.reportedLatencyMs),
														manual: audioDiagnostics.manualOffsetMs + ' ms',
													}) }}
												</span>
											</dd>
											<dt>{{ t('Audio output') }}</dt>
											<dd>{{ audioDiagnostics.sampleRate }} Hz, {{ audioDiagnostics.contextState }}</dd>
											<dt>{{ t('Dropouts') }}</dt>
											<dd>{{ audioDiagnostics.dropoutCount }} ({{ audioDiagnostics.dropoutLostMs }} ms)</dd>
										</div>
										<div v-else>
											<dt>{{ t('Audio output') }}</dt>
											<dd>{{ t('none – the score cursor runs without sound') }}</dd>
										</div>
										<div>
											<dt>{{ t('Frame rate') }}</dt>
											<dd>{{ audioDiagnostics.frameRate }} fps</dd>
										</div>
									</dl>
								</details>
							</div>
						</template>
					</NcPopover>
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
				</div>
			</div>
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
							:systemRects="systemRectsForPage(i)"
							:myPartIndex="myPartIndex"
							:focusMyPart="focusMyPart"
							:partCount="partCount"
							:showNoteText="showNoteText"
							:highlightMode="highlightMode"
							:noteTheme="resolvedNoteTheme"
							:noteMarks="intonationMarks"
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
					<section v-if="armedStamp" class="scoreview-panel scoreview-armed">
						<span>{{ t('Tap the score where the {stamp} belongs.', { stamp: armedStampName }) }}</span>
						<NcButton :aria-label="t('Cancel')" @click="disarmStamp">
							<template #icon>
								<Close :size="20" />
							</template>
							{{ t('Cancel') }}
						</NcButton>
					</section>
					<section v-if="setlistEditorMode" class="scoreview-panel">
						<div class="scoreview-panel-head">
							<h3>{{ setlistEditorMode === 'new' ? t('New setlist') : t('Edit setlist') }}</h3>
							<NcButton :aria-label="t('Close')" :title="t('Close')" @click="setlistEditorMode = null">
								<template #icon>
									<Close :size="20" />
								</template>
							</NcButton>
						</div>
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
					</section>
					<section v-if="showMixerPanel" class="scoreview-panel">
						<div class="scoreview-panel-head">
							<h3>{{ t('Mixer') }}</h3>
							<NcButton :aria-label="t('Close')" :title="t('Close')" @click="showMixer = false">
								<template #icon>
									<Close :size="20" />
								</template>
							</NcButton>
						</div>
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
					</section>
					<section v-if="showAnnotations" class="scoreview-panel">
						<div class="scoreview-panel-head">
							<h3>{{ t('Notes') }}</h3>
							<NcButton :aria-label="t('Close')" :title="t('Close')" @click="showAnnotations = false">
								<template #icon>
									<Close :size="20" />
								</template>
							</NcButton>
						</div>
						<ScoreAnnotations
							:annotations="listedAnnotations"
							:currentAnchor="currentAnchor"
							:error="annotationError"
							:isLeader="isLeader"
							:parts="scoreParts"
							:armedStamp="armedStamp ? armedStamp.stamp : null"
							@create="onAnnotationCreate"
							@update="onAnnotationUpdate"
							@delete="onAnnotationDelete"
							@jumpTo="onAnnotationJumpToOwn"
							@armStamp="onArmStamp" />
					</section>
					<!--
						Eigene Aufnahmen und Intonation. Bleibt waehrend
						des Aufnehmens offen stehen - dort sitzt der Stopp-Knopf.
					-->
					<section v-if="showPractice" class="scoreview-panel">
						<div class="scoreview-panel-head">
							<h3>{{ t('Recording and intonation') }}</h3>
							<NcButton :aria-label="t('Close')" :title="t('Close')" @click="showPractice = false">
								<template #icon>
									<Close :size="20" />
								</template>
							</NcButton>
						</div>
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
					</section>
					<!--
						Der Aufklapper „Probe": die Leitungen - hier sammelt
						sich, was eine Probe organisiert, statt jedes Stueck davon
						als eigenen Knopf in die Leiste zu setzen.
					-->
					<section v-if="showRehearsal" class="scoreview-panel">
						<div class="scoreview-panel-head">
							<h3>{{ t('Rehearsal') }}</h3>
							<NcButton :aria-label="t('Close')" :title="t('Close')" @click="showRehearsal = false">
								<template #icon>
									<Close :size="20" />
								</template>
							</NcButton>
						</div>
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
					</section>
				</div>
			</div>
		</template>
	</div>
</template>

<script>
import axios from '@nextcloud/axios'
import { loadState } from '@nextcloud/initial-state'
import { translate } from '@nextcloud/l10n'
import { getRootUrl } from '@nextcloud/router'
import { getCurrentInstance, ref, shallowRef, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcPopover from '@nextcloud/vue/components/NcPopover'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import AccountGroup from 'vue-material-design-icons/AccountGroup.vue'
import AlertCircleOutline from 'vue-material-design-icons/AlertCircleOutline.vue'
import ArrowExpandHorizontal from 'vue-material-design-icons/ArrowExpandHorizontal.vue'
import BookmarkOutline from 'vue-material-design-icons/BookmarkOutline.vue'
import Close from 'vue-material-design-icons/Close.vue'
import CommentTextOutline from 'vue-material-design-icons/CommentTextOutline.vue'
import CrosshairsGps from 'vue-material-design-icons/CrosshairsGps.vue'
import DotsHorizontal from 'vue-material-design-icons/DotsHorizontal.vue'
import FitToPage from 'vue-material-design-icons/FitToPage.vue'
import FormatAlignMiddle from 'vue-material-design-icons/FormatAlignMiddle.vue'
import Fullscreen from 'vue-material-design-icons/Fullscreen.vue'
import FullscreenExit from 'vue-material-design-icons/FullscreenExit.vue'
import Magnify from 'vue-material-design-icons/Magnify.vue'
import Metronome from 'vue-material-design-icons/Metronome.vue'
import Microphone from 'vue-material-design-icons/Microphone.vue'
import NotebookOutline from 'vue-material-design-icons/NotebookOutline.vue'
import Palette from 'vue-material-design-icons/Palette.vue'
import Pause from 'vue-material-design-icons/Pause.vue'
import Play from 'vue-material-design-icons/Play.vue'
import PlaylistPlus from 'vue-material-design-icons/PlaylistPlus.vue'
import Refresh from 'vue-material-design-icons/Refresh.vue'
import Repeat from 'vue-material-design-icons/Repeat.vue'
import Tune from 'vue-material-design-icons/Tune.vue'
import FollowBadge from './FollowBadge.vue'
import LeaderPanel from './LeaderPanel.vue'
import MicIndicator from './MicIndicator.vue'
import RecordingPanel from './RecordingPanel.vue'
import ScoreAnnotations from './ScoreAnnotations.vue'
import ScoreLockButton from './ScoreLockButton.vue'
import ScoreMixer from './ScoreMixer.vue'
import ScorePage from './ScorePage.vue'
import ScoreSpeedTrainer from './ScoreSpeedTrainer.vue'
import { stampName } from './ScoreStamps.vue'
import ScoreStartTone from './ScoreStartTone.vue'
import SetlistBar from './SetlistBar.vue'
import SetlistEditor from './SetlistEditor.vue'
import { useAnnotations } from '../composables/useAnnotations.js'
import { useAutoScroll } from '../composables/useAutoScroll.js'
import { useConversionStatus } from '../composables/useConversionStatus.js'
import { useFollowSession } from '../composables/useFollowSession.js'
import { useIntonation } from '../composables/useIntonation.js'
import { useLeaders } from '../composables/useLeaders.js'
import { useLoop } from '../composables/useLoop.js'
import { useMetronome } from '../composables/useMetronome.js'
import { useMicrophone } from '../composables/useMicrophone.js'
import { useMyPart } from '../composables/useMyPart.js'
import { useMyPartSound } from '../composables/useMyPartSound.js'
import { usePaging } from '../composables/usePaging.js'
import { usePerformanceMode } from '../composables/usePerformanceMode.js'
import { usePlayback } from '../composables/usePlayback.js'
import { useRecorder } from '../composables/useRecorder.js'
import { useScoreFacts } from '../composables/useScoreFacts.js'
import { useSetlist } from '../composables/useSetlist.js'
import { useSpeedTrainer } from '../composables/useSpeedTrainer.js'
import { useStartTone } from '../composables/useStartTone.js'
import { useViewerPreferences } from '../composables/useViewerPreferences.js'
import { useWakeLock } from '../composables/useWakeLock.js'
import { useZoom } from '../composables/useZoom.js'
import { normalizeFeatures } from '../lib/featureFlags.js'
import { HIGHLIGHT_PRESETS, normalizeHighlightColor } from '../lib/highlightStyle.js'
import { resolveKey } from '../lib/keyMap.js'
import { browserFileUrl } from '../lib/micAccess.js'
import { channelsOfPart } from '../lib/panLayout.js'
import { MAX_MANUAL_OFFSET_MS, MIN_MANUAL_OFFSET_MS } from '../lib/playbackTime.js'
import { formatMeasureWithMark, resolveJumpTarget } from '../lib/scoreFacts.js'
import {
	buildTimeline,
	findElementAtPoint,
	findMeasureStartTime,
	findNearestOccurrenceTimeMs,
	resolveMeasurePosition,
} from '../lib/scoreLayout.js'
import { createScoreSync } from '../lib/scoreSync.js'
import { MODE_TONIC, MODE_VOICE } from '../lib/startTone.js'

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

// Ab dieser Breite (px) passen Transport UND Werkzeuge nebeneinander.
// Gerechnet, nicht geraten: 9 Icon-Knoepfe zu 44px (Touch-Zielgroesse, siehe
// das Override von --default-clickable-area im CSS) plus Wiedergabe,
// Tempoanzeige, Taktfeld, Suchlauf und Zwischenraeume ergeben rund 780px.
// Darunter braeche die Reihe um - auf einem Telefon (360-412px) auf drei
// Zeilen, rund 18% der Bildschirmhoehe.
const COMPACT_BAR_WIDTH_PX = 700

// Wie lange die Leiste im Vollbild stehen bleibt, bevor sie sich waehrend der
// Wiedergabe zur Fortschrittslinie zusammenzieht.
const BAR_IDLE_MS = 3000

export default {
	name: 'ScoreViewer',

	components: {
		BookmarkOutline,
		FollowBadge,
		LeaderPanel,
		MicIndicator,
		Microphone,
		RecordingPanel,
		ScorePage,
		ScoreMixer,
		ScoreAnnotations,
		ScoreLockButton,
		ScoreSpeedTrainer,
		ScoreStartTone,
		NcButton,
		NcTextField,
		NcLoadingIcon,
		NcEmptyContent,
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
		AlertCircleOutline,
		ArrowExpandHorizontal,
		FitToPage,
		Fullscreen,
		FullscreenExit,
		Metronome,
		CrosshairsGps,
		DotsHorizontal,
		Magnify,
		Palette,
		Refresh,
		AccountGroup,
		PlaylistPlus,
		SetlistBar,
		SetlistEditor,
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
	 * Zerlegung von ScoreViewer.vue in Composables - schrittweise, ein
	 * Bereich nach dem anderen.
	 *
	 * Der Zustand, den mehrere Bereiche teilen (Zeitachsen, etag, Dauer,
	 * Zeitquelle), zieht dafuer aus `data()` hierher. Das ist die Bruecke,
	 * die den Umbau ueberhaupt schrittweise moeglich macht: Vue 3 legt
	 * setup()-Rueckgaben auf der Instanz aus und entpackt Refs dabei, der
	 * bestehende Options-API-Code kann also unveraendert `this.timeline`
	 * lesen und `this.durationMs = x` schreiben, waehrend die Composables
	 * dieselben Refs direkt benutzen.
	 *
	 * `clock` bewusst als shallowRef: dahinter haengt ein AudioContext samt
	 * Synthesizer (lib/player.js). Tiefe Reaktivitaet darauf waere sinnlos
	 * teuer, und niemand verlaesst sich auf Reaktivitaet INNERHALB des
	 * Objekts - nur darauf, dass der Austausch der Zeitquelle auffaellt.
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
		const timeline = shallowRef(null)
		const measuresTimeline = shallowRef(null)
		const currentEtag = shallowRef(null)
		const durationMs = shallowRef(0)
		const clock = shallowRef(null)
		// meta.json - fuer die Partiturfakten (Tonarten, Studierbuchstaben).
		const scoreMeta = shallowRef(null)

		// Einzeln und unter ihren eigenen Namen zurueckgegeben, nicht als
		// verschachteltes Objekt: Vue entpackt Refs nur auf der OBERSTEN Ebene
		// der setup()-Rueckgabe. `annotationsApi.visible` waere im Template ein
		// Ref-Objekt statt eines Wertes - und so bleiben Template und
		// Aufrufstellen unveraendert, der Umbau ist also wirklich nur ein
		// Umzug.
		// `onReady` behaelt bewusst das $nextTick aus dem frueheren
		// pollStatus(): loadScore() misst am Ende die Seitenbreite fuer das
		// Zoom-Preset, die Seiten muessen dafuer schon gerendert sein.
		let onScoreReady = async () => {}
		const conversion = useConversionStatus({
			fileId: () => activeFileId.value,
			onReady: (body) => onScoreReady(body),
		})
		const setOnScoreReady = (fn) => {
			onScoreReady = fn
		}

		// rootEl/scrollEl als Funktionen statt als Refs: die Elemente existieren
		// erst im Zustand "ready" (v-if im Template), ein Ref waere beim
		// Anlegen des Composables noch leer.
		const vm = getCurrentInstance()
		const scrollElement = () => vm?.proxy?.$refs?.scroll ?? null
		const zoomApi = useZoom({
			rootEl: () => vm?.proxy?.$el ?? null,
			scrollEl: scrollElement,
		})
		const autoScroll = useAutoScroll({ scrollEl: scrollElement })
		const playback = usePlayback({ clock, durationMs, defaultTempoBpm: DEFAULT_TEMPO_BPM })

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
		// sieht, haengt an beidem (lib/annotationFilter.js). Die Stimmen der
		// Partitur liegen (noch) in data() - daher der Weg ueber die Instanz.
		const annotations = useAnnotations({
			fileId: () => activeFileId.value,
			timeline: () => timeline.value,
			measuresTimeline: () => measuresTimeline.value,
			currentEtag: () => currentEtag.value,
			durationMs: () => durationMs.value,
			seek: (timeMs) => clock.value?.seek(timeMs),
			parts: () => vm?.proxy?.scoreParts ?? [],
			myPartId: () => myPart.myPartId.value,
			isLeader: () => leaders.isLeader.value,
		})

		// Der Speed-Trainer zaehlt an den Loop-Durchlaeufen, braucht aber selbst
		// den Loop-Zustand - der Rueckruf wird deshalb nachgereicht, wie
		// setOnScoreReady oben.
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
		// nachgereicht, wie setOnScoreReady oben.
		let isFollowing = () => false
		const performance = usePerformanceMode({
			rootEl: () => vm?.proxy?.$el ?? null,
			onKeydown: (event) => vm?.proxy?.onKeydown(event),
			onEnter: () => vm?.proxy?.onPerformanceEnter(),
			following: () => isFollowing(),
		})

		const paging = usePaging({
			scrollEl: scrollElement,
			pages: autoScroll.pages,
			measureRects: (pageIndex) => (measuresTimeline.value
				? Object.values(measuresTimeline.value.elements).filter((rect) => rect.page === pageIndex)
				: []),
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
			onNeedPart: () => vm?.proxy?.openVoiceSelection(),
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
			seekToMeasure: (measure) => vm?.proxy?.followSeek(measure) ?? null,
			setLoop: (from, to) => loop.setRange(from, to),
			clearLoop: () => loop.clear(),
			playTone: () => startTone.startToneFor(),
			currentPosition: () => vm?.proxy?.followPosition() ?? null,
			currentLoop: () => (loop.active.value
				? { from: Number(loop.fromMeasure.value), to: Number(loop.toMeasure.value) }
				: null),
		})
		isFollowing = () => follow.following.value

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
			mixerOpen: () => vm?.proxy?.showMixerPanel ?? false,
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
			myStaff: () => vm?.proxy?.intonationStaff ?? null,
			measureOf: (ms) => resolveMeasurePosition(measuresTimeline.value, ms, durationMs.value)?.measureNumber ?? null,
			loadAudio: recorder.loadAudio,
		})

		return {
			activeFileId,
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
			restoreZoom: zoomApi.restore,
			setOnScoreReady,
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
			setUpViewportObserver: zoomApi.observeViewport,
			toggleFullscreen: zoomApi.toggleFullscreen,
			onFullscreenChange: zoomApi.onFullscreenChange,
			onTouchStart: zoomApi.onTouchStart,
			onTouchMove: zoomApi.onTouchMove,
			onTouchEnd: zoomApi.onTouchEnd,
			stopZoomObserver: zoomApi.stop,
			resetZoom: zoomApi.reset,
			setPageRef: autoScroll.setPageRef,
			updateAutoScroll: autoScroll.update,
			onScrollGestureStart: autoScroll.onUserGestureStart,
			onScrollGestureEnd: autoScroll.onUserGestureEnd,
			noteManualScroll: autoScroll.noteManualScroll,
			resetAutoScroll: autoScroll.reset,
			metronomeEnabled: metronome.enabled,
			metronomeBeats: metronome.beats,
			updateMetronome: metronome.tick,
			startCountIn: metronome.startCountIn,
			clearCountIn: metronome.clearCountIn,
			destroyMetronome: metronome.destroy,
			resetMetronome: metronome.reset,
			loopFromMeasure: loop.fromMeasure,
			loopToMeasure: loop.toMeasure,
			loopActive: loop.active,
			loopMarkers: loop.markers,
			toggleLoop: loop.toggle,
			loopWrapIfDue: loop.wrapIfDue,
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
			applyScoreMetadata: playback.applyMetadata,
			setUpSilentClock: playback.useSilentClock,
			setUpRealPlayer: playback.useRealPlayer,
			skipSoundFontLoad: playback.skipSoundFontLoad,
			setNoSoundFontConfigured: playback.setNoSoundFontConfigured,
			togglePlay: playback.toggle,
			onSeekInput: playback.onSeekInput,
			onTempoBpmInput: playback.onTempoBpmInput,
			onVolumesChanged: playback.applyChannelVolumes,
			onProgramChanged: playback.setProgram,
			samplePlaybackTime: playback.sampleTime,
			destroyPlayback: playback.destroy,
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
			stopPolling: conversion.stop,
			resetConversion: conversion.reset,
			timeline,
			measuresTimeline,
			currentEtag,
			durationMs,
			clock,
			scoreMeta,
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
			loadAnnotations: annotations.load,
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
			// Zaehlt jeden reset(): Ein loadScore(), das nach einem await eine
			// andere Zahl vorfindet, gehoert zu einem Stueck, das nicht mehr
			// offen ist (Stueckwechsel mitten im Laden).
			loadGeneration: 0,
			// Der Setlisten-Editor: 'edit' | 'new' | null (zu).
			setlistEditorMode: null,
			// Der Aufklapper „Aufnahme und Intonation".
			showPractice: false,
			// score.mid dieser Partitur - die Intonation laedt es nach, wenn
			// ohne Ton niemand sonst es geholt hat (useScoreFacts.ensureMidi).
			midiUrl: null,
			// Bis wann das Nachfuehren nach einem Sprung der Leitung auch
			// gegen manuelles Blaettern gilt (followSeek).
			followScrollUntil: 0,
			pageUrls: [],
			cursorRect: null,
			// Zeitquelle: entweder lib/player.js (echte Wiedergabe, sobald ein
			// SoundFont konfiguriert ist) oder lib/silentClock.js (Platzhalter) -
			// beide erfüllen dieselbe Schnittstelle, diese Komponente muss den
			// Unterschied nur für die Tempo-/Mixer-Zusatzfunktionen kennen
			// (hasRealPlayer).
			showMixer: false,
			// Welche Stimme "meine" ist (`myPartId`, aus useMyPart in setup())
			// wird ueber "Meine Stimme" im Mixer gesetzt (ScoreMixer.vue).
			// Dieselbe Wahl steuert Lautstaerke UND Markierung im Notenbild;
			// zwei getrennte Bedienelemente fuer dieselbe Aussage waeren eine
			// Fehlerquelle.
			focusMyPart: false,
			showNoteText: false,
			scoreParts: [],
			// Ob sich die Notenzeilen ueberhaupt Stimmen zuordnen lassen -
			// gemeldet von der ersten geladenen Seite (ScorePage.vue).
			staffMappingOk: false,
			sync: null,
			timeDisplayHandle: null,
			// Autoscroll (siehe scrollPlan.js) und Kopfangaben. Der Partiturtitel
			// steht nicht in der Leiste - Nextclouds Viewer zeigt den Dateinamen
			// ohnehin in seiner eigenen Kopfzeile, und die Leiste braucht den
			// Platz fuer Bedienelemente.
			totalMeasures: 0,
			// Für die Probenarbeit: zeigt die laufende Taktnummer und nimmt das
			// Sprungziel entgegen (ein Feld statt Anzeige + Eingabe) - siehe
			// measureFieldFocused. Text, weil es mit Studierbuchstaben auch
			// „47 (C+3)" zeigt und „C" annimmt.
			measureInput: '1',
			// Solange das Taktfeld den Fokus hat, wird measureInput nicht mehr
			// von der Wiedergabe nachgeführt: sonst überschriebe der nächste
			// Takt die gerade getippte Zahl.
			measureFieldFocused: false,
			// Der Aufklapper mit den Studierbuchstaben.
			marksOpen: false,
			// Für Notizen: private und geteilte.
			currentElid: null,
			// Womit diese Darstellung erzeugt wurde: der Konvertierungsweg aus
			// dem Statusendpunkt ('sidecar' | 'local' | null fuer aeltere
			// Datensaetze) und - davon unabhaengig - die Version, mit der die
			// Partitur geschrieben wurde (meta.json). Rein zum Anzeigen,
			// nichts im Viewer verzweigt danach (E3).
			rendererBackend: null,
			mscoreVersion: null,
			// Ob diese Nutzerin die Partitur neu konvertieren lassen darf -
			// kommt aus dem Statusendpunkt, nicht aus einer eigenen Annahme
			// ueber Freigaben.
			canReconvert: false,
			// Die Leiste. `compactBar` haengt an der GEMESSENEN Breite, nicht
			// an einer Media Query: Der Viewer sitzt mal in Nextclouds Viewer,
			// mal im eigenen Modal, mal im Vollbild - massgeblich ist die
			// Breite, die er tatsaechlich hat, nicht die des Fensters. Und die
			// Umschaltung ist strukturell (Popovers in einem eigenen Streifen
			// statt daneben), das kann CSS allein nicht leisten.
			compactBar: false,
			toolsOpen: false,
			barCollapsed: false,
			barIdleHandle: null,
			barObserver: null,
		}
	},

	computed: {
		/** Die Farbvorschlaege - der Name dazu wird erst hier uebersetzt (E4). */
		highlightPresets() {
			return HIGHLIGHT_PRESETS
		},

		/**
		 * Womit diese Seiten gesetzt wurden, als ein Satz.
		 *
		 * Der aufgezeichnete Weg DIESER Konvertierung, nicht die aktuelle
		 * Einstellung der Instanz: Nach einem Wechsel stammt eine gecachte
		 * Partitur weiterhin vom alten Weg, und genau dann wird die Frage
		 * gestellt. `null` heisst "vor Einfuehrung der Aufzeichnung
		 * konvertiert" - eine ehrliche Luecke statt einer Vermutung.
		 *
		 * Bewusst OHNE Versionsnummer des Konvertierers: Die einzige
		 * Versionsangabe, die hier vorliegt, ist `meta.mscoreVersion` - und
		 * die ist die Version, mit der die PARTITUR geschrieben wurde, nicht
		 * die des Konvertierers (nachgeprueft: sie stimmt mit
		 * `<programVersion>` in der .mscz ueberein, nicht mit dem
		 * Engine-Release). Sie steht deshalb als eigene Zeile daneben, mit
		 * ihrer eigenen Beschriftung.
		 */
		rendererText() {
			if (this.rendererBackend === 'local') {
				return this.t('scoreview-engine on this server (MuseScore as WebAssembly)')
			}
			if (this.rendererBackend === 'sidecar') {
				return this.t('Sidecar container (MuseScore 4)')
			}
			if (this.rendererBackend === 'client') {
				// Kein gespeicherter Wert wie die beiden oben, sondern eine
				// Aussage ueber DIESE Sitzung: Auf diesem Weg wird nichts
				// gecacht, die Darstellung ist gerade eben hier entstanden.
				return this.t('this browser (MuseScore as WebAssembly)')
			}
			return this.t('Unknown – converted by an earlier version of the app.')
		},

		/**
		 * Was gerade passiert, waehrend im Browser konvertiert wird.
		 *
		 * Die Engine meldet keinen echten Fortschritt - nur die Seitenschleife
		 * ist zaehlbar. Wichtiger als eine Prozentzahl ist ohnehin die Stufe
		 * davor: Beim ersten Oeffnen laedt der Browser rund 14 MB Engine, und
		 * das soll dastehen, statt als Stille zu erscheinen.
		 *
		 * @return {string} leer, wenn serverseitig konvertiert wurde
		 */
		conversionProgressText() {
			const stand = this.clientProgress
			if (!stand) {
				// Serverseitig konvertiert: Hier steht sonst nichts, weil es
				// nichts zu melden gibt. Dauert es ungewoehnlich lange, ist
				// genau dieses Schweigen die Fehlinformation - dann steht hier
				// der haeufigste Grund, waehrend der Kreisel weiterlaeuft.
				// Noch kein Urteil: Das faellt erst mit der Frist in
				// useConversionStatus.js.
				return this.longWait
					? this.t('This is taking longer than usual. If it never finishes, check that background job processing (cron) is running on this server.')
					: ''
			}
			if (stand.phase === 'source') {
				return this.t('Loading score…')
			}
			if (stand.phase === 'engine') {
				return this.t('Loading the conversion engine (about 14 MB, once per browser)…')
			}
			if (stand.phase === 'layout') {
				return this.t('Laying out the score…')
			}
			if (stand.phase === 'pages') {
				return this.t('Page {n} of {total}', { n: stand.page, total: stand.of })
			}
			return ''
		},

		// Musikalischer Anker der aktuellen Wiedergabeposition ("+ An aktueller
		// Stelle") - null solange measuresTimeline/durationMs noch nicht
		// geladen sind.
		// Auf der Anzeigezeit, nicht der rohen: Die Taktnummer, die hier
		// herauskommt, steht in der Leiste und ist der Anker einer neuen
		// Notiz - beides bezieht sich auf die Stelle, die gerade klingt.
		currentAnchor() {
			if (!this.measuresTimeline) {
				return null
			}
			const position = resolveMeasurePosition(this.measuresTimeline, this.displayTimeMs, this.durationMs)
			if (!position) {
				return null
			}
			return { ...position, elid: this.currentElid, anchorEtag: this.currentEtag }
		},

		// Für das Taktfeld in der Leiste (zugleich das Sprungfeld) - null vor
		// dem ersten berechneten Anker (currentAnchor braucht measuresTimeline).
		currentMeasureNumber() {
			return this.currentAnchor ? this.currentAnchor.measureNumber : null
		},

		/**
		 * Was das Taktfeld zeigt: „47 (C+3)" mit Studierbuchstaben,
		 * sonst die Zahl.
		 */
		measureDisplay() {
			return this.currentMeasureNumber === null
				? null
				: formatMeasureWithMark(this.currentMeasureNumber, this.rehearsalMarks)
		},

		setlistTitle() {
			return this.setlist?.title ?? ''
		},

		setlistCanEdit() {
			return this.setlist?.canEdit === true && !this.standalonePage
		},

		armedStampName() {
			return this.armedStamp ? stampName(this.armedStamp.stamp) : ''
		},

		// Der Mixer braucht echte Wiedergabe UND aufgelöste Kanäle - ohne
		// beides bliebe eine leere Karte über dem Notenbild stehen.
		partCount() {
			return this.scoreParts.length
		},

		/**
		 * Die Stimme, die als „meine" gilt, als Index in meta.parts - also in
		 * derselben Reihenfolge, in der die Notenzeilen im System stehen.
		 */
		myPartIndex() {
			if (this.myPartId === null) {
				return null
			}
			const index = this.scoreParts.findIndex((part) => String(part.id) === String(this.myPartId))
			return index === -1 ? null : index
		},

		/**
		 * Ob „nur meine Zeile" ueberhaupt etwas bewirken kann. Ohne diese
		 * Pruefung stuende dort ein Schalter, der bei einem Klavierauszug oder
		 * einer Partitur mit ausgeblendeten leeren Zeilen wirkungslos bliebe.
		 */
		canFocusMyPart() {
			return this.myPartIndex !== null && this.staffMappingOk
		},

		showMixerPanel() {
			return this.hasRealPlayer && this.showMixer && this.mixerChannels.length > 0
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
			if (!(this.durationMs > 0)) {
				return 0
			}
			return Math.min(100, (this.displayTimeMs / this.durationMs) * 100)
		},

		minAudioOffsetMs() {
			return MIN_MANUAL_OFFSET_MS
		},

		maxAudioOffsetMs() {
			return MAX_MANUAL_OFFSET_MS
		},

		/**
		 * Die Notenzeile der eigenen Stimme fuer die Intonation (`st-N`, M10) -
		 * nur, wo die Zeilen sich den Stimmen zuordnen lassen (eine Zeile je
		 * Stimme, siehe lib/staffBands.js). Sonst bleibt es bei Nadel und
		 * Liste, statt die Zeile der Nachbarstimme zu faerben.
		 */
		intonationStaff() {
			return this.staffMappingOk && this.myPartIndex !== null ? this.myPartIndex : null
		},

		/** „Im Browser oeffnen" (E8): Nextclouds Kurzlink auf diese Datei. */
		browserUrl() {
			return browserFileUrl(window.location.origin, getRootUrl(), this.activeFileId)
		},

		automaticLatencyRounded() {
			return Math.round(this.automaticLatencyMs)
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
				// Rueckruf VOR dem ersten poll() setzen, nicht in created():
				// dieser Watcher ist `immediate` und laeuft damit noch vor
				// created(). Ein sehr schnelles "ready" liefe sonst in den
				// leeren Vorgabe-Rueckruf aus setup().
				this.setOnScoreReady(async (body) => {
					await this.$nextTick()
					await this.loadScore(body)
				})
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

		// Leiste einfahren waehrend der Wiedergabe - als Watcher statt in
		// togglePlay() verdrahtet, damit JEDER Weg, der die Wiedergabe startet
		// (Tastaturkuerzel, Einzaehler-Ende, Loop-Neustart), automatisch erfasst
		// ist. Das Wachhalten des Bildschirms haengt am selben Zustand, steht
		// aber in useWakeLock.js (setup()), weil dort auch der
		// Aufführungsmodus zaehlt.
		isPlaying(playing) {
			if (playing) {
				this.scheduleBarCollapse()
			} else {
				// Angehalten wird bedient - dann gehoert die Leiste hin.
				this.showBar()
			}
		},

		// Die eingefahrene Leiste gibt es nur im Vollbild: Nur dort ist der
		// Platz das eigentliche Thema, und nur dort gibt es keine
		// Nextcloud-Umgebung drumherum, in der ein leerer Streifen irritierte.
		isFullscreen(fullscreen) {
			if (fullscreen) {
				this.scheduleBarCollapse()
			} else {
				this.showBar()
			}
		},

		// Taktfeld der Wiedergabe nachführen, solange niemand darin tippt
		// (Anzeige und Eingabe sind dasselbe Feld).
		measureDisplay(text) {
			if (text !== null && !this.measureFieldFocused) {
				this.measureInput = text
			}
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
		this.cleanup()
		this.destroyRecorder()
		this.destroyIntonation()
		this.turnMicOff()
		document.removeEventListener('fullscreenchange', this.onFullscreenChange)
		this.$el.removeEventListener('keydown', this.onKeydown)
		this.stopBarObserver()
		if (this.barIdleHandle) {
			clearTimeout(this.barIdleHandle)
			this.barIdleHandle = null
		}
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
		 * Der Name einer Farbvorschlags-Kachel, fuer Vorlesewerkzeuge.
		 *
		 * @param {string} id Kennung aus HIGHLIGHT_PRESETS
		 * @return {string}
		 */
		presetLabel(id) {
			const names = {
				red: this.t('Red'),
				orange: this.t('Orange'),
				magenta: this.t('Magenta'),
				violet: this.t('Violet'),
				green: this.t('Green'),
				blue: this.t('Blue'),
			}
			return names[id] ?? id
		},

		// Der Farbwaehler feuert waehrend des Ziehens laufend - das Speichern
		// ist deshalb verzoegert (useViewerPreferences), die Anzeige nicht:
		// die Partitur faerbt sich beim Ziehen mit.
		onHighlightColorInput(event) {
			this.highlightColor = normalizeHighlightColor(event.target.value)
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

		/**
		 * Der Anfangston fand keine Stimme: die Stimmauswahl oeffnen.
		 * Sie steckt im Mixer („Meine Stimme" je Zeile) - eine zweite Auswahl
		 * fuer dieselbe Aussage waere eine Fehlerquelle (siehe data()).
		 */
		openVoiceSelection() {
			if (!this.can('mixer')) {
				return
			}
			this.showMixer = true
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
		 * Die Taktrechtecke einer Seite - sie liefern ScorePage die
		 * Systemgrenzen (siehe lib/staffBands.js).
		 *
		 * @param {number} pageIndex 0-indiziert
		 * @return {Array<object>}
		 */
		systemRectsForPage(pageIndex) {
			if (!this.measuresTimeline) {
				return []
			}
			return Object.values(this.measuresTimeline.elements).filter((rect) => rect.page === pageIndex)
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
			this.loadGeneration++
			// Vor dem Abbau der Wiedergabe: Eine laufende Aufnahme wird noch
			// abgeschlossen und gespeichert, solange ihr Kontext lebt.
			this.resetRecorder()
			this.resetIntonation()
			this.midiUrl = null
			this.cleanup()
			this.resetStartTone()
			this.resetSpeedTrainer()
			this.scoreMeta = null
			this.resetConversion()
			this.pageUrls = []
			this.cursorRect = null
			this.resetPlayback()
			this.showMixer = false
			this.resetAutoScroll()
			this.totalMeasures = 0
			this.scoreParts = []
			this.focusMyPart = false
			this.staffMappingOk = false
			this.pageDimensions = {}
			this.timeline = null
			this.measuresTimeline = null
			this.measureInput = '1'
			this.resetScoreFacts()
			this.resetLoop()
			this.resetZoom()
			this.measureFieldFocused = false
			this.resetAnnotations()
			this.currentEtag = null
			this.currentElid = null
			this.rendererBackend = null
			this.mscoreVersion = null
			this.canReconvert = false
			this.resetMetronome()
		},

		cleanup() {
			this.stopPolling()
			this.sync = null
			this.destroyMetronome()
			if (this.timeDisplayHandle) {
				cancelAnimationFrame(this.timeDisplayHandle)
				this.timeDisplayHandle = null
			}
			this.destroyPlayback()
			this.stopZoomObserver()
		},

		async loadScore({ files, soundFontUrl, renderer, canReconvert }) {
			const mine = this.loadGeneration
			const stale = () => mine !== this.loadGeneration
			try {
				const [timingRes, measuresRes, metaRes] = await Promise.all([
					axios.get(files.timingJson),
					axios.get(files.measuresJson),
					axios.get(files.metaJson),
				])
				if (stale()) {
					return
				}
				const timeline = buildTimeline(timingRes.data)
				this.timeline = timeline
				this.measuresTimeline = buildTimeline(measuresRes.data)
				this.pageUrls = files.pages
				this.currentEtag = files.etag
				this.scoreMeta = metaRes.data
				this.applyScoreMetadata(metaRes.data)
				// Fuer die Zuordnung Notenzeile -> Stimme: Reihenfolge UND
				// Anzahl aus meta.json, nicht aus dem Mixer - der laesst die
				// Metronomspur weg und zaehlt damit anders (siehe mixerLayout.js).
				this.scoreParts = metaRes.data.parts ?? []
				// Herkunft der Darstellung (E3). Zwei verschiedene Aussagen,
				// die leicht verwechselt werden: `renderer.backend` ist der
				// Konvertierungsweg, `meta.mscoreVersion` die Version, mit der
				// die Partitur GESCHRIEBEN wurde - siehe rendererText().
				this.rendererBackend = renderer?.backend ?? null
				this.mscoreVersion = metaRes.data.mscoreVersion ?? null
				this.canReconvert = canReconvert === true
				this.totalMeasures = metaRes.data.measures ?? this.measuresTimeline.events.length
				this.loadAnnotations()
				// Die Studierbuchstaben kommen auf dem Sidecar-Weg nur aus dem MIDI
				// - und das laedt sonst nur, wer Ton hat (useScoreFacts).
				this.ensureScoreMidi(files.midi)
				this.midiUrl = files.midi
				// Startzoom "Seitenbreite" statt fester Faktor 1: die Seite hat
				// eine echte Breite (ScorePage.vue), ein fester Faktor 1 hieße auf
				// einem Telefon 900px Seitenbreite neben 390px Bildschirm. Erst
				// nach $nextTick, damit .scoreview-pages die Seiten schon enthält
				// und seine endgültige Breite (inkl. Scrollbalken) steht.
				await this.$nextTick()
				if (stale()) {
					return
				}
				// Das zuletzt gewaehlte Preset, nicht immer „Seitenbreite": Beim
				// Stueckwechsel einer Setliste bleibt der Zoom.
				this.restoreZoom()
				this.setUpViewportObserver()

				if (soundFontUrl) {
					await this.setUpRealPlayer(files.midi, soundFontUrl, timeline)
					if (stale()) {
						return
					}
				} else {
					this.setNoSoundFontConfigured()
					this.setUpSilentClock(timeline)
				}

				this.sync = createScoreSync(timeline, (rect) => {
					this.cursorRect = rect
					// Nachführen statt nur beim Seitenwechsel zu springen. Nach
					// einem Sprung der Leitung auch dann, wenn gerade von Hand
					// geblaettert wurde: Blaettern loest das Folgen nicht, der
					// Sprung soll also sichtbar werden (followSeek).
					this.updateAutoScroll(rect, Date.now() < this.followScrollUntil)
				})

				this.pumpTimeDisplay()
			} catch (err) {
				if (stale()) {
					return
				}
				this.state = 'error'
				this.errorMessage = err.message
			}
		},

		/**
		 * DIE Zeitschleife des Viewers - die einzige: Cursor, Notiz-Anker,
		 * Loop und Metronom brauchen alle dieselbe Zeitquelle und denselben
		 * Takt.
		 *
		 * Reihenfolge ist nicht beliebig: erst die Zeit abgreifen, dann Cursor
		 * und Notiz-Anker daraus ableiten, dann Loop und Metronom - die
		 * späteren Schritte lesen die Zeitwerte.
		 *
		 * **Zwei Zeiten, und hier fällt die Zuordnung.** `samplePlaybackTime()`
		 * legt beide an (usePlayback.js): `currentTimeMs` ist die rohe Zeit der
		 * Audiouhr, `displayTimeMs` das, was gerade zu HÖREN ist - um die
		 * Ausgabelatenz zurückgerechnet, über Bluetooth bis zu 300 ms. Der
		 * Cursor bekommt die Anzeigezeit; Loop und Metronom bekommen die rohe,
		 * weil beide gegen dieselbe Audiouhr terminieren bzw. springen. Ein
		 * pauschaler Abzug schon in der Zeitquelle wäre deshalb falsch - die
		 * ausführliche Begründung steht in lib/playbackTime.js.
		 */
		pumpTimeDisplay() {
			const step = () => {
				if (this.clock) {
					this.samplePlaybackTime()
					// Eine Auflösung für beides: der Cursor braucht das Rechteck,
					// eine Notiz das elid (currentAnchor) - so wird nicht zweimal
					// nach demselben elid gesucht.
					this.currentElid = this.sync?.update(this.displayTimeMs) ?? null
					// Loop (Kernfunktion für Probenarbeit): sobald das Ende
					// erreicht/überschritten ist, zurück zum Anfang - hier statt in
					// silentClock.js/player.js geprüft, weil beide Zeitquellen
					// dieselbe kleine seek()-Schnittstelle erfüllen und Looping keine
					// Eigenschaft der Zeitquelle selbst ist.
					//
					// Mit der ROHEN Zeit: So springt der Ton rechtzeitig, und der
					// Cursor springt (auf der Anzeigezeit) genau dann, wenn der
					// Sprung hörbar wird. Mit der Anzeigezeit käme der Rücksprung
					// um die Ausgabelatenz zu spät - man hörte über das
					// Loop-Ende hinaus.
					this.loopWrapIfDue(this.currentTimeMs)
					// Ebenfalls die rohe Zeit: Der Klick wird über die Uhr des
					// AudioContext terminiert (metronomeClick.js) und geht damit
					// durch dieselbe Ausgabelatenz wie die Musik. Mit der
					// Anzeigezeit käme er um genau diese Latenz zu spät - der
					// Fehler wäre verdoppelt statt behoben.
					this.updateMetronome(this.currentTimeMs)
				}
				this.timeDisplayHandle = requestAnimationFrame(step)
			}
			step()
		},

		jumpToMeasure(measureNumber) {
			if (!this.measuresTimeline || !this.clock || !this.can('seek')) {
				return
			}
			const timeMs = findMeasureStartTime(this.measuresTimeline, Number(measureNumber))
			if (timeMs !== null) {
				this.clock.seek(timeMs)
			}
		},

		/**
		 * Ein Sprung der Leitung („Folgt mir"). Nicht ueber jumpToMeasure():
		 * Das fragt can('seek'), und im Aufführungsmodus soll der Sprung
		 * trotzdem ankommen, solange gefolgt wird - ob er darf,
		 * entscheidet useFollowSession ueber `followJump`. Und es meldet kein
		 * eigenes Navigieren, das das Folgen loesen wuerde.
		 *
		 * @param {number} measureNumber
		 * @return {?number} die Zielzeit, oder null ohne Partitur oder Takt
		 */
		followSeek(measureNumber) {
			if (!this.measuresTimeline || !this.clock) {
				return null
			}
			const timeMs = findMeasureStartTime(this.measuresTimeline, Number(measureNumber))
			if (timeMs === null) {
				return null
			}
			// Der Sequencer rueckt nach dem Suchlauf noch auf das naechste
			// Ereignis vor - das Fenster deckt das Nachfuehren bis dahin ab.
			this.followScrollUntil = Date.now() + 1500
			this.clock.seek(timeMs)
			return timeMs
		},

		/**
		 * Die eigene Stelle fuer die Leitung: Takt, und der Studierbuchstabe,
		 * wenn der Takt genau einer ist (die Anzeige „C" statt „C+3").
		 *
		 * @return {?{measure:number, mark:?string}}
		 */
		followPosition() {
			const measure = this.currentMeasureNumber
			if (!measure) {
				return null
			}
			const mark = this.rehearsalMarks.find((m) => m.measure === measure)
			return { measure, mark: mark ? mark.text : null }
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

		/**
		 * Die Eingabe des Taktfelds anspringen: „47", „C" oder „C+3" - die
		 * Form der Anzeige laesst sich also unveraendert eintippen
		 * (resolveJumpTarget). Unbekanntes tut nichts, statt irgendwohin zu
		 * springen.
		 */
		jumpToMeasureInput() {
			const target = resolveJumpTarget(this.measureInput, this.rehearsalMarks, this.totalMeasures || null)
			if (target !== null && this.can('seek')) {
				this.followNavigation('measure')
				this.jumpToMeasure(target.measure)
			}
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

		/**
		 * Ein Chip ist eine Entscheidung - danach geht der Aufklapper zu.
		 * Offen gelassen gab er beim spaeteren Schliessen den Fokus an seinen
		 * Knopf zurueck, und wer inzwischen ins Taktfeld tippte, verlor dabei
		 * die Eingabe (gemessen: je nach Zeitpunkt).
		 *
		 * @param {{measure:number}} mark
		 */
		jumpToMark(mark) {
			this.marksOpen = false
			if (this.can('seek')) {
				this.followNavigation('mark')
			}
			this.jumpToMeasure(mark.measure)
		},

		// Beim Hineintippen den ganzen Inhalt markieren: „47 (C+3)" will
		// niemand ergaenzen, sondern ersetzen.
		onMeasureFieldFocus(event) {
			this.measureFieldFocused = true
			event?.target?.select?.()
		},

		onMeasureFieldBlur() {
			this.measureFieldFocused = false
			if (this.measureDisplay !== null) {
				this.measureInput = this.measureDisplay
			}
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

		jumpRelativeMeasure(delta) {
			const current = this.currentAnchor?.measureNumber
			if (!current || !this.can('seek')) {
				return
			}
			this.followNavigation('measure')
			this.jumpToMeasure(Math.max(1, current + delta))
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

		formatTime(ms) {
			const totalSeconds = Math.floor(ms / 1000)
			const minutes = Math.floor(totalSeconds / 60)
			const seconds = totalSeconds % 60
			return `${minutes}:${String(seconds).padStart(2, '0')}`
		},

		/**
		 * Eine Millisekundenangabe der Betriebsdiagnose - `null` heisst
		 * "der Browser sagt dazu nichts" und ist etwas anderes als 0.
		 *
		 * @param {?number} ms
		 * @return {string}
		 */
		formatMs(ms) {
			return ms === null || !Number.isFinite(ms) ? '–' : `${Math.round(ms)} ms`
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

		/**
		 * Die Leiste ausfahren und die Ruhefrist neu starten.
		 */
		showBar() {
			this.barCollapsed = false
			this.scheduleBarCollapse()
		},

		/**
		 * Die Leiste nach einer Ruhefrist einfahren - aber nur im Vollbild und
		 * nur waehrend der Wiedergabe. Ausserhalb davon wird bedient, und eine
		 * Leiste, die dabei verschwindet, waere eine Zumutung.
		 */
		scheduleBarCollapse() {
			if (this.barIdleHandle) {
				clearTimeout(this.barIdleHandle)
				this.barIdleHandle = null
			}
			if (!this.isFullscreen || !this.isPlaying) {
				return
			}
			this.barIdleHandle = setTimeout(() => {
				this.barIdleHandle = null
				this.barCollapsed = true
				this.toolsOpen = false
			}, BAR_IDLE_MS)
		},

		/**
		 * Die Leistenbreite beobachten (siehe `compactBar` in data()).
		 * Beobachtet wird das Wurzelelement, nicht die Leiste selbst: Deren
		 * Breite haengt an ihrem Inhalt, das waere ein Kreisverkehr.
		 */
		observeBarWidth() {
			this.stopBarObserver()
			if (typeof ResizeObserver === 'undefined') {
				return
			}
			this.barObserver = new ResizeObserver(([entry]) => {
				this.compactBar = entry.contentRect.width < COMPACT_BAR_WIDTH_PX
			})
			this.barObserver.observe(this.$el)
		},

		stopBarObserver() {
			this.barObserver?.disconnect()
			this.barObserver = null
		},

	},
}
</script>

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

.scoreview-status {
	padding: 3rem 1rem;
	text-align: center;
	color: var(--color-text-maxcontrast);
}

.scoreview-status-detail {
	margin-top: 0.5rem;
	font-size: 0.9em;
}

.scoreview-error {
	color: var(--color-error);
}

.scoreview-error-detail {
	display: inline-block;
	text-align: start;
	color: var(--color-text-maxcontrast);
	font-size: 0.9em;
}

.scoreview-error-detail pre {
	white-space: pre-wrap;
	overflow-wrap: break-word;
}

.scoreview-hint {
	margin-bottom: 8px;
}

/*
 * Zwei Streifen: Transport (immer) und Werkzeuge (auf schmalen Schirmen nur
 * auf Abruf). Auf breiten Schirmen stehen beide nebeneinander und ergeben
 * dieselbe eine Zeile wie zuvor.
 */
.scoreview-bar {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 8px;
	border-bottom: 1px solid var(--color-border);
	background: var(--color-main-background);
}

.scoreview-bar-transport,
.scoreview-bar-tools {
	display: flex;
	align-items: center;
	gap: 6px;
}

/* Der Transport bekommt den Platz, den der Suchlauf braucht; die Werkzeuge
   sind so breit, wie sie sind. */
.scoreview-bar-transport {
	flex: 1 1 auto;
	min-width: 0;
}

.scoreview-bar-tools {
	flex: 0 0 auto;
}

/*
 * Schmal: die Werkzeuge unter den Transport, und nur, wenn sie geholt wurden.
 * Sie duerfen dann umbrechen - im aufgeklappten Zustand ist Hoehe kein
 * Problem, dauerhaft war sie es.
 */
.scoreview-bar--compact {
	flex-direction: column;
	align-items: stretch;
}

.scoreview-bar--compact .scoreview-bar-tools {
	flex-wrap: wrap;
	justify-content: flex-start;
	padding-block-start: 4px;
	border-block-start: 1px solid var(--color-border);
}

.scoreview-play {
	flex: 0 0 auto;
}

/* Der Punkt am „Mehr"-Knopf: ein aktives Werkzeug muss sichtbar bleiben,
   auch wenn sein Schalter im Menue steckt. */
.scoreview-more-icon {
	position: relative;
	display: inline-flex;
}

.scoreview-more-dot {
	position: absolute;
	inset-block-start: -2px;
	inset-inline-end: -2px;
	inline-size: 8px;
	block-size: 8px;
	border-radius: 50%;
	background: var(--color-primary-element);
}

/*
 * Die eingefahrene Leiste im Vollbild. Bewusst als Knopf und nicht als reine
 * Linie: Sie ist anzutippen, und Vorlesewerkzeuge sollen das auch so
 * ankuendigen.
 */
.scoreview-bar-line {
	flex: 0 0 auto;
	display: block;
	inline-size: 100%;
	block-size: 8px;
	padding: 0;
	border: none;
	border-radius: 0;
	background: var(--color-background-dark);
	cursor: pointer;
}

.scoreview-bar-line-fill {
	display: block;
	block-size: 100%;
	background: var(--color-primary-element);
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
.scoreview-bar-transport {
	container-type: inline-size;
}

.scoreview-bar--compact .scoreview-bar-transport {
	gap: 4px;
}

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

.scoreview-tempo-button {
	font-variant-numeric: tabular-nums;
}

.scoreview-tone-mode {
	white-space: nowrap;
}

/* Popover-Inhalte (Loop, Tempo/Metronom, Zoom) - eine Spalte, breit genug
   für die längste Beschriftung, aber schmal genug, um nicht das halbe
   Notenbild zu verdecken. */
.scoreview-popover {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px;
	min-width: 260px;
	max-width: 320px;
}

.scoreview-popover-row {
	display: flex;
	gap: 8px;
}

.scoreview-popover-label {
	display: flex;
	flex-direction: column;
	gap: 4px;
	color: var(--color-text-maxcontrast);
}

.scoreview-popover-group {
	border: none;
	margin: 0;
	padding: 0;
}

.scoreview-popover-group legend {
	color: var(--color-text-maxcontrast);
	padding: 0 0 4px 0;
}

/* Erklaerung unter einem Regler - sie wird einmal gelesen, wenn unklar ist,
   was der Regler tut, und steht danach nur noch da. */
.scoreview-popover-hint {
	color: var(--color-text-maxcontrast);
	font-size: 0.85em;
	line-height: 1.3;
}

/*
 * Die Betriebsdiagnose. Zugeklappt, weil sie nur gebraucht wird, wenn etwas
 * nicht stimmt - und dann vollstaendig, nicht haeppchenweise.
 */
.scoreview-diagnostics {
	color: var(--color-text-maxcontrast);
	font-size: 0.85em;
	line-height: 1.35;
}

.scoreview-diagnostics summary {
	cursor: pointer;
	padding-block: 4px;
}

.scoreview-diagnostics-list {
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.scoreview-diagnostics-list dt {
	font-weight: bold;
}

.scoreview-diagnostics-list dd {
	margin: 0 0 4px 0;
	font-variant-numeric: tabular-nums;
}

.scoreview-diagnostics-note {
	display: block;
	opacity: 0.8;
}

/*
 * Die Farbvorschlaege als Kacheln. Gross genug fuer einen Finger auf Glas
 * (das Tablet am Notenstaender ist der Hauptfall) und quadratisch statt rund
 * - eine Farbflaeche liest sich als Farbprobe, ein Punkt als Schalter.
 */
.scoreview-swatches {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.scoreview-swatch {
	inline-size: 34px;
	block-size: 34px;
	border: 2px solid transparent;
	border-radius: 6px;
	padding: 0;
	cursor: pointer;
	/* Der Rahmen der Auswahl liegt AUSSERHALB der Farbflaeche (box-shadow
	   statt eines dickeren border): ein hineinwachsender Rahmen wuerde die
	   Farbprobe selbst verkleinern, und ausgerechnet bei der gewaehlten
	   Farbe. */
	box-shadow: none;
}

.scoreview-swatch--active {
	border-color: var(--color-main-background);
	box-shadow: 0 0 0 2px var(--color-main-text);
}

/*
 * Der freie Farbwaehler. Feste Hoehe, damit er neben den Kacheln nicht
 * unterschiedlich hoch ausfaellt - Browser bemassen `input[type=color]`
 * jeweils eigen.
 */
.scoreview-color-input {
	inline-size: 100%;
	block-size: 34px;
	padding: 2px;
	cursor: pointer;
}

/*
 * Die Herkunftsangabe. Kleiner und zurueckgenommen: Sie wird einmal gelesen,
 * wenn etwas anders aussieht als erwartet, und steht danach nur noch da.
 */
.scoreview-origin {
	margin: 0;
	padding-block-start: 8px;
	border-block-start: 1px solid var(--color-border);
	color: var(--color-text-maxcontrast);
	font-size: 0.9em;
	line-height: 1.35;
}

.scoreview-origin-label {
	display: block;
	font-weight: bold;
}

.scoreview-origin-note {
	display: block;
	padding-block-start: 4px;
}

.scoreview-origin-action {
	margin-block-start: 8px;
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

.scoreview-panel {
	pointer-events: auto;
	box-sizing: border-box;
	background: var(--color-main-background);
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large, 8px);
	box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
	padding: 8px 12px 12px 12px;
	max-height: 100%;
	overflow-y: auto;
}

.scoreview-panel-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.scoreview-panel-head h3 {
	margin: 0;
	font-size: 1.1em;
}
</style>
