<template>
	<div class="scoreview-viewer">
		<div v-if="state === 'converting' || state === 'loading'" class="scoreview-status">
			<NcLoadingIcon :size="32" :name="state === 'loading' ? t('Loading…') : t('Converting…')" />
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
				EINE Leiste, und zwar ausserhalb des Scroll-Bereichs (Phase 22).
				Bis Phase 21 waren es zwei sticky Leisten IM Scroll-Container -
				davon blieb nur die erste sichtbar, die zweite (Takt, Loop, Zoom,
				Vollbild) und die Panels waren nur ganz oben erreichbar, wohin man
				beim Lesen nie zurueckkommt (das Autoscroll scrollt schon beim
				Oeffnen darueber hinweg). Als Geschwister eines eigenen
				Scroll-Elements ist "wegscrollen" strukturell unmoeglich - und der
				z-index-Wettlauf gegen die SVG-Seiten aus Phase 17 entfaellt.
			-->
			<div class="scoreview-bar">
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
					:value="currentTimeMs"
					:aria-label="t('Playback position')"
					@input="onSeekInput">
				<span class="scoreview-time">{{ formatTime(currentTimeMs) }} / {{ formatTime(durationMs) }}</span>
				<!--
					Taktanzeige und Sprungfeld sind DASSELBE Feld (Phase 22): die
					dauerhaft sichtbare Angabe aus Phase 16 und das Eingabefeld aus
					Phase 10 zeigten dieselbe Zahl an zwei Stellen und kosteten
					zusammen fast eine halbe Leiste. Solange das Feld den Fokus hat,
					laeuft die Anzeige nicht mit - sonst wuerde die Wiedergabe die
					gerade getippte Zahl ueberschreiben.
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
							<NcButton wide :aria-label="t('Loop from current measure')" @click="loopFromCurrentMeasure">
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
					BPM statt Prozent (Phase 17, auf Basis von M8: metadata.tempo ist
					Viertel-BPM) - der Notensymbol-Text "♩ 80" statt "100%" ist die
					Einheit, die eine Chorleitung tatsaechlich ansagt. tempoGuessed
					markiert Partituren ohne eigene Tempoangabe (M8: tempo kann 0
					sein) sichtbar als geschaetzt, statt eine Genauigkeit
					vorzutaeuschen, die nicht da ist. Der Regler dazu liegt seit
					Phase 22 im Popover - er wird einmal eingestellt, nicht dauernd.
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
			<div class="scoreview-body">
				<div
					ref="scroll"
					class="scoreview-scroll"
					@scroll.passive="onViewerScroll"
					@wheel="onWheel">
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
						Pinch-Zoom (Phase 19): eigene, zweifingrige Geste statt der
						nativen Browser-Seiten-Zoom (die waere fuer die ganze
						Nextcloud-Oberflaeche, nicht nur die Partitur) - siehe
						onTouchMove(), das den Browser-Zoom waehrend der Geste bewusst
						unterdrueckt (preventDefault). Einfingriges Scrollen bleibt
						unangetastet (kein preventDefault dafuer), "Wischen zum
						Blaettern" ist deshalb bewusst NICHT als zusaetzliche
						Horizontal-Geste umgesetzt: das vertikale Scrollen deckt das
						Blaettern in diesem fortlaufenden Einspaltenlayout bereits ab,
						eine eigene Wischgeste haette zudem mit Nextcloud Viewers
						eigener Wisch-zum-naechsten-Datei-Geste auf Mobilgeraeten
						kollidieren koennen (siehe PLAN.md Phase 19).
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
							:zoom="zoom"
							:markers="annotationMarkers"
							:loopMarkers="loopMarkers"
							@noteClick="onNoteClick"
							@markerClick="onAnnotationJumpToById"
							@loaded="onPageLoaded" />
					</div>
				</div>
				<!--
					Mixer und Notizen liegen als Karten UEBER dem Notenbild statt
					davor im Fluss (Phase 22): im Fluss kosteten sie Hoehe, sobald
					sie offen waren, und waren - wie die zweite Leiste - nur ganz
					oben zu sehen. Als Overlay kosten sie nichts, wenn sie zu sind,
					und bleiben erreichbar, wo immer man gerade liest.
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
							@programChanged="onProgramChanged" />
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
import { shallowRef } from 'vue'
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
import CrosshairsGps from 'vue-material-design-icons/CrosshairsGps.vue'
import FitToPage from 'vue-material-design-icons/FitToPage.vue'
import Fullscreen from 'vue-material-design-icons/Fullscreen.vue'
import FullscreenExit from 'vue-material-design-icons/FullscreenExit.vue'
import Magnify from 'vue-material-design-icons/Magnify.vue'
import Metronome from 'vue-material-design-icons/Metronome.vue'
import NotebookOutline from 'vue-material-design-icons/NotebookOutline.vue'
import Pause from 'vue-material-design-icons/Pause.vue'
import Play from 'vue-material-design-icons/Play.vue'
import Repeat from 'vue-material-design-icons/Repeat.vue'
import Tune from 'vue-material-design-icons/Tune.vue'
import ScoreAnnotations from './ScoreAnnotations.vue'
import ScoreMixer from './ScoreMixer.vue'
import ScorePage from './ScorePage.vue'
import { useAnnotations } from '../composables/useAnnotations.js'
import { useConversionStatus } from '../composables/useConversionStatus.js'
import { useScoreSync } from '../composables/useScoreSync.js'
import { computeCountInDelaysMs, estimateBeatsInMeasure, resolveBeatInMeasure } from '../lib/metronome.js'
import { createMetronomeClick } from '../lib/metronomeClick.js'
import { resolveMixerChannels } from '../lib/mixerLayout.js'
import { createPlayer } from '../lib/player.js'
import {
	buildTimeline,
	computeActualSizeZoom,
	computeFitPageZoom,
	computeFitWidthZoom,
	computePinchZoom,
	findElementAtPoint,
	findMeasureStartTime,
	findNearestOccurrenceTimeMs,
	MAX_ZOOM,
	MIN_ZOOM,
	resolveMeasurePosition,
} from '../lib/scoreLayout.js'
import { planAutoScroll, planHorizontalScroll, shouldSuppressAutoScroll } from '../lib/scrollPlan.js'
import { createSilentClock } from '../lib/silentClock.js'
import { findStepIndex } from '../lib/timingSync.js'

// Pausendauer für das Autoscroll-Nachführen nach manuellem Scrollen (Phase
// 16, siehe scrollPlan.js) - lang genug, um in Ruhe zu lesen, kurz genug, um
// nicht wie ein Hänger zu wirken.
const MANUAL_SCROLL_RESUME_MS = 2500
// Wie lange nach einem selbst ausgelösten scrollTo() eingehende scroll-Events
// als "programmatisch" gelten, nicht als manuelles Scrollen (siehe
// onViewerScroll) - großzügig über der CSS-smooth-scroll-Dauer, damit kein
// Nachzittern fälschlich als Nutzereingriff gilt.
const PROGRAMMATIC_SCROLL_WINDOW_MS = 700

