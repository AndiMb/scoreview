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
						:aria-label="isPlaying ? t('Pause') : t('Play')"
						:title="isPlaying ? t('Pause') : t('Play')"
						@click="togglePlay">
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
						:aria-label="t('Playback position')"
						@input="onSeekInput">
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
						<span class="scoreview-measure-field">
							<NcTextField
								v-model.number="measureInput"
								type="number"
								min="1"
								:label="t('Measure')"
								:title="t('Measure – enter a number and press Enter to jump there')"
								labelOutside
								@focus="measureFieldFocused = true"
								@blur="onMeasureFieldBlur"
								@keyup.enter="jumpToMeasure(measureInput)" />
						</span>
						<span class="scoreview-measure-total">/ {{ totalMeasures || '–' }}</span>
					</span>
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
					<NcPopover>
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
									@click="toggleLoop">
									<template #icon>
										<Repeat :size="20" />
									</template>
									{{ loopActive ? t('Loop on') : t('Loop off') }}
								</NcButton>
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
					<NcPopover>
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
						:pressed="metronomeEnabled"
						:aria-label="metronomeEnabled ? t('Metronome on') : t('Metronome off')"
						:title="metronomeEnabled ? t('Metronome on') : t('Metronome off')"
						@click="metronomeEnabled = !metronomeEnabled">
						<template #icon>
							<Metronome :size="20" />
						</template>
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
					<NcPopover>
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
						v-if="hasRealPlayer"
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
						v-if="canFocusMyPart"
						:pressed="focusMyPart"
						:aria-label="t('Show only my part')"
						:title="t('Show only my part')"
						@click="focusMyPart = !focusMyPart">
						<template #icon>
							<FormatAlignMiddle :size="20" />
						</template>
					</NcButton>
					<NcButton
						:pressed="showNoteText"
						:aria-label="t('Show notes in the score')"
						:title="t('Show notes in the score')"
						@click="showNoteText = !showNoteText">
						<template #icon>
							<CommentTextOutline :size="20" />
						</template>
					</NcButton>
					<NcButton
						:pressed="showAnnotations"
						:aria-label="t('Notes')"
						:title="t('Notes')"
						@click="showAnnotations = !showAnnotations">
						<template #icon>
							<NotebookOutline :size="20" />
						</template>
					</NcButton>
					<NcButton
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
							:loopMarkers="loopMarkers"
							:systemRects="systemRectsForPage(i)"
							:myPartIndex="myPartIndex"
							:focusMyPart="focusMyPart"
							:partCount="partCount"
							:showNoteText="showNoteText"
							:highlightMode="highlightMode"
							@noteClick="onNoteClick"
							@markerClick="onAnnotationJumpToById"
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
				<div v-if="showMixerPanel || showAnnotations" class="scoreview-panels">
					<section v-if="showMixerPanel" class="scoreview-panel">
						<div class="scoreview-panel-head">
							<h3>{{ t('Mixer') }}</h3>
							<NcButton :aria-label="t('Close')" :title="t('Close')" @click="showMixer = false">
								<template #icon>
									<Close :size="20" />
								</template>
							</NcButton>
						</div>
						<ScoreMixer
							:channels="mixerChannels"
							:presetList="presetList"
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
							:annotations="annotations"
							:currentAnchor="currentAnchor"
							:error="annotationError"
							@create="onAnnotationCreate"
							@update="onAnnotationUpdate"
							@delete="onAnnotationDelete"
							@jumpTo="onAnnotationJumpTo" />
					</section>
				</div>
			</div>
		</template>
	</div>
</template>

