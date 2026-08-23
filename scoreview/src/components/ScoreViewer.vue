<template>
	<div class="scoreview-viewer">
		<div v-if="state === 'converting' || state === 'loading'" class="scoreview-status">
			{{ state === 'loading' ? 'Wird geladen…' : 'Wird konvertiert…' }}
		</div>
		<div v-else-if="state === 'error'" class="scoreview-status scoreview-error">
			Fehler: {{ errorMessage }}
		</div>
		<template v-else>
			<div class="scoreview-transport">
				<button type="button" class="scoreview-play" @click="togglePlay">
					{{ isPlaying ? '⏸' : '▶' }}
				</button>
				<input
					type="range"
					class="scoreview-seek"
					min="0"
					:max="durationMs"
					:value="currentTimeMs"
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
							@input="onTempoInput">
					</label>
					<button type="button" @click="showMixer = !showMixer">
						Mixer
					</button>
				</template>
				<button type="button" @click="showAnnotations = !showAnnotations">
					Notizen
				</button>
			</div>
			<div class="scoreview-rehearsal">
				<label>
					Takt
					<input
						v-model.number="measureInput"
						type="number"
						min="1"
						class="scoreview-measure-input"
						@keyup.enter="jumpToMeasure(measureInput)">
				</label>
				<button type="button" @click="jumpToMeasure(measureInput)">
					Los
				</button>
				<span class="scoreview-loop-fields">
					Loop
					<input v-model.number="loopFromMeasure" type="number" min="1" class="scoreview-measure-input" placeholder="von">
					<input v-model.number="loopToMeasure" type="number" min="1" class="scoreview-measure-input" placeholder="bis">
					<button type="button" :class="{ active: loopActive }" @click="toggleLoop">
						{{ loopActive ? 'Loop an' : 'Loop aus' }}
					</button>
				</span>
				<label class="scoreview-zoom-label">
					Zoom
					<input type="range" min="0.5" max="2" step="0.1" :value="zoom" @input="onZoomInput">
				</label>
			</div>
			<div v-if="!hasRealPlayer" class="scoreview-status scoreview-hint">
				Kein Ton: {{ playbackError || 'Wiedergabe ist nicht verfügbar.' }}
				Der Notenansicht-Cursor läuft unabhängig davon mit.
			</div>
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
					@marker-click="onAnnotationJumpToById" />
			</div>
		</template>
	</div>
</template>

<script>
import { generateUrl } from '@nextcloud/router'
import axios from '@nextcloud/axios'
import ScorePage from './ScorePage.vue'
import ScoreMixer from './ScoreMixer.vue'
import ScoreAnnotations from './ScoreAnnotations.vue'
import {
	buildTimeline,
	findElementAtPoint,
	findMeasureStartTime,
	findNearestOccurrenceTimeMs,
	measurePositionToTimeMs,
	resolveMeasurePosition,
} from '../lib/scoreLayout.js'
import { findStepIndex } from '../lib/timingSync.js'
import { resolveMixerChannels } from '../lib/mixerLayout.js'
import { useScoreSync } from '../composables/useScoreSync.js'
import { createSilentClock } from '../lib/silentClock.js'
import { createPlayer } from '../lib/player.js'

const POLL_INTERVAL_MS = 2000
// Näherung für die Transport-Gesamtdauer im stummen Platzhalter-Modus
// (kein konfiguriertes SoundFont, siehe unten) - letztes Timing-Event plus
// Puffer für den Ausklang der letzten Note. Mit echtem Player kommt die
// Dauer stattdessen von player.durationMs (tatsächliche MIDI-Länge).
const DURATION_PADDING_MS = 2000

export default {
	name: 'ScoreViewer',

	components: { ScorePage, ScoreMixer, ScoreAnnotations },

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
			// 0, nicht -1: Wiedergabe beginnt immer auf Seite 0 (erste Note),
			// die beim Mounten ohnehin schon sichtbar ist - ein initialer
			// Scroll-Aufruf dorthin wäre nur unnötige Animation.
			lastScrolledPage: 0,
			// Phase 10: Probenarbeit.
			timeline: null, // timing.json (Note-Ebene) - für Klick-auf-Note.
			measuresTimeline: null, // measures.json (Takt-Ebene) - für Taktnavigation/Loop.
			measureInput: 1,
			loopFromMeasure: null,
			loopToMeasure: null,
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

	beforeUnmount() {
		this.cleanup()
	},

	methods: {
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
			this.lastScrolledPage = 0
			this.timeline = null
			this.measuresTimeline = null
			this.measureInput = 1
			this.loopFromMeasure = null
			this.loopToMeasure = null
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
				return
			}

			if (body.status === 'ready') {
				this.state = 'ready'
				await this.$nextTick()
				await this.loadScore(body)
			} else if (body.status === 'error') {
				this.state = 'error'
				this.errorMessage = body.error || 'Unbekannter Fehler bei der Konvertierung.'
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
				this.loadAnnotations()

				if (soundFontUrl) {
					await this.setUpRealPlayer(files.midi, soundFontUrl)
				} else {
					this.playbackError = 'Es ist kein SoundFont verfügbar (siehe Einstellungen → ScoreView).'
					this.setUpSilentClock(timeline)
				}

				this.sync = useScoreSync(timeline, this.clock, (rect) => {
					this.cursorRect = rect
					// Nur bei echtem Seitenwechsel scrollen (PLAN.md Phase 8) - nicht
					// bei jedem Notenwechsel auf derselben, ohnehin schon sichtbaren
					// Seite erneut anstoßen (sonst überlagert eine noch laufende
					// smooth-Scroll-Animation die nächste).
					if (rect && rect.page !== this.lastScrolledPage) {
						this.lastScrolledPage = rect.page
						this.scrollToPage(rect.page)
					}
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

		scrollToPage(pageIndex) {
			this.pageRefs[pageIndex]?.$el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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

.scoreview-hint {
	padding: 8px 1rem;
}

.scoreview-transport {
	display: flex;
	align-items: center;
	gap: 12px;
	position: sticky;
	top: 0;
	z-index: 1;
	background: var(--color-main-background);
	padding: 8px 0;
	margin-bottom: 12px;
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
	width: 60px;
}

.scoreview-loop-fields {
	display: flex;
	align-items: center;
	gap: 6px;
}

.scoreview-loop-fields button.active {
	background: var(--color-primary-element);
	color: var(--color-primary-element-text);
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