// Näherung für die Transport-Gesamtdauer im stummen Platzhalter-Modus
// (kein konfiguriertes SoundFont, siehe unten) - letztes Timing-Event plus
// Puffer für den Ausklang der letzten Note. Mit echtem Player kommt die
// Dauer stattdessen von player.durationMs (tatsächliche MIDI-Länge).
const DURATION_PADDING_MS = 2000
// MuseScores eigene Vorgabe für Partituren ohne Tempoangabe (M8: metadata.tempo
// kann 0 sein, z.B. bei repeat-test.mscz) - dient nur als Bezugswert für die
// BPM-Anzeige/-Eingabe, gekennzeichnet über tempoGuessed (Phase 17).
const DEFAULT_TEMPO_BPM = 120
// Grenzen des Tempofaktors auf playbackRate, wie schon vor der BPM-Anzeige
// (Phase 9 hat nur in diesem Bereich gemessen, dass die Zeitachse
// tempounabhängig bleibt) - die BPM-Eingabe rechnet innerhalb dieser Grenzen.
const MIN_TEMPO_FACTOR = 0.5
const MAX_TEMPO_FACTOR = 1.5
// Vorlauf, mit dem der naechste Metronomschlag gesucht und im AudioContext
// terminiert wird (Phase 22, Zeitachsen-ms). Muss ueber einem
// Bildwiederholtakt liegen (~16ms bei 60Hz), damit kein Schlag verpasst wird,
// und klein genug bleiben, dass ein Sprung/Tempowechsel nicht mehrere schon
// terminierte Klicks hinterherzieht.
const METRONOME_LOOKAHEAD_MS = 60
// Zoomschritt fuer Tastatur (+/-) und Strg+Mausrad - multiplikativ, damit sich
// die gefuehlte Schrittweite ueber den ganzen Bereich (0,25-4) gleich anfuehlt.
const ZOOM_STEP = 1.2

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
		Repeat,
		AlertCircleOutline,
		ArrowExpandHorizontal,
		FitToPage,
		Fullscreen,
		FullscreenExit,
		Metronome,
		CrosshairsGps,
		Magnify,
	},

	props: {
		// Von OCA.Viewer übergeben (siehe registerHandler in src/viewer.js).
		fileid: {
			type: [Number, String],
			required: true,
		},
	},

	/**
	 * Zerlegung von ScoreViewer.vue in Composables (Codereview-Befund B1,
	 * Phase 23/Schritt 6) - schrittweise, ein Bereich nach dem anderen.
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

		return {
			setOnScoreReady,
			state: conversion.state,
			errorMessage: conversion.errorMessage,
			errorCode: conversion.errorCode,
			errorText: conversion.errorText,
			pollStatus: conversion.poll,
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
			currentTimeMs: 0,
			isPlaying: false,
			tempo: 1,
			// Zeitquelle: entweder lib/player.js (echte Wiedergabe, sobald ein
			// SoundFont konfiguriert ist) oder lib/silentClock.js (Platzhalter,
			// siehe PLAN.md Phase 8/9) - beide erfüllen dieselbe Schnittstelle,
			// diese Komponente muss den Unterschied nur für die
			// Tempo-/Mixer-Zusatzfunktionen kennen (hasRealPlayer).
			hasRealPlayer: false,
			// Warum es keinen Ton gibt, im Klartext für die Nutzerin - vorher
			// stand hier pauschal "nicht konfiguriert", auch wenn in Wahrheit
			// der SoundFont-Abruf oder der Synthesizer gescheitert war. Genau
			// das machte "die App gibt keinen Ton aus" von außen undiagnostizierbar.
			playbackError: '',
			// metadata.tracks/parts (Phase 17) - für den zweiten resolveMixerChannels()-
			// Aufruf in setUpRealPlayer() aufgehoben, sobald die echten MIDI-Kanäle
			// bekannt sind (siehe dort).
			metaTracks: null,
			metaParts: null,
			mixerChannels: [],
			presetList: [],
			showMixer: false,
			sync: null,
			pageRefs: [],
			timeDisplayHandle: null,
			// Phase 16: Autoscroll (siehe scrollPlan.js) und Kopfangaben. Der
			// Partiturtitel steht seit Phase 22 nicht mehr in der Leiste -
			// Nextclouds Viewer zeigt den Dateinamen ohnehin in seiner eigenen
			// Kopfzeile, und die Leiste braucht den Platz fuer Bedienelemente.
			totalMeasures: 0,
			// Geometrie der jeweils zuletzt geladenen Seite je Index (Phase 16,
			// Zoom-Presets) - {viewBox, sizeMm}, gefüllt über ScorePage.vue "loaded".
			pageDimensions: {},
			// Zeitstempel (Date.now()) des letzten erkannten MANUELLEN Scrollens,
			// oder null - siehe shouldSuppressAutoScroll()/onViewerScroll().
			lastManualScrollAt: null,
			// Bis zu diesem Zeitpunkt gelten scroll-Events als von uns selbst
			// ausgelöst (performAutoScroll), nicht als manueller Nutzereingriff.
			ignoreScrollUntil: 0,
			isFullscreen: false,
			// Ob der Zoom vor dem Vollbild der Fensterbreite folgte (siehe
			// onFullscreenChange) - Vollbild erzwingt "ganze Seite".
			zoomFollowedWidthBeforeFullscreen: false,
			// Phase 10: Probenarbeit.
			// Zeigt die laufende Taktnummer UND nimmt das Sprungziel entgegen
			// (Phase 22, ein Feld statt Anzeige + Eingabe) - siehe
			// measureFieldFocused.
			measureInput: 1,
			// Solange das Taktfeld den Fokus hat, wird measureInput nicht mehr
			// von der Wiedergabe nachgeführt: sonst überschriebe der nächste
			// Takt die gerade getippte Zahl.
			measureFieldFocused: false,
			// '', nicht null: NcTextField (anders als ein natives <input>) nimmt
			// als modelValue nur string|number entgegen und wirft bei null einen
			// Laufzeitfehler ("Cannot read properties of null"). '' bleibt wie
			// null falsy für die toggleLoop()-Leerprüfung, verhält sich also
			// gleich.
			loopFromMeasure: '',
			loopToMeasure: '',
			loopActive: false,
			loopStartMs: null,
			loopEndMs: null,
			zoom: 1,
			// Solange niemand selbst gezoomt hat, folgt der Zoom der
			// Fenstergröße ("Seitenbreite", siehe setUpViewportObserver) - das
			// ist das Verhalten, das die Seite bis Phase 21 zwangsläufig hatte
			// (`width: 100%`). Ab dem ersten eigenen Zoom gilt der gewählte
			// Faktor absolut, sonst würde die App die Entscheidung der Nutzerin
			// bei jedem Drehen des Tablets wieder verwerfen.
			zoomFollowsWidth: true,
			viewportObserver: null,
			// Phase 11: private Notizen, Phase 18: zusaetzlich geteilte.
			currentElid: null,
			// Phase 17: Tempo in BPM statt Prozent. baseTempoBpm ist
			// metadata.tempo (Viertel-BPM, M8) bzw. DEFAULT_TEMPO_BPM, wenn die
			// Partitur keine Tempoangabe trägt (tempoGuessed dann true) - `tempo`
			// bleibt intern weiterhin der Faktor auf playbackRate (Phase 9: die
			// Zeitachse bleibt davon unberührt), nur die Anzeige/Eingabe ist jetzt BPM.
			baseTempoBpm: DEFAULT_TEMPO_BPM,
			tempoGuessed: false,
			// Phase 17: Metronom/Einzähler - Klick unabhängig vom Haupt-Synth
			// (score.mid trägt nachweislich keine Metronomnoten, siehe
			// lib/metronome.js), deshalb ein eigener AudioContext-Klick statt
			// eines MIDI-Kanals.
			metronomeEnabled: false,
			// 'all' = jeder Schlag (Voreinstellung seit Phase 22), 'downbeat' =
			// nur der Taktanfang (das Verhalten bis Phase 21).
			metronomeBeats: 'all',
			metronomeClick: null,
			// "<Taktindex>:<Schlagindex>" des zuletzt terminierten Klicks, oder
			// null - verhindert Doppelklicks, weil die rAF-Schleife denselben
			// Schlag mehrere Frames lang als fällig sieht.
			lastBeatKey: null,
			// Wiedergabezeit beim letzten Metronom-Tick: ein Rückwärtssprung
			// (Seek, Loop-Neustart) setzt lastBeatKey zurück, damit die Eins
			// danach wieder klickt, auch wenn es derselbe Schlag ist.
			lastMetronomeTimeMs: 0,
			countInTimers: [],
			isCountingIn: false,
			// Phase 19: Pinch-Zoom-Gestenzustand (siehe onTouchStart/-Move/-End).
			isPinching: false,
			pinchStartDistance: 0,
			pinchStartZoom: 1,
			// Phase 19: Bildschirm waehrend der Wiedergabe wachhalten
			// (navigator.wakeLock) - das Sentinel-Objekt selbst wird nie im
			// Template gebraucht, nur zum spaeteren release() aufgehoben.
			wakeLockSentinel: null,
			// Phase 19: SoundFont-Ladefortschritt (~40MB, "das wird auf dem
			// Tablet zuerst wehtun", siehe PLAN.md) statt stummem Warten -
			// getrennt vom permanenten playbackError (der bedeutet "geht nicht",
			// hier heisst es nur "noch nicht fertig").
			soundFontLoading: false,
			soundFontLoadPercent: 0,
			soundFontAbortController: null,
		}
	},

	computed: {
		// Musikalischer Anker der aktuellen Wiedergabeposition (Phase 11,
		// "+ An aktueller Stelle") - null solange measuresTimeline/durationMs
		// noch nicht geladen sind.
		currentAnchor() {
			if (!this.measuresTimeline) {
				return null
			}
			const position = resolveMeasurePosition(this.measuresTimeline, this.currentTimeMs, this.durationMs)
			if (!position) {
				return null
			}
			return { ...position, elid: this.currentElid, anchorEtag: this.currentEtag }
		},

		// Für das Taktfeld in der Leiste (Phase 16, seit Phase 22 zugleich das
		// Sprungfeld) - null vor dem ersten berechneten Anker (currentAnchor
		// braucht measuresTimeline).
		currentMeasureNumber() {
			return this.currentAnchor ? this.currentAnchor.measureNumber : null
		},

		// Nur zur Anzeige im Zoom-Popover.
		zoomPercent() {
			return Math.round(this.zoom * 100)
		},

		minZoom() {
			return MIN_ZOOM
		},

		maxZoom() {
			return MAX_ZOOM
		},

		// Der Mixer braucht echte Wiedergabe UND aufgelöste Kanäle - ohne
		// beides bliebe eine leere Karte über dem Notenbild stehen.
		showMixerPanel() {
			return this.hasRealPlayer && this.showMixer && this.mixerChannels.length > 0
		},

		// BPM-Anzeige/-Eingabe (Phase 17, auf Basis von M8: metadata.tempo ist
		// Viertel-BPM) - gerundet, weil der interne Faktor (this.tempo) in
		// Schritten von 0.05 läuft und eine Nachkommastelle hier keine
		// zusätzliche Genauigkeit ausdrücken würde.
		effectiveTempoBpm() {
			return Math.round(this.baseTempoBpm * this.tempo)
		},

		minTempoBpm() {
			return Math.round(this.baseTempoBpm * MIN_TEMPO_FACTOR)
		},

		maxTempoBpm() {
			return Math.round(this.baseTempoBpm * MAX_TEMPO_FACTOR)
		},

		// Sichtbare Markierung des Loop-Bereichs im Notenbild (Phase 17) - zwei
		// Flaggen an Start-/Ende-Takt, an dieselben Elementkoordinaten wie die
		// Notiz-Marker angelehnt (measuresTimeline.elements), aber eigene
		// Farbe/Form (siehe ScorePage.vue). Markiert bewusst nur den JEWEILIGEN
		// TAKTANFANG, nicht die volle Taktbreite - measures.json liefert nur
		// Punktkoordinaten (M4), keine Taktausdehnung.
		loopMarkers() {
			if (!this.loopActive || !this.measuresTimeline) {
				return []
			}
			const fromRect = this.measuresTimeline.elements[String(Number(this.loopFromMeasure) - 1)]
			const toRect = this.measuresTimeline.elements[String(Number(this.loopToMeasure) - 1)]
			const markers = []
			if (fromRect) {
				markers.push({ id: 'loop-start', kind: 'start', ...fromRect })
			}
			if (toRect) {
				markers.push({ id: 'loop-end', kind: 'end', ...toRect })
			}
			return markers
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

		// Bildschirm waehrend der Wiedergabe wachhalten (Phase 19) - als
		// Watcher statt in togglePlay() verdrahtet, damit JEDER Weg, der die
		// Wiedergabe startet (Tastaturkuerzel, Einzaehler-Ende, Loop-Neustart),
		// automatisch erfasst ist, ohne an jeder Stelle einzeln daran zu denken.
		isPlaying(playing) {
			if (playing) {
				this.requestWakeLock()
			} else {
				this.releaseWakeLock()
			}
		},

		// Taktfeld der Wiedergabe nachführen, solange niemand darin tippt
		// (Phase 22: Anzeige und Eingabe sind dasselbe Feld).
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
		// Der Scroll-Listener sitzt seit Phase 22 im Template
		// (@scroll.passive an .scoreview-scroll): das scrollende Element ist
		// jetzt ein Kind, das erst im Zustand "ready" existiert, this.$el
		// scrollt selbst nicht mehr.
		document.addEventListener('fullscreenchange', this.onFullscreenChange)
		// Tastaturkürzel (Phase 17) NICHT passiv: Leertaste/Pfeiltasten sollen
		// die Seite nicht zusätzlich scrollen (siehe onKeydown - preventDefault
		// nur für die tatsächlich behandelten Tasten, alles andere bleibt
		// unangetastet, insbesondere Nextclouds eigene Kürzel).
		this.$el.addEventListener('keydown', this.onKeydown)
	},

	beforeUnmount() {
		this.cleanup()
		document.removeEventListener('fullscreenchange', this.onFullscreenChange)
		this.$el.removeEventListener('keydown', this.onKeydown)
	},

	methods: {
		// Einzelargument-Wrapper um @nextcloud/l10n translate() (siehe
		// tools/l10n.mjs zur Extraktion) - hier statt auf Modulebene definiert,
		// damit t() dort ausgewertet wird, wo der Text gebraucht wird (Template/
		// computed), nicht einmalig beim Modulimport (PLAN.md Phase 14).
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		setPageRef(el, index) {
			if (el) {
				this.pageRefs[index] = el
			} else {
				delete this.pageRefs[index]
			}
		},

		reset() {
			this.cleanup()
			this.resetConversion()
			this.pageUrls = []
			this.cursorRect = null
			this.currentTimeMs = 0
			this.durationMs = 0
			this.isPlaying = false
			this.tempo = 1
			this.hasRealPlayer = false
			this.playbackError = ''
			this.mixerChannels = []
			this.presetList = []
			this.showMixer = false
			this.pageRefs = []
			this.totalMeasures = 0
			this.pageDimensions = {}
			this.lastManualScrollAt = null
			this.timeline = null
			this.measuresTimeline = null
			this.measureInput = 1
			this.loopFromMeasure = ''
			this.loopToMeasure = ''
			this.loopActive = false
			this.loopStartMs = null
			this.loopEndMs = null
			this.zoom = 1
			this.zoomFollowsWidth = true
			this.measureFieldFocused = false
			this.resetAnnotations()
			this.currentEtag = null
			this.currentElid = null
			this.metaTracks = null
			this.metaParts = null
			this.baseTempoBpm = DEFAULT_TEMPO_BPM
			this.tempoGuessed = false
			this.metronomeEnabled = false
			this.lastBeatKey = null
			this.lastMetronomeTimeMs = 0
			this.isCountingIn = false
			this.isPinching = false
			this.soundFontLoading = false
			this.soundFontLoadPercent = 0
			this.soundFontAbortController = null
		},

		cleanup() {
			this.stopPolling()
			if (this.sync) {
				this.sync.stop()
				this.sync = null
			}
			this.clearCountIn()
			this.metronomeClick?.destroy?.()
			this.metronomeClick = null
			if (this.timeDisplayHandle) {
				cancelAnimationFrame(this.timeDisplayHandle)
				this.timeDisplayHandle = null
			}
			// Gibt den AudioContext frei (siehe lib/player.js) - der
			// silentClock hat kein destroy(), daher der Guard.
			this.clock?.destroy?.()
			this.clock = null
			this.soundFontAbortController?.abort()
			this.soundFontAbortController = null
			this.viewportObserver?.disconnect()
			this.viewportObserver = null
			this.releaseWakeLock()
		},

		async loadScore({ files, soundFontUrl }) {
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
				this.metaTracks = metaRes.data.tracks
				this.metaParts = metaRes.data.parts
				// Vorlaeufig ohne echte Kanaldaten (der Player ist noch nicht
				// geladen) - resolveMixerChannels() faellt dann auf den
				// Spurindex zurueck. setUpRealPlayer() ersetzt das unten durch
				// die tatsaechlichen, aus dem MIDI gelesenen Kanaele (Phase 17,
				// siehe mixerLayout.js zur Index!=Kanal-Falle).
				this.mixerChannels = resolveMixerChannels(this.metaTracks, this.metaParts)
				this.baseTempoBpm = metaRes.data.tempo || DEFAULT_TEMPO_BPM
				this.tempoGuessed = !metaRes.data.tempo
				this.totalMeasures = metaRes.data.measures ?? this.measuresTimeline.events.length
				this.loadAnnotations()
				// Startzoom "Seitenbreite" statt fester Faktor 1 (Phase 22):
				// die Seite hat jetzt eine echte Breite (ScorePage.vue), ein
				// fester Faktor 1 hieße auf einem Telefon 900px Seitenbreite
				// neben 390px Bildschirm. Erst nach $nextTick, damit
				// .scoreview-pages die Seiten schon enthält und seine endgültige
				// Breite (inkl. Scrollbalken) steht.
				await this.$nextTick()
				this.applyZoomPreset('width')
				this.setUpViewportObserver()

				if (soundFontUrl) {
					await this.setUpRealPlayer(files.midi, soundFontUrl)
				} else {
					this.playbackError = this.t('No SoundFont is available (see Settings → ScoreView).')
					this.setUpSilentClock(timeline)
				}

				this.sync = useScoreSync(timeline, this.clock, (rect) => {
					this.cursorRect = rect
					// Nachführen statt nur beim Seitenwechsel zu springen (PLAN.md
					// Phase 16) - ersetzt die frühere lastScrolledPage-Logik aus
					// Phase 8, die nur beim Wechsel der Seite überhaupt scrollte.
					this.updateAutoScroll(rect)
				})

				this.pumpTimeDisplay()
			} catch (err) {
				this.state = 'error'
				this.errorMessage = err.message
			}
		},

		setUpSilentClock(timeline) {
			const lastEventMs = timeline.events.length > 0 ? timeline.events[timeline.events.length - 1].timeMs : 0
			this.durationMs = lastEventMs + DURATION_PADDING_MS
			this.clock = createSilentClock(this.durationMs)
			this.hasRealPlayer = false
		},

		async setUpRealPlayer(midiUrl, soundFontUrl) {
			// Ladefortschritt statt stummem Warten (Phase 19: "die
			// SoundFont-Groesse (~40MB) wird hier zuerst weh tun") - eigener
			// AbortController fuers "Noten ohne Ton"-Weg (skipSoundFontLoad()).
			this.soundFontAbortController = new AbortController()
			this.soundFontLoading = true
			this.soundFontLoadPercent = 0
			try {
				const [midiRes, soundFontBuffer] = await Promise.all([
					axios.get(midiUrl, { responseType: 'arraybuffer' }),
					this.fetchSoundFontWithProgress(soundFontUrl, this.soundFontAbortController.signal),
				])
				const player = await createPlayer(midiRes.data, soundFontBuffer)
				this.clock = player
				this.hasRealPlayer = true
				this.durationMs = player.durationMs
				this.presetList = player.getPresetList() ?? []
				// Jetzt mit den echten, aus dem geladenen MIDI gelesenen Kanaelen
				// neu aufloesen (siehe mixerLayout.js) - vorher (s.o.) stand hier
				// nur die Index-Naeherung, weil player.getTrackChannels() ein
				// geladenes MIDI braucht.
				this.mixerChannels = resolveMixerChannels(this.metaTracks, this.metaParts, player.getTrackChannels())
			} catch (err) {
				if (err.name === 'AbortError') {
					// "Noten ohne Ton"-Weg (Phase 19) - bewusster Nutzerwunsch,
					// kein Fehler, deshalb ohne console.error.
					this.playbackError = this.t('Sound loading skipped.')
				} else {
					// SoundFont evtl. nicht erreichbar (falsche URL, CORS, Netzwerk) -
					// Notenansicht bleibt trotzdem nutzbar, nur ohne Ton (siehe
					// PLAN.md Risiko "SoundFont-Auslieferung").
					// eslint-disable-next-line no-console
					console.error('ScoreView: echte Wiedergabe konnte nicht initialisiert werden, falle auf stummen Modus zurück.', err)
					this.playbackError = err.message
				}
				// buildTimeline({events: []}) wäre eine leere Zeitachse: der
				// Transport hätte danach Dauer 0 und die Partitur ließe sich
				// nicht mehr durchfahren. Die echte Timeline steht hier bereits
				// zur Verfügung - sie ist auch im stummen Modus die richtige.
				this.setUpSilentClock(this.timeline)
			} finally {
				this.soundFontLoading = false
				this.soundFontAbortController = null
			}
		},

		// Liest den SoundFont-Abruf gestreamt statt in einem Rutsch, um den
		// Ladefortschritt zu kennen (Phase 19) - Content-Length ist bei einer
		// gleichbleibenden, cachebaren Datei (siehe Phase 9 Cache-Header)
		// zuverlaessig gesetzt; ohne sie (z.B. bei komprimiertem Transfer ohne
		// bekannte Endlaenge) bleibt der Fortschritt bei 0%, der Abruf
		// funktioniert trotzdem unveraendert.
		//
		// Bewusst fetch() statt @nextcloud/axios: die SoundFont-URL ist eine
		// vom Admin frei konfigurierbare, potenziell fremde Adresse (siehe
		// PLAN.md E1/Phase 9) - @nextcloud/axios haengt an jede Anfrage
		// automatisch den CSRF-requesttoken-Header an, der dort weder
		// gebraucht wird noch hin sollte, und erzwingt dadurch unnoetig einen
		// CORS-Preflight.
		async fetchSoundFontWithProgress(url, signal) {
			const res = await fetch(url, { signal })
			if (!res.ok) {
				// Die app-eigene Route antwortet im Fehlerfall mit {"error": "…"}
				// (SoundFontController) - die Meldung ist fuer die Nutzerin
				// brauchbarer als "HTTP 503".
				const detail = await res.json().then((b) => b?.error).catch(() => null)
				throw new Error(detail || `SoundFont-Abruf fehlgeschlagen: HTTP ${res.status}`)
			}
			const total = Number(res.headers.get('Content-Length')) || 0
			if (!total || !res.body?.getReader) {
				return res.arrayBuffer()
			}
			const reader = res.body.getReader()
			const chunks = []
			let received = 0
			for (;;) {
				const { done, value } = await reader.read()
				if (done) {
					break
				}
				chunks.push(value)
				received += value.length
				this.soundFontLoadPercent = Math.round((received / total) * 100)
			}
			const buffer = new Uint8Array(received)
			let offset = 0
			for (const chunk of chunks) {
				buffer.set(chunk, offset)
				offset += chunk.length
			}
			return buffer.buffer
		},

		// Eigene rAF-Schleife statt Vue-Reaktivität direkt aus useScoreSync,
		// weil currentTimeMs/isPlaying jeden Frame ändern (Transport-Anzeige),
		// der Cursor selbst aber nur bei Notenwechsel (siehe useScoreSync.js) -
		// getrennte Zuständigkeiten, gleiche Zeitquelle.
		pumpTimeDisplay() {
			const step = () => {
				if (this.clock) {
					this.currentTimeMs = this.clock.getCurrentTimeMs()
					this.isPlaying = this.clock.isPlaying()
					// Für den Notiz-Anker (Phase 11, currentAnchor) - dieselbe
					// Note-Auflösung wie der Cursor (useScoreSync.js), hier separat
					// gehalten, weil eine Notiz das elid explizit braucht, der
					// Cursor selbst aber nur das fertige Rechteck.
					if (this.timeline && this.timeline.times.length > 0) {
						const index = findStepIndex(this.timeline.times, this.currentTimeMs)
						this.currentElid = this.timeline.events[index].elid
					}
					// Loop (Phase 10, Kernfunktion für Probenarbeit): sobald das
					// Ende erreicht/überschritten ist, zurück zum Anfang - hier statt
					// in silentClock.js/player.js geprüft, weil beide Zeitquellen
					// dieselbe kleine seek()-Schnittstelle erfüllen und Looping keine
					// Eigenschaft der Zeitquelle selbst ist.
					if (this.loopActive && this.loopEndMs !== null && this.currentTimeMs >= this.loopEndMs) {
						this.clock.seek(this.loopStartMs)
					}
					this.updateMetronome()
				}
				this.timeDisplayHandle = requestAnimationFrame(step)
			}
			step()
		},

		async togglePlay() {
			if (!this.clock) {
				return
			}
			if (this.clock.isPlaying()) {
				this.clock.pause()
			} else {
				await this.clock.play()
			}
		},

		onSeekInput(event) {
			this.clock?.seek(Number(event.target.value))
		},

		// BPM statt Prozent (Phase 17, M8) - rechnet die eingegebene Ziel-BPM in
		// den internen playbackRate-Faktor um (Phase 9: die Zeitachse bleibt
		// davon unberührt), begrenzt auf denselben Faktorbereich wie zuvor der
		// Prozent-Regler (0,5-1,5, siehe MIN_/MAX_TEMPO_FACTOR).
		onTempoBpmInput(event) {
			const bpm = Number(event.target.value)
			const factor = this.baseTempoBpm > 0 ? bpm / this.baseTempoBpm : 1
			this.tempo = Math.min(MAX_TEMPO_FACTOR, Math.max(MIN_TEMPO_FACTOR, factor))
			this.clock?.setTempo?.(this.tempo)
		},

		ensureMetronomeClick() {
			if (!this.metronomeClick) {
				this.metronomeClick = createMetronomeClick()
			}
			return this.metronomeClick
		},

		clearCountIn() {
			this.countInTimers.forEach((id) => clearTimeout(id))
			this.countInTimers = []
			this.isCountingIn = false
		},

		// Laufender Metronomklick (Phase 17 auf Taktebene, seit Phase 22 auf
		// Schlagebene - Nutzer-Rückmeldung: "nicht nur der erste Schlag im
		// Takt"). Läuft in der rAF-Schleife mit, terminiert den Klick aber
		// nicht dort: gesucht wird der Schlag, der in METRONOME_LOOKAHEAD_MS
		// fällig ist, und die Restzeit geht an den AudioContext (siehe
		// metronomeClick.js). Auf Taktebene fiel das rAF-Raster nicht auf, auf
		// Schlagebene hörte man es.
		//
		// Der Vorlauf ist in Zeitachsen-ms gemessen; die Umrechnung in echte
		// Sekunden teilt durch den Tempofaktor, weil die Zeitachse mit
		// playbackRate läuft (Phase 9: die Zeitachse selbst bleibt unberührt).
		updateMetronome() {
			const now = this.currentTimeMs
			// Rückwärtssprung (Seek, Loop-Neustart, Klick auf eine frühere
			// Note): dasselbe Schlagraster gilt wieder von vorn.
			if (now < this.lastMetronomeTimeMs) {
				this.lastBeatKey = null
			}
			this.lastMetronomeTimeMs = now
			if (!this.metronomeEnabled || !this.isPlaying || this.isCountingIn) {
				return
			}
			const measures = this.measuresTimeline
			if (!measures || measures.events.length === 0) {
				return
			}
			const lookaheadMs = now + METRONOME_LOOKAHEAD_MS
			const index = findStepIndex(measures.times, lookaheadMs)
			const measureStartMs = measures.events[index].timeMs
			const measureEndMs = index + 1 < measures.events.length
				? measures.events[index + 1].timeMs
				: this.durationMs
			const beat = resolveBeatInMeasure(measureStartMs, measureEndMs, lookaheadMs, this.baseTempoBpm, this.metronomeBeats === 'all')
			if (!beat) {
				return
			}
			const key = `${index}:${beat.index}`
			if (key === this.lastBeatKey) {
				return
			}
			this.lastBeatKey = key
			const delaySeconds = Math.max(0, (beat.timeMs - now) / (this.tempo || 1) / 1000)
			this.ensureMetronomeClick().click(beat.index === 0, delaySeconds)
		},

		// Einzähler vor dem Loop-Start (Phase 17: "mehr wert als die meiste
		// übrige Mixer-Funktionalität"). Schätzt die Schlagzahl des Zieltaktes
		// aus seiner Dauer und der aktuellen BPM (lib/metronome.js - measures.json
		// trägt keine eigene Taktart), zählt in Echtzeit herunter und startet
		// danach die Wiedergabe selbst.
		startCountIn(targetMs) {
			this.clearCountIn()
			if (!this.measuresTimeline || this.measuresTimeline.events.length === 0) {
				this.clock?.play()
				return
			}
			const index = findStepIndex(this.measuresTimeline.times, targetMs)
			const measureStartMs = this.measuresTimeline.events[index].timeMs
			const nextMs = index + 1 < this.measuresTimeline.events.length
				? this.measuresTimeline.events[index + 1].timeMs
				: this.durationMs
			const beatsInMeasure = estimateBeatsInMeasure(nextMs - measureStartMs, this.baseTempoBpm)
			const bpm = this.effectiveTempoBpm > 0 ? this.effectiveTempoBpm : DEFAULT_TEMPO_BPM
			const beatIntervalMs = 60000 / bpm
			const delays = computeCountInDelaysMs(beatsInMeasure, beatIntervalMs)
			this.isCountingIn = true
			const click = this.ensureMetronomeClick()
			this.countInTimers = delays.map((delay, i) => setTimeout(() => click.click(i === 0), delay))
			// Die Wiedergabe startet einen Schlag NACH dem letzten Einzähler-
			// Klick (Phase 22). Bis Phase 21 startete sie auf dem letzten Klick
			// - bei vier Schlägen zählte der Einzähler damit nur drei, und der
			// vierte fiel mit der Eins zusammen. Am Dirigat ist das der
			// Unterschied zwischen "und eins" und einem verschluckten Schlag.
			this.countInTimers.push(setTimeout(() => {
				this.isCountingIn = false
				this.countInTimers = []
				this.clock?.play()
			}, delays[delays.length - 1] + beatIntervalMs))
		},

		onVolumesChanged(effectiveVolumes) {
			this.clock?.applyChannelVolumes?.(effectiveVolumes)
		},

		onProgramChanged({ channel, program }) {
			this.clock?.setProgram?.(channel, program)
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

		toggleLoop() {
			if (this.loopActive) {
				this.loopActive = false
				this.loopStartMs = null
				this.loopEndMs = null
				this.clearCountIn()
				return
			}
			if (!this.measuresTimeline || !this.loopFromMeasure || !this.loopToMeasure) {
				return
			}
			const startMs = findMeasureStartTime(this.measuresTimeline, Number(this.loopFromMeasure))
			// Loop-Ende = Beginn des Taktes NACH dem angegebenen "bis"-Takt, damit
			// dieser Takt noch vollständig durchgespielt wird, bevor
			// zurückgesprungen wird; am Stückende gilt stattdessen durationMs.
			const endMs = findMeasureStartTime(this.measuresTimeline, Number(this.loopToMeasure) + 1) ?? this.durationMs
			if (startMs === null) {
				return
			}
			this.loopStartMs = startMs
			this.loopEndMs = endMs
			this.loopActive = true
			this.clock?.seek(startMs)
			// Nur einzählen, wenn noch nicht gespielt wird - sonst würde eine
			// laufende Probe unterbrochen statt unterstützt.
			if (this.clock && !this.clock.isPlaying()) {
				this.startCountIn(startMs)
			}
		},

		// "Loop ab aktuellem Takt" (Phase 17: "der häufigste Fall in der Probe:
		// man ist schon an der Stelle") - füllt nur das Feld, aktiviert den Loop
		// nicht automatisch (der "bis"-Takt bleibt eine bewusste Entscheidung).
		loopFromCurrentMeasure() {
			const current = this.currentAnchor?.measureNumber
			if (current) {
				this.loopFromMeasure = current
			}
		},

		onZoomInput(event) {
			this.setZoom(Number(event.target.value))
		},

		// Einziger Weg, `zoom` zu setzen, außer der Fensterbreiten-Automatik
		// (applyZoomPreset('width')/setUpViewportObserver): jeder selbst
		// gewählte Zoom schaltet zoomFollowsWidth ab, sonst würde die
		// Automatik ihn beim nächsten Resize wieder überschreiben.
		setZoom(value) {
			this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
			this.zoomFollowsWidth = false
		},

		zoomBy(factor) {
			this.setZoom(this.zoom * factor)
		},

		// Strg+Mausrad zoomt die Partitur, nicht die Nextcloud-Oberfläche
		// (dasselbe Motiv wie beim Pinch-Zoom aus Phase 19, siehe
		// Template-Kommentar). Ohne Strg bleibt das Rad gewöhnliches Scrollen.
		onWheel(event) {
			if (!event.ctrlKey) {
				return
			}
			event.preventDefault()
			this.zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
		},

		// Beim Verlassen des Taktfeldes ohne Enter wieder der Wiedergabe
		// folgen - eine halb getippte Zahl darf nicht als Anzeige stehen
		// bleiben.
		onMeasureFieldBlur() {
			this.measureFieldFocused = false
			if (this.currentMeasureNumber !== null) {
				this.measureInput = this.currentMeasureNumber
			}
		},

		// Tastaturkürzel für die Probe (Phase 17) - greifen nur, wenn der Viewer
		// den Fokus hat (Listener sitzt auf this.$el, keydown bubbelt dorthin,
		// siehe mounted()) und der Fokus nicht in einem Eingabefeld liegt (sonst
		// würde z.B. das Pfeiltasten-Navigieren im Takt-Eingabefeld gestohlen).
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
				this.zoomBy(ZOOM_STEP)
			} else if (event.key === '-') {
				event.preventDefault()
				this.zoomBy(1 / ZOOM_STEP)
			} else if (event.key === '0') {
				// Zurück zur Seitenbreite - und wieder der Fenstergröße
				// folgend, wie beim Öffnen.
				event.preventDefault()
				this.applyZoomPreset('width')
			}
		},

		jumpRelativeMeasure(delta) {
			const current = this.currentAnchor?.measureNumber
			if (!current) {
				return
			}
			this.jumpToMeasure(Math.max(1, current + delta))
		},

		// Umkehrung von M4 (Phase 10, "Klick auf eine Note springt dorthin") -
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
			const timeMs = findNearestOccurrenceTimeMs(this.timeline.events, elid, this.currentTimeMs)
			if (timeMs !== null) {
				this.clock.seek(timeMs)
			}
		},

		// Reine Rechnung in scrollPlan.js, hier nur die DOM-Messung dazu
		// (Phase 16, ersetzt die frühere reine Seitenwechsel-Erkennung).
		// Läuft bei jedem Notenwechsel (siehe useScoreSync.js), nicht jeden
		// rAF-Frame - dieselbe Drosselung wie beim bisherigen Cursor-Update -
		// plus einmal nach jedem Zoomwechsel (Watcher, mit force).
		updateAutoScroll(rect, force = false) {
			const scrollEl = this.$refs.scroll
			if (!rect || !scrollEl) {
				return
			}
			if (!force && shouldSuppressAutoScroll(this.lastManualScrollAt, Date.now(), MANUAL_SCROLL_RESUME_MS)) {
				return
			}
			const pageEl = this.pageRefs[rect.page]
			const containerRect = scrollEl.getBoundingClientRect()
			const cursorClientRect = pageEl?.getCursorClientRect?.()
			if (!cursorClientRect) {
				// Die Zielseite ist noch nicht geladen (IntersectionObserver hat sie
				// noch nicht ausgelöst, siehe ScorePage.vue) - kommt bei einem weiten
				// Sprung vor (z.B. "springe zu Takt 60"), bei dem noch nie in die Nähe
				// dieser Seite gescrollt wurde. Grob zur Seite selbst scrollen (die
				// reserviert ihre Höhe schon vor dem Laden, siehe dortiger Kommentar
				// zu aspectRatio, ist also schon jetzt messbar) - das bringt sie ins
				// Ladefenster, der nächste Notenwechsel-Tick übernimmt dann über den
				// dann verfügbaren Cursor die genaue Position. performAutoScroll()
				// (nicht scrollIntoView) hier bewusst, damit dieser Scroll ebenfalls
				// als "programmatisch" markiert wird (siehe onViewerScroll) - sonst
				// würde er sich selbst als manuelles Scrollen auslegen und den
				// nachfolgenden genauen Scroll sofort wieder unterdrücken.
				const pageClientRect = pageEl?.$el?.getBoundingClientRect?.()
				if (pageClientRect) {
					const pageTop = scrollEl.scrollTop + (pageClientRect.top - containerRect.top)
					this.performAutoScroll(pageTop)
				}
				return
			}
			const cursorTop = scrollEl.scrollTop + (cursorClientRect.top - containerRect.top)
			const target = planAutoScroll({
				cursorTop,
				cursorHeight: cursorClientRect.height,
				scrollTop: scrollEl.scrollTop,
				viewportHeight: scrollEl.clientHeight,
			})
			// Waagerecht nur, wenn die Seite überhaupt breiter als das Bild ist
			// (Phase 22: das kann sie jetzt, siehe ScorePage.vue) - sonst wäre
			// jeder Aufruf eine überflüssige DOM-Schreiboperation.
			let targetLeft = null
			if (scrollEl.scrollWidth > scrollEl.clientWidth) {
				targetLeft = planHorizontalScroll({
					cursorLeft: scrollEl.scrollLeft + (cursorClientRect.left - containerRect.left),
					cursorWidth: cursorClientRect.width,
					scrollLeft: scrollEl.scrollLeft,
					viewportWidth: scrollEl.clientWidth,
				})
			}
			if (target !== null || targetLeft !== null) {
				this.performAutoScroll(target, targetLeft)
			}
		},

		performAutoScroll(targetScrollTop, targetScrollLeft = null) {
			const scrollEl = this.$refs.scroll
			if (!scrollEl) {
				return
			}
			const clamp = (value, max) => Math.min(Math.max(0, value), Math.max(0, max))
			const options = { behavior: 'smooth' }
			if (targetScrollTop !== null) {
				options.top = clamp(targetScrollTop, scrollEl.scrollHeight - scrollEl.clientHeight)
			}
			if (targetScrollLeft !== null) {
				options.left = clamp(targetScrollLeft, scrollEl.scrollWidth - scrollEl.clientWidth)
			}
			// Markiert die eigenen, dadurch ausgelösten scroll-Events als
			// "programmatisch" (siehe onViewerScroll) - sonst würde unser
			// eigenes Nachführen sich selbst als manuellen Scroll auslegen und
			// sofort wieder pausieren.
			this.ignoreScrollUntil = Date.now() + PROGRAMMATIC_SCROLL_WINDOW_MS
			scrollEl.scrollTo(options)
		},

		// Erkennt manuelles Scrollen (PLAN.md: "bei manuellem Scrollen
		// aussetzen und nach kurzer Zeit wieder übernehmen") - jedes scroll-
		// Event, das nicht innerhalb des Ignorierfensters eines eigenen
		// performAutoScroll() liegt, gilt als Nutzereingriff.
		onViewerScroll() {
			if (Date.now() < this.ignoreScrollUntil) {
				return
			}
			this.lastManualScrollAt = Date.now()
		},

		// Seitengeometrie für die Zoom-Presets (Phase 16) - ScorePage.vue kennt
		// nur die eigene Seite, hier wird sie gesammelt.
		onPageLoaded({ index, viewBox, sizeMm }) {
			this.pageDimensions[index] = { viewBox, sizeMm }
		},

		applyZoomPreset(preset) {
			const scrollEl = this.$refs.scroll
			const pagesEl = scrollEl?.querySelector('.scoreview-pages')
			if (!pagesEl) {
				return
			}
			// Seite 0 ist praktisch immer zuerst geladen (Phase 8: sichtbare
			// Seiten zuerst) - als Fallback irgendeine geladene Seite, falls die
			// Partitur mit Seite 0 aus dem Bild gescrollt sein sollte.
			const dims = this.pageDimensions[0] ?? Object.values(this.pageDimensions)[0]
			if (preset === 'width') {
				// Als einziger Zoomweg OHNE zoomFollowsWidth = false: "an die
				// Breite anpassen" ist genau die Ansage, dass es das auch nach
				// dem nächsten Drehen/Vergrößern noch tun soll.
				this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, computeFitWidthZoom(pagesEl.clientWidth)))
				this.zoomFollowsWidth = true
				return
			}
			if (preset === 'page') {
				if (!dims?.viewBox) {
					return
				}
				// Die Leiste liegt seit Phase 22 außerhalb des Scroll-Elements -
				// dessen clientHeight IST die verfügbare Höhe, es ist nichts mehr
				// abzuziehen (vorher: Höhe der beiden sticky Leisten).
				this.setZoom(computeFitPageZoom(dims.viewBox, pagesEl.clientWidth, scrollEl.clientHeight))
			} else if (preset === 'actual') {
				this.setZoom(computeActualSizeZoom(dims?.sizeMm ?? null))
			}
		},

		// Hält den Zoom an der Fensterbreite, solange niemand selbst gezoomt
		// hat (siehe zoomFollowsWidth). Beobachtet wird .scoreview-body, nicht
		// das Scroll-Element: dessen Innenbreite hängt am Scrollbalken, und ein
		// Zoom, der den Scrollbalken erscheinen/verschwinden lässt, würde sich
		// über den Beobachter selbst wieder anstoßen.
		setUpViewportObserver() {
			this.viewportObserver?.disconnect()
			const bodyEl = this.$el.querySelector('.scoreview-body')
			if (!bodyEl || typeof ResizeObserver === 'undefined') {
				return
			}
			this.viewportObserver = new ResizeObserver(() => {
				if (this.zoomFollowsWidth) {
					this.applyZoomPreset('width')
				}
			})
			this.viewportObserver.observe(bodyEl)
		},

		// Vollbild einer A4-Seite (Phase 16) - fullscreent den ganzen Viewer
		// (nicht nur eine einzelne Seite), damit die Transportleiste bedienbar
		// bleibt; "ganze Seite"-Zoom übernimmt das Ausfüllen der Höhe.
		async toggleFullscreen() {
			try {
				if (document.fullscreenElement) {
					await document.exitFullscreen()
				} else {
					await this.$el.requestFullscreen()
				}
			} catch (err) {
				// z.B. Fullscreen per Permissions-Policy im umgebenden iframe
				// gesperrt - Notenansicht bleibt trotzdem nutzbar, nur ohne Vollbild.
				// eslint-disable-next-line no-console
				console.error('ScoreView: Vollbild konnte nicht umgeschaltet werden.', err)
			}
		},

		onFullscreenChange() {
			const wasFollowingWidth = this.zoomFollowsWidth
			this.isFullscreen = document.fullscreenElement === this.$el
			if (this.isFullscreen) {
				// Merken, ob der Zoom vorher der Fensterbreite folgte -
				// applyZoomPreset('page') schaltet das ab.
				this.zoomFollowedWidthBeforeFullscreen = wasFollowingWidth
				this.applyZoomPreset('page')
			} else if (this.zoomFollowedWidthBeforeFullscreen) {
				// Beim Verlassen nicht mit dem Vollbild-Zoom im kleinen Fenster
				// zurückbleiben (Phase 22) - dort passte "ganze Seite" zu einer
				// Fläche, die es nicht mehr gibt.
				this.applyZoomPreset('width')
			}
		},

		formatTime(ms) {
			const totalSeconds = Math.floor(ms / 1000)
			const minutes = Math.floor(totalSeconds / 60)
			const seconds = totalSeconds % 60
			return `${minutes}:${String(seconds).padStart(2, '0')}`
		},

		// Bildschirm waehrend der Wiedergabe wachhalten (Phase 19: "ein
		// Display, das mitten im Satz ausgeht, macht die ganze uebrige Arbeit
		// wertlos") - die Wake Lock API ist nicht ueberall verfuegbar
		// (z.B. Firefox ohne Flag, manche iOS-Versionen), deshalb defensiv:
		// ohne sie bleibt die App exakt so nutzbar wie vorher, nur eben ohne
		// Wachhalte-Effekt.
		async requestWakeLock() {
			if (!navigator.wakeLock || this.wakeLockSentinel) {
				return
			}
			try {
				this.wakeLockSentinel = await navigator.wakeLock.request('screen')
				// Das Sentinel wird vom Browser selbst geloest, wenn der Tab in
				// den Hintergrund wechselt (z.B. Tab-Wechsel) - beim
				// Zurueckkehren waehrend laufender Wiedergabe erneut anfordern,
				// sonst bliebe der Bildschirm nach einem Tab-Wechsel wieder
				// ungeschuetzt, obwohl isPlaying weiterhin true ist.
				this.wakeLockSentinel.addEventListener('release', () => {
					this.wakeLockSentinel = null
					if (this.isPlaying && document.visibilityState === 'visible') {
						this.requestWakeLock()
					}
				})
			} catch (err) {
				// z.B. Permissions-Policy verbietet Wake Lock im umgebenden iframe
				// - Wiedergabe bleibt trotzdem nutzbar, nur ohne Wachhalte-Effekt.
				// eslint-disable-next-line no-console
				console.error('ScoreView: Bildschirm konnte nicht wachgehalten werden.', err)
			}
		},

		releaseWakeLock() {
			this.wakeLockSentinel?.release?.()
			this.wakeLockSentinel = null
		},

		// Pinch-Zoom (Phase 19, siehe scoreLayout.js computePinchZoom) - reagiert
		// nur auf echte Zweifinger-Gesten, ein einzelner Finger scrollt normal
		// weiter (kein preventDefault dafuer, siehe Template-Kommentar).
		touchDistance(touches) {
			const dx = touches[0].clientX - touches[1].clientX
			const dy = touches[0].clientY - touches[1].clientY
			return Math.sqrt((dx * dx) + (dy * dy))
		},

		onTouchStart(event) {
			if (event.touches.length === 2) {
				this.isPinching = true
				this.pinchStartDistance = this.touchDistance(event.touches)
				this.pinchStartZoom = this.zoom
			}
		},

		onTouchMove(event) {
			if (this.isPinching && event.touches.length === 2) {
				// Unterdrueckt den nativen Browser-Seiten-Zoom waehrend der Geste
				// (der wuerde sonst die GESAMTE Nextcloud-Oberflaeche vergroessern,
				// nicht nur die Partitur) - siehe Template-Kommentar zu
				// .scoreview-pages.
				event.preventDefault()
				const distance = this.touchDistance(event.touches)
				this.setZoom(computePinchZoom(this.pinchStartDistance, distance, this.pinchStartZoom))
			}
		},

		onTouchEnd(event) {
			if (event.touches.length < 2) {
				this.isPinching = false
			}
		},

		// "Noten ohne Ton"-Weg (Phase 19): bricht den laufenden SoundFont-Abruf
		// ab und faellt sofort auf den stummen Platzhalter zurueck, statt die
		// verbleibenden ~40MB abzuwarten.
		skipSoundFontLoad() {
			this.soundFontAbortController?.abort()
		},
	},
}
</script>

<style scoped>
/*
 * Flex-Spalte statt eines einzigen scrollenden Kastens (Phase 22): die Leiste
 * ist ein Geschwister des Scroll-Elements, kein sticky Kind darin. Damit kann
 * sie nicht wegscrollen, und die Panels lassen sich über dem Notenbild
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
 * Touch-Zielgroessen (Phase 19: ">= 44px") - gemessen statt angenommen:
 * Nextclouds eigenes --default-clickable-area liegt in dieser Instanz bei
 * 34px, NICHT bei 44px (siehe PLAN.md Umsetzungsstand). NcButton liest diese
 * Variable zur Laufzeit (--button-size: var(--default-clickable-area)) - ein
 * Override hier auf dem gemeinsamen Wurzelelement wirkt dadurch auf alle
 * NcButtons in dieser Komponente UND in ScoreMixer.vue/ScoreAnnotations.vue
 * (CSS-Variablen vererben sich durchs echte DOM, unabhaengig von Vues
 * Style-Scoping-Grenzen). Nur unter (pointer: coarse) (Touch-Geraete), damit
 * die Maus-Bedienung auf dem Desktop kompakt bleibt.
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

.scoreview-bar {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	gap: 6px;
	/* Auf schmalen Bildschirmen darf sie umbrechen statt Knöpfe abzuschneiden -
	   das ist selten und kostet dort eine Zeile, nicht dauerhaft Fläche. */
	flex-wrap: wrap;
	padding: 4px 8px;
	border-bottom: 1px solid var(--color-border);
	background: var(--color-main-background);
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
   ohnehin), die Taktangabe dagegen die wichtigste. */