<script>
import axios from '@nextcloud/axios'
import { translate } from '@nextcloud/l10n'
import { getCurrentInstance, shallowRef } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcPopover from '@nextcloud/vue/components/NcPopover'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import AlertCircleOutline from 'vue-material-design-icons/AlertCircleOutline.vue'
import ArrowExpandHorizontal from 'vue-material-design-icons/ArrowExpandHorizontal.vue'
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
import NotebookOutline from 'vue-material-design-icons/NotebookOutline.vue'
import Palette from 'vue-material-design-icons/Palette.vue'
import Pause from 'vue-material-design-icons/Pause.vue'
import Play from 'vue-material-design-icons/Play.vue'
import Refresh from 'vue-material-design-icons/Refresh.vue'
import Repeat from 'vue-material-design-icons/Repeat.vue'
import Tune from 'vue-material-design-icons/Tune.vue'
import ScoreAnnotations from './ScoreAnnotations.vue'
import ScoreMixer from './ScoreMixer.vue'
import ScorePage from './ScorePage.vue'
import { useAnnotations } from '../composables/useAnnotations.js'
import { useAutoScroll } from '../composables/useAutoScroll.js'
import { useConversionStatus } from '../composables/useConversionStatus.js'
import { useLoop } from '../composables/useLoop.js'
import { useMetronome } from '../composables/useMetronome.js'
import { usePlayback } from '../composables/usePlayback.js'
import { useViewerPreferences } from '../composables/useViewerPreferences.js'
import { useZoom } from '../composables/useZoom.js'
import { HIGHLIGHT_PRESETS, normalizeHighlightColor } from '../lib/highlightStyle.js'
import { MAX_MANUAL_OFFSET_MS, MIN_MANUAL_OFFSET_MS } from '../lib/playbackTime.js'
import {
	buildTimeline,
	findElementAtPoint,
	findMeasureStartTime,
	findNearestOccurrenceTimeMs,
	resolveMeasurePosition,
} from '../lib/scoreLayout.js'
import { createScoreSync } from '../lib/scoreSync.js'

// MuseScores eigene Vorgabe für Partituren ohne Tempoangabe (docs/architecture.md
// M8: metadata.tempo kann 0 sein, z.B. bei repeat-test.mscz) - dient nur als
// Bezugswert für die BPM-Anzeige/-Eingabe, gekennzeichnet über tempoGuessed.
const DEFAULT_TEMPO_BPM = 120

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

// Tasten, die die Seite scrollen, ohne dass der Browser eine Zeigergeste
// meldet. Pfeil hoch/runter fehlen bewusst: Links/rechts sind bereits mit dem
// Taktsprung belegt, und hoch/runter blieben als einziges Paar uebrig, das
// ohne Sonderfall scrollt.
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'])

