<template>
	<div class="scoreview-practice">
		<!--
			Mikrofon nicht verfuegbar (E8): erkannt am Fehler, nicht am
			Geraet. In der WebView der Android-App lehnt getUserMedia heute
			immer ab - dort fuehrt der Knopf in den Browser, wo alles geht.
		-->
		<NcNoteCard v-if="micError" :type="micError.kind === 'blocked' ? 'warning' : 'error'">
			<p>{{ micErrorText }}</p>
			<p v-if="micError.kind === 'blocked'">
				<a
					class="scoreview-practice-open"
					:href="browserUrl"
					target="_blank"
					rel="noopener noreferrer">
					{{ t('Open in browser') }}
				</a>
			</p>
		</NcNoteCard>

		<section v-if="recordingEnabled" class="scoreview-practice-section">
			<h4>{{ t('Own recordings') }}</h4>
			<!-- Sagen, was das Geraet verlaesst - dort, wo aufgenommen wird. -->
			<p class="scoreview-practice-hint">
				{{ t('Audio stays on this device – except when you save a recording. Saved recordings can only be heard by you.') }}
			</p>
			<div class="scoreview-practice-row">
				<NcCheckboxRadioSwitch
					:modelValue="withAccompaniment"
					type="switch"
					:disabled="phase !== 'idle' || !hasRealPlayer"
					@update:modelValue="$emit('update:withAccompaniment', $event)">
					{{ t('With accompaniment') }}
				</NcCheckboxRadioSwitch>
				<NcCheckboxRadioSwitch
					:modelValue="countIn"
					type="switch"
					:disabled="phase !== 'idle'"
					@update:modelValue="$emit('update:countIn', $event)">
					{{ t('Count-in') }}
				</NcCheckboxRadioSwitch>
			</div>
			<NcNoteCard v-if="confirmReplace" type="warning">
				<p>{{ t('You already have {max} recordings of this score. Replace the oldest one?', { max: maxPerScore }) }}</p>
				<div class="scoreview-practice-row">
					<NcButton variant="primary" @click="$emit('replace', true)">
						{{ t('Replace oldest') }}
					</NcButton>
					<NcButton @click="$emit('replace', false)">
						{{ t('Cancel') }}
					</NcButton>
				</div>
			</NcNoteCard>
			<div class="scoreview-practice-row">
				<NcButton
					v-if="phase === 'recording' || phase === 'starting'"
					class="scoreview-record-stop"
					variant="error"
					@click="$emit('stop')">
					<template #icon>
						<StopIcon :size="20" />
					</template>
					{{ t('Stop recording ({time})', { time: formatDuration(elapsedMs) }) }}
				</NcButton>
				<NcButton
					v-else
					class="scoreview-record-start"
					:disabled="phase !== 'idle'"
					@click="$emit('start')">
					<template #icon>
						<NcLoadingIcon v-if="phase === 'saving'" :size="20" />
						<RecordRec v-else :size="20" />
					</template>
					{{ phase === 'saving' ? t('Saving…') : t('Record') }}
				</NcButton>
			</div>
			<p v-if="withAccompaniment && hasRealPlayer && phase === 'idle'" class="scoreview-practice-hint">
				{{ t('Use headphones: from a loudspeaker the accompaniment ends up in the recording.') }}
			</p>

			<NcNoteCard v-if="pending" type="error">
				<p>{{ t('The recording has not been saved: {error}', { error: pending.error }) }}</p>
				<p class="scoreview-practice-hint">
					{{ t('It is kept until you reload the page.') }}
				</p>
				<div class="scoreview-practice-row">
					<NcButton variant="primary" :disabled="phase !== 'idle'" @click="$emit('retry')">
						{{ t('Save again') }}
					</NcButton>
					<NcButton @click="listening === 'pending' ? $emit('stopListening') : $emit('listen', 'pending')">
						{{ listening === 'pending' ? t('Stop') : t('Play') }}
					</NcButton>
					<NcButton @click="$emit('discard')">
						{{ t('Discard') }}
					</NcButton>
				</div>
			</NcNoteCard>

			<p v-if="error" class="scoreview-practice-error">
				{{ error }}
			</p>

			<ul v-if="recordings.length > 0" class="scoreview-recordings">
				<li
					v-for="rec in recordings"
					:key="rec.id"
					class="scoreview-recording"
					:class="{ 'scoreview-recording--active': listening === rec.id }">
					<span class="scoreview-recording-meta">
						{{ formatDate(rec.createdAt) }} · {{ formatDuration(rec.durationMs) }}
						<span class="scoreview-practice-hint">
							{{ rec.withAccompaniment ? t('with accompaniment') : t('without accompaniment') }}
						</span>
					</span>
					<NcButton
						:aria-label="listening === rec.id ? t('Stop listening') : t('Listen along with the score')"
						:title="listening === rec.id ? t('Stop listening') : t('Listen along with the score')"
						@click="listening === rec.id ? $emit('stopListening') : $emit('listen', rec)">
						<template #icon>
							<StopIcon v-if="listening === rec.id" :size="20" />
							<Play v-else :size="20" />
						</template>
					</NcButton>
					<NcButton
						v-if="intonationEnabled"
						:aria-label="t('Check intonation')"
						:title="t('Check intonation')"
						:disabled="analyzing"
						@click="$emit('analyze', rec)">
						<template #icon>
							<Waveform :size="20" />
						</template>
					</NcButton>
					<NcButton
						:aria-label="t('Delete recording')"
						:title="t('Delete recording')"
						@click="$emit('delete', rec)">
						<template #icon>
							<Delete :size="20" />
						</template>
					</NcButton>
				</li>
			</ul>
			<p v-else-if="phase === 'idle' && !pending" class="scoreview-practice-hint">
				{{ t('No recordings of this score yet.') }}
			</p>

			<!-- Nur Aufnahme, beides, und der Pegel je Teil. -->
			<div v-if="listening !== null" class="scoreview-practice-levels">
				<label class="scoreview-practice-level">
					{{ t('Recording') }}
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						:value="recordingVolume"
						:aria-label="t('Volume of the recording')"
						@input="$emit('update:recordingVolume', Number($event.target.value))">
				</label>
				<label v-if="hasRealPlayer" class="scoreview-practice-level">
					{{ t('Accompaniment') }}
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						:value="accompanimentVolume"
						:aria-label="t('Volume of the accompaniment')"
						@input="$emit('update:accompanimentVolume', Number($event.target.value))">
				</label>
			</div>
		</section>

		<section v-if="intonationEnabled" class="scoreview-practice-section">
			<h4>{{ t('Intonation') }}</h4>
			<NcNoteCard v-if="needPart" type="info">
				{{ t('Choose your voice first: tap the voice symbol next to your part in the mixer.') }}
			</NcNoteCard>
			<NcButton :pressed="live" class="scoreview-intonation-live" @click="$emit('toggleLive')">
				<template #icon>
					<Microphone :size="20" />
				</template>
				{{ live ? t('Stop live intonation') : t('Live intonation') }}
			</NcButton>
			<!-- Lautsprecher statt Kopfhoerer macht das Signal
				mehrstimmig - dann kommt „nicht auswertbar", und hier steht, warum. -->
			<p v-if="live" class="scoreview-practice-hint">
				{{ t('Use headphones. From a loudspeaker the accompaniment reaches the microphone, and the notes cannot be evaluated.') }}
			</p>
			<p v-if="analyzing" class="scoreview-practice-hint">
				{{ t('Analysing the recording ({percent}%)…', { percent: Math.round(progress * 100) }) }}
			</p>
			<p v-if="intonationError" class="scoreview-practice-error">
				{{ intonationError }}
			</p>
			<template v-if="analysis">
				<div class="scoreview-practice-row">
					<p class="scoreview-practice-summary">
						{{ t('{total} notes checked, {problems} off, {na} not evaluable.', {
							total: analysis.evaluations.length,
							problems: analysis.problems.length,
							na: analysis.notEvaluable,
						}) }}
					</p>
					<NcButton :aria-label="t('Hide intonation result')" @click="$emit('clearAnalysis')">
						<template #icon>
							<Close :size="20" />
						</template>
					</NcButton>
				</div>
				<ul class="scoreview-problems">
					<li
						v-for="problem in analysis.problems"
						:key="problem.index"
						class="scoreview-problem"
						:class="`scoreview-problem--${problem.class}`">
						<details>
							<summary>
								<button type="button" class="scoreview-problem-jump" @click.stop.prevent="$emit('jump', problem.onMs)">
									{{ problemText(problem) }}
								</button>
							</summary>
							<!-- Der Verlauf ueber die ganze Note, auch das
								Absacken am Ende, das der Median nicht zeigt. -->
							<svg
								class="scoreview-curve"
								viewBox="0 0 200 60"
								preserveAspectRatio="none"
								role="img"
								:aria-label="t('Pitch curve of this note')">
								<rect
									x="0"
									:y="centsToY(25)"
									width="200"
									:height="centsToY(-25) - centsToY(25)"
									class="scoreview-curve-green" />
								<line
									x1="0"
									x2="200"
									:y1="centsToY(0)"
									:y2="centsToY(0)"
									class="scoreview-curve-zero" />
								<polyline :points="curvePoints(analysis.evaluations[problem.index])" class="scoreview-curve-line" />
							</svg>
						</details>
					</li>
				</ul>
				<p v-if="analysis.problems.length === 0" class="scoreview-practice-hint">
					{{ t('No note was off by more than 25 cents.') }}
				</p>
			</template>
		</section>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import Close from 'vue-material-design-icons/Close.vue'