@media (max-width: 600px) {
	.scoreview-time {
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
 * Feste Breite MUSS an einen Wrapper, nicht an NcTextField selbst (Phase 22,
 * Nutzer-Rückmeldung "das Taktfeld ist über die ganze Breite"): NcInputField
 * bringt `.input-field[data-v-…] { width: 100% }` mit - dieselbe Spezifität
 * wie eine scoped Klassenregel hier, und die Bibliotheks-CSS wird später
 * eingebunden, gewinnt bei Gleichstand also. Die alte Regel
 * `.scoreview-measure-input { width: 70px }` hatte deshalb nie gewirkt
 * (gemessen: 1376px). Innerhalb eines schmalen Wrappers ist `width: 100%`
 * genau das Gewünschte.
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
 * Block statt Flex-Spalte (Phase 22): eine Seite kann jetzt breiter als der
 * Container sein (Zoom, siehe ScorePage.vue). In einer zentrierenden
 * Flex-Spalte wäre der überstehende linke Teil nicht mehr erreichbar - bei
 * einem Blockelement mit `margin: 0 auto` fällt die Zentrierung im Überlauf
 * einfach weg, und der Scrollbereich deckt die ganze Seite ab.
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
	 * Nachmessen genau so beobachtet: der Mixer wirkte durchsichtig) - es ist
	 * derselbe Fallstrick, den bis Phase 21 die sticky Transportleiste hatte.
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