export default {
	name: 'ScoreViewer',

	components: {
		ScorePage,
		ScoreMixer,
		ScoreAnnotations,
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
	},

	props: {
		// Von OCA.Viewer übergeben (siehe registerHandler in src/viewer.js).
		fileid: {
			type: [Number, String],
			required: true,
		},
	},

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
		const timeline = shallowRef(null)
		const measuresTimeline = shallowRef(null)
		const currentEtag = shallowRef(null)
		const durationMs = shallowRef(0)
		const clock = shallowRef(null)

		const annotations = useAnnotations({
			fileId: () => props.fileid,
			timeline: () => timeline.value,
			measuresTimeline: () => measuresTimeline.value,
			currentEtag: () => currentEtag.value,
			durationMs: () => durationMs.value,
			seek: (timeMs) => clock.value?.seek(timeMs),
		})

		// Einzeln und unter den bisherigen Namen zurueckgegeben, nicht als
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
			fileId: () => props.fileid,
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

		const loop = useLoop({
			measuresTimeline: () => measuresTimeline.value,
			durationMs: () => durationMs.value,
			isPlaying: () => clock.value?.isPlaying() ?? false,
			seek: (timeMs) => clock.value?.seek(timeMs),
			startCountIn: (targetMs) => metronome.startCountIn(targetMs, DEFAULT_TEMPO_BPM),
			clearCountIn: metronome.clearCountIn,
		})

		return {
			setOnScoreReady,
			zoom: zoomApi.zoom,
			zoomFollowsWidth: zoomApi.followsWidth,
			isFullscreen: zoomApi.isFullscreen,
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
			loopRestartTarget: loop.restartTarget,
			setLoopFromMeasure: loop.setFromCurrentMeasure,
			resetLoop: loop.reset,
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
			requestWakeLock: playback.requestWakeLock,
			releaseWakeLock: playback.releaseWakeLock,
			destroyPlayback: playback.destroy,
			resetPlayback: playback.reset,
			highlightColor: preferences.highlightColor,
			highlightMode: preferences.highlightMode,
			highlightStyle: preferences.highlightStyle,
			state: conversion.state,
			clientProgress: conversion.clientProgress,
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
			annotations: annotations.annotations,
			annotationError: annotations.error,
			showAnnotations: annotations.visible,
			annotationMarkers: annotations.markers,
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
			pageUrls: [],
			cursorRect: null,
			// Zeitquelle: entweder lib/player.js (echte Wiedergabe, sobald ein
			// SoundFont konfiguriert ist) oder lib/silentClock.js (Platzhalter) -
			// beide erfüllen dieselbe Schnittstelle, diese Komponente muss den
			// Unterschied nur für die Tempo-/Mixer-Zusatzfunktionen kennen
			// (hasRealPlayer).
			showMixer: false,
			// Welche Stimme "meine" ist - gesetzt ueber "Meine Stimme" im
			// Mixer (ScoreMixer.vue). Dieselbe Wahl steuert Lautstaerke UND
			// Markierung im Notenbild; zwei getrennte Bedienelemente fuer
			// dieselbe Aussage waeren eine Fehlerquelle.
			myPartId: null,
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
			// measureFieldFocused.
			measureInput: 1,
			// Solange das Taktfeld den Fokus hat, wird measureInput nicht mehr
			// von der Wiedergabe nachgeführt: sonst überschriebe der nächste
			// Takt die gerade getippte Zahl.
			measureFieldFocused: false,
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
				return ''
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

		automaticLatencyRounded() {
			return Math.round(this.automaticLatencyMs)
		},

	},

	watch: {
		fileid: {
			immediate: true,
			handler() {
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
			},
		},

		// Bildschirm waehrend der Wiedergabe wachhalten - als Watcher statt in
		// togglePlay() verdrahtet, damit JEDER Weg, der die Wiedergabe startet
		// (Tastaturkuerzel, Einzaehler-Ende, Loop-Neustart), automatisch erfasst
		// ist, ohne an jeder Stelle einzeln daran zu denken.
		isPlaying(playing) {
			if (playing) {
				this.requestWakeLock()
				this.scheduleBarCollapse()
			} else {
				this.releaseWakeLock()
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
		currentMeasureNumber(measureNumber) {
			if (measureNumber !== null && !this.measureFieldFocused) {
				this.measureInput = measureNumber
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
	},

	beforeUnmount() {
		this.cleanup()
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
			this.myPartId = partId
			if (partId === null) {
				this.focusMyPart = false
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
			this.cleanup()
			this.resetConversion()
			this.pageUrls = []
			this.cursorRect = null
			this.resetPlayback()
			this.showMixer = false
			this.resetAutoScroll()
			this.totalMeasures = 0
			this.scoreParts = []
			this.myPartId = null
			this.focusMyPart = false
			this.staffMappingOk = false
			this.pageDimensions = {}
			this.timeline = null
			this.measuresTimeline = null
			this.measureInput = 1
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
			try {
				const [timingRes, measuresRes, metaRes] = await Promise.all([
					axios.get(files.timingJson),
					axios.get(files.measuresJson),
					axios.get(files.metaJson),
				])
				const timeline = buildTimeline(timingRes.data)
				this.timeline = timeline
				this.measuresTimeline = buildTimeline(measuresRes.data)
				this.pageUrls = files.pages
				this.currentEtag = files.etag
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
				// Startzoom "Seitenbreite" statt fester Faktor 1: die Seite hat
				// eine echte Breite (ScorePage.vue), ein fester Faktor 1 hieße auf
				// einem Telefon 900px Seitenbreite neben 390px Bildschirm. Erst
				// nach $nextTick, damit .scoreview-pages die Seiten schon enthält
				// und seine endgültige Breite (inkl. Scrollbalken) steht.
				await this.$nextTick()
				this.applyZoomPreset('width')
				this.setUpViewportObserver()

				if (soundFontUrl) {
					await this.setUpRealPlayer(files.midi, soundFontUrl, timeline)
				} else {
					this.setNoSoundFontConfigured()
					this.setUpSilentClock(timeline)
				}

				this.sync = createScoreSync(timeline, (rect) => {
					this.cursorRect = rect
					// Nachführen statt nur beim Seitenwechsel zu springen.
					this.updateAutoScroll(rect)
				})

				this.pumpTimeDisplay()
			} catch (err) {
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
					const loopTarget = this.loopRestartTarget(this.currentTimeMs)
					if (loopTarget !== null) {
						this.clock.seek(loopTarget)
					}
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
			if (!this.measuresTimeline || !this.clock) {
				return
			}
			const timeMs = findMeasureStartTime(this.measuresTimeline, Number(measureNumber))
			if (timeMs !== null) {
				this.clock.seek(timeMs)
			}
		},

		onMeasureFieldBlur() {
			this.measureFieldFocused = false
			if (this.currentMeasureNumber !== null) {
				this.measureInput = this.currentMeasureNumber
			}
		},

		// Tastaturkürzel für die Probe - greifen nur, wenn der Viewer den
		// Fokus hat (Listener sitzt auf this.$el, keydown bubbelt dorthin,
		// siehe mounted()) und der Fokus nicht in einem Eingabefeld liegt
		// (sonst würde z.B. das Pfeiltasten-Navigieren im Takt-Eingabefeld
		// gestohlen).
		onKeydown(event) {
			const tag = event.target?.tagName
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) {
				return
			}
			if (event.code === 'Space') {
				event.preventDefault()
				this.togglePlay()
			} else if (event.code === 'ArrowRight') {
				event.preventDefault()
				this.jumpRelativeMeasure(1)
			} else if (event.code === 'ArrowLeft') {
				event.preventDefault()
				this.jumpRelativeMeasure(-1)
			} else if (event.code === 'KeyL') {
				event.preventDefault()
				this.toggleLoop()
			} else if (event.key === '+') {
				event.preventDefault()
				this.zoomBy(this.zoomStep)
			} else if (event.key === '-') {
				event.preventDefault()
				this.zoomBy(1 / this.zoomStep)
			} else if (event.key === '0') {
				// Zurück zur Seitenbreite - und wieder der Fenstergröße
				// folgend, wie beim Öffnen.
				event.preventDefault()
				this.applyZoomPreset('width')
			} else if (SCROLL_KEYS.has(event.key)) {
				// Bewusst OHNE preventDefault: Diese Tasten sollen weiter
				// scrollen. Gemeldet wird nur, DASS gescrollt wird - der
				// Browser meldet für Tastatur-Scrollen keine Geste, und ohne
				// diesen Hinweis führte die App der Wiedergabe sofort wieder
				// nach (siehe useAutoScroll.js).
				this.noteManualScroll()
			}
		},

		jumpRelativeMeasure(delta) {
			const current = this.currentAnchor?.measureNumber
			if (!current) {
				return
			}
			this.jumpToMeasure(Math.max(1, current + delta))
		},

		// Umkehrung von M4: Klick auf eine Note springt dorthin -
		// ScorePage.vue liefert nur die Klickposition in SVG-Einheiten, die
		// eigentliche Element-/Zeit-Auflösung passiert hier mit der vollen
		// timeline (scoreLayout.js).
		onNoteClick({ page, x, y }) {
			if (!this.timeline || !this.clock) {
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
