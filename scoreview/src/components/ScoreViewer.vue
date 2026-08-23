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
					<label class="scoreview-tempo-label">
						{{ Math.round(tempo * 100) }}%
						<input
							type="range"
							class="scoreview-tempo"
							min="0.5"
							max="1.5"
							step="0.05"
							:value="tempo"
							:aria-label="t('Tempo')"
							@input="onTempoInput">
					</label>
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
						class="scoreview-measure-input"
						:label="t('from')"
						label-outside
						:placeholder="t('from')" />
					<NcTextField
						v-model.number="loopToMeasure"
						type="number"
						min="1"
						class="scoreview-measure-input"
						:label="t('to')"
						label-outside
						:placeholder="t('to')" />
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
				<NcButton :aria-label="t('Fit page width')" @click="applyZoomPreset('width')">
					<template #icon>
						<ArrowExpandHorizontal :size="20" />
					</template>
				</NcButton>
				<NcButton :aria-label="t('Fit whole page')" @click="applyZoomPreset('page')">
					<template #icon>
						<FitToPage :size="20" />
					</template>
				</NcButton>
				<NcButton :aria-label="t('Actual size')" @click="applyZoomPreset('actual')">
					100%
				</NcButton>
				<NcButton :pressed="isFullscreen" :aria-label="isFullscreen ? t('Exit fullscreen') : t('Fullscreen')" @click="toggleFullscreen">
					<template #icon>
						<FullscreenExit v-if="isFullscreen" :size="20" />
						<Fullscreen v-else :size="20" />
					</template>
				</NcButton>
			</div>
			<NcNoteCard v-if="!hasRealPlayer" type="warning" class="scoreview-hint">
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
				@create="onAnnotationCreate"
				@update="onAnnotationUpdate"
				@delete="onAnnotationDelete"
				@jump-to="onAnnotationJumpTo" />
			<div class="scoreview-pages">
				<ScorePage
					v-for="(url, i) in pageUrls"
					:key="url"
					:ref="(el) => setPageRef(el, i)"
					:svg-url="url"
					:page-index="i"
					:cursor-rect="cursorRect"
					:zoom="zoom"
					:markers="annotationMarkers"
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
import ScorePage from './ScorePage.vue'
import ScoreMixer from './ScoreMixer.vue'
import ScoreAnnotations from './ScoreAnnotations.vue'
import {
	buildTimeline,
	computeActualSizeZoom,
	computeFitPageZoom,
	computeFitWidthZoom,
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
			// Phase 11: private Notizen.
			annotations: [],
			showAnnotations: false,
			currentEtag: null,
			currentElid: null,
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
					return rect ? { id: a.id, ...rect } : null
				})
				.filter(Boolean)
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
	},

	mounted() {
		// Passive Listener am Root-Element (nicht an window/document, siehe
		// PLAN.md Phase 16) - .scoreview-viewer ist der scrollende Container
		// selbst (overflow: auto), this.$el ist hier stabil über die gesamte
		// Lebensdauer der Komponente (anders als die ScorePage-Refs, die pro
		// Partitur neu entstehen).
		this.$el.addEventListener('scroll', this.onViewerScroll, { passive: true })
		document.addEventListener('fullscreenchange', this.onFullscreenChange)
	},

	beforeUnmount() {
		this.cleanup()
		this.$el.removeEventListener('scroll', this.onViewerScroll)
		document.removeEventListener('fullscreenchange', this.onFullscreenChange)
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
			this.currentEtag = null
			this.currentElid = null
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
			if (this.timeDisplayHandle) {
				cancelAnimationFrame(this.timeDisplayHandle)
				this.timeDisplayHandle = null
			}
			// Gibt den AudioContext frei (siehe lib/player.js) - der
			// silentClock hat kein destroy(), daher der Guard.
			this.clock?.destroy?.()
			this.clock = null
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
				this.mixerChannels = resolveMixerChannels(metaRes.data.tracks, metaRes.data.parts)
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
			try {
				const [midiRes, soundFontBuffer] = await Promise.all([
					axios.get(midiUrl, { responseType: 'arraybuffer' }),
					// Bewusst fetch() statt @nextcloud/axios: die SoundFont-URL ist
					// eine vom Admin frei konfigurierbare, potenziell fremde Adresse
					// (siehe PLAN.md E1/Phase 9) - @nextcloud/axios hängt an jede
					// Anfrage automatisch den CSRF-requesttoken-Header an, der dort
					// weder gebraucht wird noch hin sollte, und erzwingt dadurch
					// unnötig einen CORS-Preflight.
					fetch(soundFontUrl).then(async (res) => {
						if (!res.ok) {
							// Die app-eigene Route antwortet im Fehlerfall mit
							// {"error": "…"} (SoundFontController) - die Meldung ist
							// für die Nutzerin brauchbarer als "HTTP 503".
							const detail = await res.json().then((b) => b?.error).catch(() => null)
							throw new Error(detail || `SoundFont-Abruf fehlgeschlagen: HTTP ${res.status}`)
						}
						return res.arrayBuffer()
					}),
				])
				const player = await createPlayer(midiRes.data, soundFontBuffer)
				this.clock = player
				this.hasRealPlayer = true
				this.durationMs = player.durationMs
				this.presetList = player.getPresetList() ?? []
			} catch (err) {
				// SoundFont evtl. nicht erreichbar (falsche URL, CORS, Netzwerk) -
				// Notenansicht bleibt trotzdem nutzbar, nur ohne Ton (siehe
				// PLAN.md Risiko "SoundFont-Auslieferung").
				// eslint-disable-next-line no-console
				console.error('ScoreView: echte Wiedergabe konnte nicht initialisiert werden, falle auf stummen Modus zurück.', err)
				this.playbackError = err.message
				// buildTimeline({events: []}) wäre eine leere Zeitachse: der
				// Transport hätte danach Dauer 0 und die Partitur ließe sich
				// nicht mehr durchfahren. Die echte Timeline steht hier bereits
				// zur Verfügung - sie ist auch im stummen Modus die richtige.
				this.setUpSilentClock(this.timeline)
			}
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

		onTempoInput(event) {
			this.tempo = Number(event.target.value)
			this.clock?.setTempo?.(this.tempo)
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
		},

		onZoomInput(event) {
			this.zoom = Number(event.target.value)
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
			try {
				const res = await axios.post(generateUrl('/apps/scoreview/api/scores/{fileId}/annotations', { fileId: this.fileid }), {
					measureNumber: draft.measureNumber,
					fraction: draft.fraction,
					elid: draft.elid,
					anchorEtag: draft.anchorEtag,
					content: draft.content,
				})
				this.annotations = [...this.annotations, { ...res.data, orphaned: false }]
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error('ScoreView: Notiz konnte nicht gespeichert werden.', err)
			}
		},

		async onAnnotationUpdate({ id, content }) {
			try {
				const res = await axios.put(generateUrl('/apps/scoreview/api/scores/{fileId}/annotations/{id}', { fileId: this.fileid, id }), { content })
				this.annotations = this.annotations.map((a) => (a.id === id ? { ...a, ...res.data } : a))
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error('ScoreView: Notiz konnte nicht aktualisiert werden.', err)
			}
		},

		async onAnnotationDelete(annotation) {
			try {
				await axios.delete(generateUrl('/apps/scoreview/api/scores/{fileId}/annotations/{id}', { fileId: this.fileid, id: annotation.id }))
				this.annotations = this.annotations.filter((a) => a.id !== annotation.id)
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error('ScoreView: Notiz konnte nicht gelöscht werden.', err)
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