import Delete from 'vue-material-design-icons/Delete.vue'
import Microphone from 'vue-material-design-icons/Microphone.vue'
import Play from 'vue-material-design-icons/Play.vue'
import RecordRec from 'vue-material-design-icons/RecordRec.vue'
import StopIcon from 'vue-material-design-icons/Stop.vue'
import Waveform from 'vue-material-design-icons/Waveform.vue'
import { formatCents } from '../lib/intonation.js'

/** Der Ausschnitt der Kurve: ±100 Cent, darueber wird am Rand gekappt. */
const CURVE_RANGE_CENTS = 100

/**
 * Aufnahme und Intonation als Karte ueber dem Notenbild. Nur
 * Darstellung - der Zustand steht in useRecorder.js und useIntonation.js.
 */
export default {
	name: 'RecordingPanel',

	components: {
		Close,
		Delete,
		Microphone,
		NcButton,
		NcCheckboxRadioSwitch,
		NcLoadingIcon,
		NcNoteCard,
		Play,
		RecordRec,
		StopIcon,
		Waveform,
	},

	props: {
		recordingEnabled: { type: Boolean, default: false },
		intonationEnabled: { type: Boolean, default: false },
		hasRealPlayer: { type: Boolean, default: false },
		recordings: { type: Array, default: () => [] },
		phase: { type: String, default: 'idle' },
		elapsedMs: { type: Number, default: 0 },
		withAccompaniment: { type: Boolean, default: false },
		countIn: { type: Boolean, default: false },
		confirmReplace: { type: Boolean, default: false },
		maxPerScore: { type: Number, default: 5 },
		pending: { type: Object, default: null },
		listening: { type: [Number, String], default: null },
		recordingVolume: { type: Number, default: 1 },
		accompanimentVolume: { type: Number, default: 1 },
		error: { type: String, default: '' },
		micError: { type: Object, default: null },
		browserUrl: { type: String, default: '' },
		live: { type: Boolean, default: false },
		needPart: { type: Boolean, default: false },
		analysis: { type: Object, default: null },
		analyzing: { type: Boolean, default: false },
		progress: { type: Number, default: 0 },
		intonationError: { type: String, default: '' },
	},

	emits: [
		'update:withAccompaniment',
		'update:countIn',
		'update:recordingVolume',
		'update:accompanimentVolume',
		'start',
		'stop',
		'replace',
		'retry',
		'discard',
		'listen',
		'stopListening',
		'delete',
		'analyze',
		'toggleLive',
		'clearAnalysis',
		'jump',
	],

	computed: {
		micErrorText() {
			switch (this.micError?.kind) {
				case 'blocked':
					return this.t('The microphone is not available here. In the Nextcloud app it cannot be used; in a browser it may have been blocked for this site.')
				case 'noDevice':
					return this.t('No microphone was found.')
				case 'busy':
					return this.t('The microphone is being used by another application.')
				default:
					return this.t('The microphone could not be started.')
			}
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		formatDuration(ms) {
			const total = Math.round((ms || 0) / 1000)
			return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
		},

		formatDate(seconds) {
			return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
		},

		problemText(problem) {
			const cents = formatCents(problem.cents)
			return problem.measure
				? this.t('Measure {measure}, {cents} cents', { measure: problem.measure, cents })
				: this.t('{cents} cents', { cents })
		},

		centsToY(cents) {
			const c = Math.max(-CURVE_RANGE_CENTS, Math.min(CURVE_RANGE_CENTS, cents))
			return 30 - (c / CURVE_RANGE_CENTS) * 28
		},

		curvePoints(evaluation) {
			const curve = evaluation?.curve ?? []
			if (curve.length < 2) {
				return ''
			}
			const von = curve[0].scoreMs
			const bis = curve[curve.length - 1].scoreMs
			const breite = Math.max(1, bis - von)
			// Stimmlose Rahmen fehlen in der Linie, statt sie zu verbinden.
			return curve
				.filter((p) => p.cents !== null)
				.map((p) => `${(((p.scoreMs - von) / breite) * 200).toFixed(1)},${this.centsToY(p.cents).toFixed(1)}`)
				.join(' ')
		},
	},
}
</script>

<style scoped>
.scoreview-practice {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.scoreview-practice-section {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.scoreview-practice-section h4 {
	margin: 0;
	font-weight: bold;
}

.scoreview-practice-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.scoreview-practice-hint {
	margin: 0;
	color: var(--color-text-maxcontrast);
	font-size: 0.9em;
}

.scoreview-practice-error {
	margin: 0;
	color: var(--color-error-text, #c62828);
}

.scoreview-practice-open {
	font-weight: bold;
	text-decoration: underline;
}

.scoreview-recordings,
.scoreview-problems {
	margin: 0;
	padding: 0;
	list-style: none;
}

.scoreview-recording {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 4px 0;
	border-block-end: 1px solid var(--color-border);
}

.scoreview-recording--active {
	font-weight: bold;
}

.scoreview-recording-meta {
	flex: 1 1 auto;
	display: flex;
	flex-direction: column;
}

.scoreview-practice-levels {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
}

.scoreview-practice-level {
	display: flex;
	flex-direction: column;
	min-inline-size: 140px;
}

.scoreview-practice-summary {
	flex: 1 1 auto;
	margin: 0;
}

.scoreview-problem {
	padding: 2px 0 2px 8px;
	border-inline-start: 4px solid var(--scoreview-intonation-yellow, #f9a825);
}

.scoreview-problem--red {
	border-inline-start-color: var(--scoreview-intonation-red, #d32f2f);
}

.scoreview-problem-jump {
	margin: 0;
	padding: 4px;
	border: none;
	background: transparent;
	color: var(--color-main-text);
	cursor: pointer;
	text-decoration: underline;
}

.scoreview-curve {
	inline-size: 100%;
	max-inline-size: 320px;
	block-size: 60px;
	background: var(--color-background-dark);
}

.scoreview-curve-green {
	fill: rgba(46, 125, 50, 0.2);
}

.scoreview-curve-zero {
	stroke: var(--color-text-maxcontrast);
	stroke-width: 0.5;
}

.scoreview-curve-line {
	fill: none;
	stroke: var(--color-main-text);
	stroke-width: 1.5;
	vector-effect: non-scaling-stroke;
}
</style>
