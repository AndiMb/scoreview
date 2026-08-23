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
			<div class="scoreview-transport">
				<!--
					Dauerhaft sichtbare Taktangabe (Phase 16, "wer wissen will, wo er
					ist, scrollt nach oben zum Eingabefeld") - in der ohnehin schon
					sticky Transportleiste, nicht in einer eigenen Kopfzeile. Der Titel
					ist Material aus der Partitur selbst, kein UI-Text (CLAUDE.md) und
					bleibt deshalb unübersetzt.
				-->
				<span v-if="scoreTitle || totalMeasures" class="scoreview-position" :title="scoreTitle">
					<strong v-if="scoreTitle" class="scoreview-position-title">{{ scoreTitle }}</strong>
					<span class="scoreview-position-measure">{{ t('Measure {current} of {total}', { current: currentMeasureDisplay, total: totalMeasures || '–' }) }}</span>
				</span>
				<NcButton
					class="scoreview-play"
					:aria-label="isPlaying ? t('Pause') : t('Play')"
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
				<template v-if="hasRealPlayer">
					<!--
						BPM statt Prozent (Phase 17, auf Basis von M8: metadata.tempo ist
						Viertel-BPM) - der Notensymbol-Text "♩ = 80" statt "100%" ist die
						Einheit, die eine Chorleitung tatsächlich ansagt. tempoGuessed
						markiert Partituren ohne eigene Tempoangabe (M8: tempo kann 0
						sein) sichtbar als geschätzt, statt eine Genauigkeit vorzutäuschen,
						die nicht da ist.
					-->
					<label class="scoreview-tempo-label" :title="tempoGuessed ? t('No tempo marking in the score – 120 BPM assumed.') : ''">
						♩ = {{ effectiveTempoBpm }}{{ tempoGuessed ? '*' : '' }}
						<input
							type="range"
							class="scoreview-tempo"
							:min="minTempoBpm"
							:max="maxTempoBpm"
							step="1"
							:value="effectiveTempoBpm"
							:aria-label="t('Tempo (BPM)')"
							@input="onTempoBpmInput">
					</label>
					<NcButton :pressed="metronomeEnabled" :aria-label="metronomeEnabled ? t('Metronome on') : t('Metronome off')" @click="metronomeEnabled = !metronomeEnabled">
						<template #icon>
							<Metronome :size="20" />
						</template>
					</NcButton>
					<NcButton :pressed="showMixer" :aria-label="t('Mixer')" @click="showMixer = !showMixer">
						<template #icon>
							<Tune :size="20" />
						</template>
						{{ t('Mixer') }}
					</NcButton>
				</template>
				<NcButton :pressed="showAnnotations" :aria-label="t('Notes')" @click="showAnnotations = !showAnnotations">
					<template #icon>
						<NotebookOutline :size="20" />
					</template>
					{{ t('Notes') }}
				</NcButton>
			</div>
			<div class="scoreview-rehearsal">
				<NcTextField
					v-model.number="measureInput"
					type="number"
					min="1"
					class="scoreview-measure-input"
					:label="t('Measure')"
					label-outside
					@keyup.enter="jumpToMeasure(measureInput)" />
				<NcButton :aria-label="t('Go')" @click="jumpToMeasure(measureInput)">
					<template #icon>
						<ArrowRight :size="20" />
					</template>
					{{ t('Go') }}
				</NcButton>
				<span class="scoreview-loop-fields">
					{{ t('Loop') }}
					<NcTextField
						v-model.number="loopFromMeasure"
						type="number"
						min="1"
						class="scoreview-loop-input"
						:label="t('From measure')"
						label-outside
						:placeholder="t('from')" />
					<NcTextField
						v-model.number="loopToMeasure"
						type="number"
						min="1"
						class="scoreview-loop-input"
						:label="t('To measure')"
						label-outside
						:placeholder="t('to')" />
					<NcButton :aria-label="t('Loop from current measure')" :title="t('Loop from current measure')" @click="loopFromCurrentMeasure">
						<template #icon>
							<CrosshairsGps :size="20" />
						</template>
					</NcButton>
					<NcButton :pressed="loopActive" :aria-label="loopActive ? t('Loop on') : t('Loop off')" @click="toggleLoop">
						<template #icon>
							<Repeat :size="20" />
						</template>
						{{ loopActive ? t('Loop on') : t('Loop off') }}
					</NcButton>
				</span>
				<label class="scoreview-zoom-label">
					{{ t('Zoom') }}
					<input type="range" min="0.5" max="2" step="0.1" :value="zoom" :aria-label="t('Zoom')" @input="onZoomInput">
				</label>
				<!--
					Zoom-Presets in ein Aktionsmenue statt drei einzelne Knoepfe
					(Phase 19: "selten Benutztes in ein Aktionsmenue", der stufenlose
					Regler direkt daneben bleibt der primaere Zoom-Weg) - entlastet die
					Leiste auf schmalen/Touch-Bildschirmen.
				-->
				<NcActions :aria-label="t('More zoom options')">
					<NcActionButton @click="applyZoomPreset('width')">
						<template #icon>
							<ArrowExpandHorizontal :size="20" />
						</template>
						{{ t('Fit page width') }}
					</NcActionButton>
					<NcActionButton @click="applyZoomPreset('page')">
						<template #icon>
							<FitToPage :size="20" />
						</template>
						{{ t('Fit whole page') }}
					</NcActionButton>
					<NcActionButton @click="applyZoomPreset('actual')">
						<template #icon>
							<Magnify :size="20" />
						</template>
						{{ t('Actual size') }}
					</NcActionButton>
				</NcActions>
				<NcButton :pressed="isFullscreen" :aria-label="isFullscreen ? t('Exit fullscreen') : t('Fullscreen')" @click="toggleFullscreen">
					<template #icon>
						<FullscreenExit v-if="isFullscreen" :size="20" />
						<Fullscreen v-else :size="20" />
					</template>
				</NcButton>
			</div>
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
			<ScoreMixer
				v-if="hasRealPlayer && showMixer && mixerChannels.length > 0"
				:channels="mixerChannels"
				:preset-list="presetList"
				@volumes-changed="onVolumesChanged"
				@program-changed="onProgramChanged" />
			<ScoreAnnotations
				v-if="showAnnotations"
				:annotations="annotations"
				:current-anchor="currentAnchor"
				:error="annotationError"
				@create="onAnnotationCreate"
				@update="onAnnotationUpdate"
				@delete="onAnnotationDelete"
				@jump-to="onAnnotationJumpTo" />
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
					:svg-url="url"
					:page-index="i"
					:cursor-rect="cursorRect"
					:zoom="zoom"
					:markers="annotationMarkers"
					:loop-markers="loopMarkers"
					@note-click="onNoteClick"
					@marker-click="onAnnotationJumpToById"
					@loaded="onPageLoaded" />
			</div>
		</template>
	</div>
</template>

<script>
import { generateUrl } from '@nextcloud/router'
import { translate } from '@nextcloud/l10n'
import axios from '@nextcloud/axios'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import Play from 'vue-material-design-icons/Play.vue'
import Pause from 'vue-material-design-icons/Pause.vue'
import Tune from 'vue-material-design-icons/Tune.vue'
import NotebookOutline from 'vue-material-design-icons/NotebookOutline.vue'
import ArrowRight from 'vue-material-design-icons/ArrowRight.vue'
import Repeat from 'vue-material-design-icons/Repeat.vue'
import AlertCircleOutline from 'vue-material-design-icons/AlertCircleOutline.vue'
import ArrowExpandHorizontal from 'vue-material-design-icons/ArrowExpandHorizontal.vue'
import FitToPage from 'vue-material-design-icons/FitToPage.vue'
import Fullscreen from 'vue-material-design-icons/Fullscreen.vue'
import FullscreenExit from 'vue-material-design-icons/FullscreenExit.vue'
import Metronome from 'vue-material-design-icons/Metronome.vue'
import CrosshairsGps from 'vue-material-design-icons/CrosshairsGps.vue'
import Magnify from 'vue-material-design-icons/Magnify.vue'
import ScorePage from './ScorePage.vue'
import ScoreMixer from './ScoreMixer.vue'
import ScoreAnnotations from './ScoreAnnotations.vue'
import {
	buildTimeline,
	computeActualSizeZoom,
	computeFitPageZoom,
	computeFitWidthZoom,
	computePinchZoom,
	findElementAtPoint,
	findMeasureStartTime,
	findNearestOccurrenceTimeMs,
	measurePositionToTimeMs,
	resolveMeasurePosition,
} from '../lib/scoreLayout.js'
import { findStepIndex } from '../lib/timingSync.js'
import { resolveMixerChannels } from '../lib/mixerLayout.js'
import { planAutoScroll, shouldSuppressAutoScroll } from '../lib/scrollPlan.js'
import { useScoreSync } from '../composables/useScoreSync.js'
import { createSilentClock } from '../lib/silentClock.js'
import { createPlayer } from '../lib/player.js'
import { computeCountInDelaysMs, estimateBeatsInMeasure } from '../lib/metronome.js'
import { createMetronomeClick } from '../lib/metronomeClick.js'

// Pausendauer für das Autoscroll-Nachführen nach manuellem Scrollen (Phase
// 16, siehe scrollPlan.js) - lang genug, um in Ruhe zu lesen, kurz genug, um
// nicht wie ein Hänger zu wirken.
const MANUAL_SCROLL_RESUME_MS = 2500
// Wie lange nach einem selbst ausgelösten scrollTo() eingehende scroll-Events
// als "programmatisch" gelten, nicht als manuelles Scrollen (siehe
// onViewerScroll) - großzügig über der CSS-smooth-scroll-Dauer, damit kein
// Nachzittern fälschlich als Nutzereingriff gilt.
const PROGRAMMATIC_SCROLL_WINDOW_MS = 700

const POLL_INTERVAL_MS = 2000
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
		NcActions,
		NcActionButton,
		Play,
		Pause,
		Tune,
		NotebookOutline,
		ArrowRight,
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

	data() {
		return {
			// loading | converting | ready | error
			state: 'loading',
			errorMessage: '',
			// sidecar_unreachable | sidecar_rejected | conversion_failed |
			// timeout | no_pages | unknown | '' (kein Fehler bzw. Fehler kam
			// nicht vom Server, siehe pollStatus()) - Phase 14: gespeicherte
			// Fehlertexte werden von beliebigen Nutzerinnen in beliebigen
			// Sprachen gelesen, IL10N kann serverseitig also nicht greifen
			// (siehe ConversionController). Uebersetzt wird erst hier, beim
			// Anzeigen, anhand des Codes - errorMessage bleibt das
			// unveraenderte technische Detail dazu.
			errorCode: '',
			pageUrls: [],
			cursorRect: null,
			currentTimeMs: 0,
			durationMs: 0,
			isPlaying: false,
			tempo: 1,
			// Zeitquelle: entweder lib/player.js (echte Wiedergabe, sobald ein
			// SoundFont konfiguriert ist) oder lib/silentClock.js (Platzhalter,
			// siehe PLAN.md Phase 8/9) - beide erfüllen dieselbe Schnittstelle,
			// diese Komponente muss den Unterschied nur für die
			// Tempo-/Mixer-Zusatzfunktionen kennen (hasRealPlayer).
			clock: null,
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
			pollTimer: null,
			autoRetried: false,
			pageRefs: [],
			timeDisplayHandle: null,
			// Phase 16: Autoscroll (siehe scrollPlan.js) und Kopfangaben.
			scoreTitle: '',
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
			// Phase 10: Probenarbeit.
			timeline: null, // timing.json (Note-Ebene) - für Klick-auf-Note.
			measuresTimeline: null, // measures.json (Takt-Ebene) - für Taktnavigation/Loop.
			measureInput: 1,
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
			// Phase 11: private Notizen, Phase 18: zusaetzlich geteilte.
			annotations: [],
			showAnnotations: false,
			annotationError: '',
			currentEtag: null,
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
			metronomeClick: null,
			lastClickedMeasureNumber: null,
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
		// Uebersetzter Satz fuer den Fehlerzustand: bei einem serverseitig
		// gespeicherten errorCode dessen feste Uebersetzung, sonst (Netzwerkfehler
		// beim Abruf des status()-Endpunkts selbst, siehe pollStatus()) die rohe
		// JS-Fehlermeldung - die ist ohnehin umgebungsspezifisch und nicht sinnvoll
		// uebersetzbar.
		errorText() {
			return this.errorCode ? this.errorCodeText(this.errorCode) : (this.errorMessage || this.t('Unknown error.'))
		},

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

		// Für die Taktangabe in der Transportleiste (Phase 16) - '–' vor dem
		// ersten berechneten Anker (currentAnchor braucht measuresTimeline).
		currentMeasureDisplay() {
			return this.currentAnchor ? this.currentAnchor.measureNumber : '–'
		},

		// Koordinaten je Notiz für die Seiten-Overlays: bevorzugt die exakte
		// Note (elid, falls noch im aktuellen etag auffindbar), sonst die
		// Takt-Koordinate als Näherung (measuresTimeline.elements) - eine
		// Notiz bleibt so auch nach einem Re-Upload sichtbar positionierbar,
		// nur etwas gröber (siehe PLAN.md Phase 11 zum Anker-Design).
		annotationMarkers() {
			if (!this.timeline || !this.measuresTimeline) {
				return []
			}
			return this.annotations
				.map((a) => {
					const rect = (a.elid !== null && a.anchorEtag === this.currentEtag ? this.timeline.elements[String(a.elid)] : null)
						?? this.measuresTimeline.elements[String(a.measureNumber - 1)]
					// mine/visibility fuers Marker-Styling in ScorePage.vue (Phase
					// 18: eigene und geteilte Notizen sollen unterscheidbar sein).
					return rect ? { id: a.id, mine: a.mine, visibility: a.visibility, ...rect } : null
				})
				.filter(Boolean)
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
	},

	mounted() {
		// Passive Listener am Root-Element (nicht an window/document, siehe
		// PLAN.md Phase 16) - .scoreview-viewer ist der scrollende Container
		// selbst (overflow: auto), this.$el ist hier stabil über die gesamte
		// Lebensdauer der Komponente (anders als die ScorePage-Refs, die pro
		// Partitur neu entstehen).
		this.$el.addEventListener('scroll', this.onViewerScroll, { passive: true })
		document.addEventListener('fullscreenchange', this.onFullscreenChange)
		// Tastaturkürzel (Phase 17) NICHT passiv: Leertaste/Pfeiltasten sollen
		// die Seite nicht zusätzlich scrollen (siehe onKeydown - preventDefault
		// nur für die tatsächlich behandelten Tasten, alles andere bleibt
		// unangetastet, insbesondere Nextclouds eigene Kürzel).
		this.$el.addEventListener('keydown', this.onKeydown)
	},

	beforeUnmount() {
		this.cleanup()
		this.$el.removeEventListener('scroll', this.onViewerScroll)
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

		// Uebersetzung je error_code (siehe ConversionController::status()) -
		// unknown ist sowohl der explizite Code als auch der Fallback fuer einen
		// unbekannten/fehlenden Code (z.B. aeltere, vor Phase 14 gespeicherte
		// Fehlerdatensaetze ohne error_code).
		errorCodeText(code) {
			const messages = {
				sidecar_unreachable: this.t('The conversion service could not be reached.'),
				sidecar_rejected: this.t('The conversion service rejected the file.'),
				conversion_failed: this.t('The score could not be converted.'),
				timeout: this.t('The conversion did not finish in time.'),
				no_pages: this.t('The score contains no pages that could be converted.'),
				unknown: this.t('An unknown error occurred during conversion.'),
			}
			return messages[code] ?? messages.unknown
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
			this.state = 'loading'
			this.errorMessage = ''
			this.errorCode = ''
			this.autoRetried = false
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
			this.scoreTitle = ''
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
			this.annotations = []
			this.showAnnotations = false
			this.annotationError = ''
			this.currentEtag = null
			this.currentElid = null
			this.metaTracks = null
			this.metaParts = null
			this.baseTempoBpm = DEFAULT_TEMPO_BPM
			this.tempoGuessed = false
			this.metronomeEnabled = false
			this.lastClickedMeasureNumber = null
			this.isCountingIn = false
			this.isPinching = false
			this.soundFontLoading = false
			this.soundFontLoadPercent = 0
			this.soundFontAbortController = null
		},

		cleanup() {
			if (this.pollTimer) {
				clearTimeout(this.pollTimer)
				this.pollTimer = null
			}
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
			this.releaseWakeLock()
		},

		async pollStatus() {
			let body
			try {
				const res = await axios.get(generateUrl('/apps/scoreview/api/scores/{fileId}/status', { fileId: this.fileid }))
				body = res.data
			} catch (err) {
				this.state = 'error'
				this.errorMessage = err.message
				this.errorCode = ''
				return
			}

			if (body.status === 'ready') {
				this.state = 'ready'
				await this.$nextTick()
				await this.loadScore(body)
			} else if (body.status === 'error') {
				this.state = 'error'
				this.errorMessage = body.error || ''
				this.errorCode = body.errorCode || 'unknown'
				// Der Status-Endpunkt stößt bei einem gespeicherten Fehler selbst
				// schon einen erneuten Versuch an (z.B. nach einem Sidecar-
				// Konfigurationsfix). Einmalig automatisch nachschauen, ob der
				// gerade lief und erfolgreich war, statt dass der Nutzer die
				// Datei manuell neu öffnen muss. Begrenzt auf einen Versuch,
				// damit ein dauerhaft kaputtes Setup nicht endlos weiterpollt.
				if (!this.autoRetried) {
					this.autoRetried = true
					this.pollTimer = setTimeout(() => this.pollStatus(), POLL_INTERVAL_MS)
				}
			} else {
				this.state = 'converting'
				this.pollTimer = setTimeout(() => this.pollStatus(), POLL_INTERVAL_MS)
			}
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
				this.scoreTitle = metaRes.data.title || ''
				this.totalMeasures = metaRes.data.measures ?? this.measuresTimeline.events.length
				this.loadAnnotations()

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
					// Metronom-Klick auf Taktebene (Phase 17): einmal pro Takt, sobald
					// currentAnchor.measureNumber wechselt - measures.json liefert
					// keine Schlagauflösung (siehe lib/metronome.js), ein Klick pro
					// Schlag ist daraus nicht ableitbar. Während des Einzählers
					// (isCountingIn) übernimmt startCountIn() die Klicks selbst, damit
					// hier keine doppelten entstehen.
					if (this.metronomeEnabled && this.isPlaying && !this.isCountingIn) {
						const measureNumber = this.currentAnchor?.measureNumber
						if (measureNumber && measureNumber !== this.lastClickedMeasureNumber) {
							this.lastClickedMeasureNumber = measureNumber
							this.ensureMetronomeClick().click(true)
						}
					}
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
			const delays = computeCountInDelaysMs(beatsInMeasure, 60000 / bpm)
			this.isCountingIn = true
			const click = this.ensureMetronomeClick()
			this.countInTimers = delays.map((delay, i) => setTimeout(() => {
				click.click(i === 0)
				if (i === delays.length - 1) {
					this.isCountingIn = false
					this.countInTimers = []
					this.clock?.play()
				}
			}, delay))
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
			this.zoom = Number(event.target.value)
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

		async loadAnnotations() {
			try {
				const res = await axios.get(generateUrl('/apps/scoreview/api/scores/{fileId}/annotations', { fileId: this.fileid }))
				this.annotations = res.data
			} catch (err) {
				// Notizen sind eine Zusatzfunktion - ein Fehler hier soll die
				// eigentliche Notenansicht nicht mit in den Fehlerzustand reißen.
				// eslint-disable-next-line no-console
				console.error('ScoreView: Notizen konnten nicht geladen werden.', err)
			}
		},

		async onAnnotationCreate(draft) {
			this.annotationError = ''
			try {
				const res = await axios.post(generateUrl('/apps/scoreview/api/scores/{fileId}/annotations', { fileId: this.fileid }), {
					measureNumber: draft.measureNumber,
					fraction: draft.fraction,
					elid: draft.elid,
					anchorEtag: draft.anchorEtag,
					content: draft.content,
					visibility: draft.visibility,
				})
				this.annotations = [...this.annotations, { ...res.data, orphaned: false }]
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error('ScoreView: Notiz konnte nicht gespeichert werden.', err)
				this.annotationError = err.response?.data?.error || err.message
			}
		},

		async onAnnotationUpdate({ id, content }) {
			this.annotationError = ''
			try {
				const res = await axios.put(generateUrl('/apps/scoreview/api/scores/{fileId}/annotations/{id}', { fileId: this.fileid, id }), { content })
				this.annotations = this.annotations.map((a) => (a.id === id ? { ...a, ...res.data } : a))
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error('ScoreView: Notiz konnte nicht aktualisiert werden.', err)
				this.annotationError = err.response?.data?.error || err.message
			}
		},

		async onAnnotationDelete(annotation) {
			this.annotationError = ''
			try {
				await axios.delete(generateUrl('/apps/scoreview/api/scores/{fileId}/annotations/{id}', { fileId: this.fileid, id: annotation.id }))
				this.annotations = this.annotations.filter((a) => a.id !== annotation.id)
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error('ScoreView: Notiz konnte nicht gelöscht werden.', err)
				this.annotationError = err.response?.data?.error || err.message
			}
		},

		onAnnotationJumpTo(annotation) {
			if (!this.measuresTimeline || !this.clock) {
				return
			}
			const timeMs = measurePositionToTimeMs(this.measuresTimeline, annotation.measureNumber, annotation.fraction, this.durationMs)
			if (timeMs !== null) {
				this.clock.seek(timeMs)
			}
		},

		onAnnotationJumpToById(id) {
			const annotation = this.annotations.find((a) => a.id === id)
			if (annotation) {
				this.onAnnotationJumpTo(annotation)
			}
		},

		// Reine Sichtband-Rechnung in scrollPlan.js, hier nur die DOM-Messung
		// dazu (Phase 16, ersetzt die frühere reine Seitenwechsel-Erkennung).
		// Läuft bei jedem Notenwechsel (siehe useScoreSync.js), nicht jeden
		// rAF-Frame - dieselbe Drosselung wie beim bisherigen Cursor-Update.
		updateAutoScroll(rect) {
			if (!rect) {
				return
			}
			if (shouldSuppressAutoScroll(this.lastManualScrollAt, Date.now(), MANUAL_SCROLL_RESUME_MS)) {
				return
			}
			const pageEl = this.pageRefs[rect.page]
			const containerRect = this.$el.getBoundingClientRect()
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
					const pageTop = this.$el.scrollTop + (pageClientRect.top - containerRect.top)
					this.performAutoScroll(pageTop)
				}
				return
			}
			const cursorTop = this.$el.scrollTop + (cursorClientRect.top - containerRect.top)
			const target = planAutoScroll({
				cursorTop,
				cursorHeight: cursorClientRect.height,
				scrollTop: this.$el.scrollTop,
				viewportHeight: this.$el.clientHeight,
			})
			if (target !== null) {
				this.performAutoScroll(target)
			}
		},

		performAutoScroll(targetScrollTop) {
			const maxScrollTop = Math.max(0, this.$el.scrollHeight - this.$el.clientHeight)
			const clamped = Math.min(Math.max(0, targetScrollTop), maxScrollTop)
			// Markiert die eigenen, dadurch ausgelösten scroll-Events als
			// "programmatisch" (siehe onViewerScroll) - sonst würde unser
			// eigenes Nachführen sich selbst als manuellen Scroll auslegen und
			// sofort wieder pausieren.
			this.ignoreScrollUntil = Date.now() + PROGRAMMATIC_SCROLL_WINDOW_MS
			this.$el.scrollTo({ top: clamped, behavior: 'smooth' })
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
			const pagesEl = this.$el.querySelector('.scoreview-pages')
			if (!pagesEl) {
				return
			}
			// Seite 0 ist praktisch immer zuerst geladen (Phase 8: sichtbare
			// Seiten zuerst) - als Fallback irgendeine geladene Seite, falls die
			// Partitur mit Seite 0 aus dem Bild gescrollt sein sollte.
			const dims = this.pageDimensions[0] ?? Object.values(this.pageDimensions)[0]
			if (preset === 'width') {
				this.zoom = computeFitWidthZoom(pagesEl.clientWidth)
			} else if (preset === 'page') {
				if (!dims?.viewBox) {
					return
				}
				// Verfügbare Höhe ohne die sticky Transport-/Probenleiste, die über
				// der Seite sichtbar bleiben (sonst rechnet sich "ganze Seite" zu
				// groß und die Seite ragt darunter).
				const reserved = (this.$el.querySelector('.scoreview-transport')?.offsetHeight ?? 0)
					+ (this.$el.querySelector('.scoreview-rehearsal')?.offsetHeight ?? 0)
				this.zoom = computeFitPageZoom(dims.viewBox, pagesEl.clientWidth, this.$el.clientHeight - reserved)
			} else if (preset === 'actual') {
				this.zoom = computeActualSizeZoom(dims?.sizeMm ?? null)
			}
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
			this.isFullscreen = document.fullscreenElement === this.$el
			if (this.isFullscreen) {
				this.applyZoomPreset('page')
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
				this.zoom = computePinchZoom(this.pinchStartDistance, distance, this.pinchStartZoom)
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
.scoreview-viewer {
	width: 100%;
	height: 100%;
	overflow: auto;
	box-sizing: border-box;
	padding: 12px;
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
	text-align: left;
	color: var(--color-text-maxcontrast);
	font-size: 0.9em;
}

.scoreview-error-detail pre {
	white-space: pre-wrap;
	word-break: break-word;
}

.scoreview-hint {
	padding: 8px 1rem;
}

.scoreview-transport {
	display: flex;
	align-items: center;
	gap: 12px;
	position: sticky;
	top: 0;
	/*
	 * Muss über JEDEM Seiteninhalt liegen, auch beim Scrollen (Nutzer-
	 * Feedback: der Play/Pause-Button war nur bedienbar, wenn ganz oben
	 * gescrollt war). Grund: weder .scoreview-pages noch .score-page
	 * eröffnen einen eigenen Stacking-Context, daher konkurrieren
	 * .score-page-svg (z-index: 1, siehe ScorePage.vue) und
	 * .score-page-marker (z-index: 2) direkt mit diesem z-index - ohne
	 * einen klar höheren Wert hier hätte das zuletzt im DOM stehende
	 * Seitenelement bei gleichem/höherem z-index den Klick auf die sticky
	 * Transportleiste abgefangen, sobald sich beide beim Scrollen optisch
	 * überlappen.
	 */
	z-index: 10;
	background: var(--color-main-background);
	padding: 8px 0;
	margin-bottom: 12px;
}

.scoreview-position {
	flex: 0 1 auto;
	display: flex;
	flex-direction: column;
	line-height: 1.2;
	min-width: 0;
	max-width: 220px;
	overflow: hidden;
}

.scoreview-position-title {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.scoreview-position-measure {
	font-size: 0.85em;
	color: var(--color-text-maxcontrast);
	white-space: nowrap;
}

.scoreview-play {
	flex: 0 0 auto;
}

.scoreview-seek {
	flex: 1 1 auto;
}

.scoreview-time {
	flex: 0 0 auto;
	font-variant-numeric: tabular-nums;
	color: var(--color-text-maxcontrast);
}

.scoreview-tempo-label {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	gap: 4px;
	font-variant-numeric: tabular-nums;
	color: var(--color-text-maxcontrast);
}

.scoreview-tempo {
	width: 80px;
}

.scoreview-rehearsal {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
	padding: 4px 0 12px 0;
	color: var(--color-text-maxcontrast);
}

.scoreview-measure-input {
	width: 70px;
}

/*
 * Breiter als scoreview-measure-input (Phase 17, Nutzer-Rückmeldung: die
 * Felder waren 60px breit und zeigten die "from"/"to"-Beschriftung nur
 * abgeschnitten an) - Platz für Label ("From measure"/"To measure") UND
 * eine mehrstellige Taktnummer samt Zahlenfeld-Spinner.
 */
.scoreview-loop-input {
	width: 130px;
}

.scoreview-loop-fields {
	display: flex;
	align-items: center;
	gap: 6px;
}

.scoreview-zoom-label {
	display: flex;
	align-items: center;
	gap: 4px;
}

.scoreview-pages {
	display: flex;
	flex-direction: column;
}
</style>
